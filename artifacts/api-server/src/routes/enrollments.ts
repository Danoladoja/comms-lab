import { Router, type IRouter } from "express";
import { db, attendanceTable, enrollmentsTable, programsTable, sessionsTable, usersTable } from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

const LIVE_GRACE_MS = 5 * 60 * 1000; // join within 5 min of start still counts as "from the start"

type SessionLite = {
  id: number;
  programId: number;
  startsAt: Date | null;
  durationMins: number;
  sortOrder: number;
};

type ProgressEntry = {
  sessionId: number;
  programId: number;
  progressPct: number;
  attendedLive: boolean;
  completed: boolean;
  locked: boolean;
};

/**
 * Compute per-module progress and sequential lock state for a learner.
 * - progressPct: share of the session the learner was present for (by join time).
 * - attendedLive: joined within the grace window of the start and the session has ended.
 * - completed: attendedLive (present start to finish).
 * - locked: a previous module in the same program is not completed yet.
 * A previous module does NOT lock later ones when it is unscheduled, or when it
 * ended before the learner enrolled (late joiners are not locked out forever).
 */
export function computeProgress(
  sessions: SessionLite[],
  attendance: Map<number, Date>,
  enrolledAtByProgram: Map<number, Date>,
  now = Date.now(),
): ProgressEntry[] {
  const byProgram = new Map<number, SessionLite[]>();
  for (const s of sessions) {
    const list = byProgram.get(s.programId) ?? [];
    list.push(s);
    byProgram.set(s.programId, list);
  }
  const entries: ProgressEntry[] = [];
  for (const [programId, list] of byProgram.entries()) {
    // Canonical deterministic order: startsAt, sortOrder, id.
    list.sort((a, b) => {
      const at = a.startsAt?.getTime() ?? Infinity;
      const bt = b.startsAt?.getTime() ?? Infinity;
      return at - bt || a.sortOrder - b.sortOrder || a.id - b.id;
    });
    const enrolledAt = enrolledAtByProgram.get(programId)?.getTime() ?? 0;
    let previousSatisfied = true; // first module is always unlocked
    for (const s of list) {
      const joined = attendance.get(s.id);
      const start = s.startsAt?.getTime() ?? null;
      const durationMs = s.durationMins * 60 * 1000;
      const end = start !== null ? start + durationMs : null;
      let progressPct = 0;
      let attendedLive = false;
      if (joined && start !== null && end !== null) {
        const effectiveJoin = Math.max(joined.getTime(), start);
        const watchedUntil = Math.min(now, end);
        progressPct = Math.max(0, Math.min(100, Math.round(((watchedUntil - effectiveJoin) / durationMs) * 100)));
        attendedLive = joined.getTime() <= start + LIVE_GRACE_MS && now >= end;
        if (attendedLive) progressPct = 100;
      }
      const completed = attendedLive;
      entries.push({ sessionId: s.id, programId: s.programId, progressPct, attendedLive, completed, locked: !previousSatisfied });
      // Waived prerequisites: unscheduled sessions, or sessions that ended before enrollment.
      const waived = start === null || (end !== null && end < enrolledAt);
      previousSatisfied = completed || waived;
    }
  }
  return entries;
}

export async function progressForUser(userId: number, programIds: number[]): Promise<ProgressEntry[]> {
  if (programIds.length === 0) return [];
  const sessions = await db
    .select({
      id: sessionsTable.id,
      programId: sessionsTable.programId,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      sortOrder: sessionsTable.sortOrder,
    })
    .from(sessionsTable)
    .where(inArray(sessionsTable.programId, programIds));
  const att = await db
    .select()
    .from(attendanceTable)
    .where(and(eq(attendanceTable.userId, userId), inArray(attendanceTable.sessionId, sessions.map((s) => s.id).concat(-1))));
  const attendance = new Map(att.map((a) => [a.sessionId, a.joinedAt]));
  const enrollRows = await db
    .select({ programId: enrollmentsTable.programId, createdAt: enrollmentsTable.createdAt })
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, userId), inArray(enrollmentsTable.programId, programIds)));
  const enrolledAtByProgram = new Map(enrollRows.map((e) => [e.programId, e.createdAt]));
  return computeProgress(sessions, attendance, enrolledAtByProgram);
}

async function enrolledProgramIds(userId: number): Promise<number[]> {
  const enrolled = await db
    .select({ programId: enrollmentsTable.programId })
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, userId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
  return enrolled.map((e) => e.programId);
}

router.post("/programs/:id/enroll", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const programId = Number(req.params.id);
  const program = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (program.length === 0 || program[0].status !== "published") {
    res.status(404).json({ error: "Program not found" });
    return;
  }
  const existing = await db
    .select()
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, user.id), eq(enrollmentsTable.programId, programId)));
  if (existing.length > 0 && existing[0].status !== "cancelled") {
    res.status(409).json({ error: "Already enrolled" });
    return;
  }

  // Lock the program row so concurrent enrollments cannot exceed capacity.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${programsTable} where id = ${programId} for update`);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(enrollmentsTable)
      .where(and(eq(enrollmentsTable.programId, programId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
    const status = count >= program[0].capacity ? "waitlisted" : "enrolled";

    if (existing.length > 0) {
      const [updated] = await tx
        .update(enrollmentsTable)
        .set({ status })
        .where(eq(enrollmentsTable.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await tx
      .insert(enrollmentsTable)
      .values({ userId: user.id, programId, status })
      .returning();
    return created;
  });
  res.status(201).json(result);
});

router.get("/my/enrollments", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await db
    .select({
      id: enrollmentsTable.id,
      userId: enrollmentsTable.userId,
      programId: enrollmentsTable.programId,
      status: enrollmentsTable.status,
      programTitle: programsTable.title,
      programStartDate: programsTable.startDate,
    })
    .from(enrollmentsTable)
    .innerJoin(programsTable, eq(enrollmentsTable.programId, programsTable.id))
    .where(eq(enrollmentsTable.userId, user.id))
    .orderBy(asc(enrollmentsTable.id));
  res.json(rows.map((r) => ({ ...r, userName: user.name, userEmail: user.email })));
});

router.post("/sessions/:id/join", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const sessionId = Number(req.params.id);
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const isStaff = user.role === "admin" || (user.role === "instructor" && session.instructorId === user.id);
  if (!isStaff) {
    const programIds = await enrolledProgramIds(user.id);
    if (!programIds.includes(session.programId)) {
      res.status(403).json({ error: "You are not enrolled in this program" });
      return;
    }
    const progress = await progressForUser(user.id, [session.programId]);
    const entry = progress.find((p) => p.sessionId === sessionId);
    if (entry?.locked) {
      res.status(403).json({ error: "Complete the previous module to unlock this one" });
      return;
    }
    // Only allow joining during the live window (small grace before the start).
    if (!session.startsAt) {
      res.status(403).json({ error: "This session is not scheduled yet" });
      return;
    }
    const start = session.startsAt.getTime();
    const end = start + session.durationMins * 60 * 1000;
    const now = Date.now();
    if (now < start - LIVE_GRACE_MS) {
      res.status(403).json({ error: "The class has not started yet" });
      return;
    }
    if (now > end) {
      res.status(403).json({ error: "This class has already ended" });
      return;
    }
  }

  const inserted = await db
    .insert(attendanceTable)
    .values({ userId: user.id, sessionId })
    .onConflictDoNothing()
    .returning();
  const joinedAt =
    inserted[0]?.joinedAt ??
    (await db
      .select()
      .from(attendanceTable)
      .where(and(eq(attendanceTable.userId, user.id), eq(attendanceTable.sessionId, sessionId))))[0].joinedAt;

  res.json({ sessionId, joinedAt: joinedAt.toISOString(), joinUrl: session.meetUrl ?? null });
});

router.get("/my/progress", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const programIds = await enrolledProgramIds(user.id);
  res.json(await progressForUser(user.id, programIds));
});

router.get("/my/sessions", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let programIds: number[] = [];
  if (user.role === "instructor") {
    const taught = await db
      .selectDistinct({ programId: sessionsTable.programId })
      .from(sessionsTable)
      .where(eq(sessionsTable.instructorId, user.id));
    programIds = taught.map((t) => t.programId);
  } else {
    const enrolled = await db
      .select({ programId: enrollmentsTable.programId })
      .from(enrollmentsTable)
      .where(and(eq(enrollmentsTable.userId, user.id), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
    programIds = enrolled.map((e) => e.programId);
  }
  if (programIds.length === 0) {
    res.json([]);
    return;
  }

  const baseWhere =
    user.role === "instructor"
      ? and(inArray(sessionsTable.programId, programIds), eq(sessionsTable.instructorId, user.id))
      : inArray(sessionsTable.programId, programIds);

  const rows = await db
    .select({
      id: sessionsTable.id,
      programId: sessionsTable.programId,
      programTitle: programsTable.title,
      title: sessionsTable.title,
      description: sessionsTable.description,
      sortOrder: sessionsTable.sortOrder,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      meetUrl: sessionsTable.meetUrl,
      recordingUrl: sessionsTable.recordingUrl,
      instructorId: sessionsTable.instructorId,
      instructorName: usersTable.name,
    })
    .from(sessionsTable)
    .innerJoin(programsTable, eq(sessionsTable.programId, programsTable.id))
    .leftJoin(usersTable, eq(sessionsTable.instructorId, usersTable.id))
    .where(baseWhere)
    .orderBy(asc(sessionsTable.startsAt), asc(sessionsTable.sortOrder), asc(sessionsTable.id));

  if (user.role === "instructor" || user.role === "admin") {
    res.json(rows);
    return;
  }

  // Learners never get raw meet links (they must go through the join endpoint,
  // which enforces the lock and the live window) and only get replay links for
  // sessions they attended live start to finish.
  const progress = await progressForUser(user.id, programIds);
  const replayable = new Set(progress.filter((p) => p.attendedLive).map((p) => p.sessionId));
  res.json(rows.map((r) => ({ ...r, meetUrl: null, recordingUrl: replayable.has(r.id) ? r.recordingUrl : null })));
});

export default router;
