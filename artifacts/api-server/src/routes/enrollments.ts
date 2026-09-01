import { Router, type IRouter } from "express";
import {
  db, attendanceTable, enrollmentsTable, programsTable, sessionsTable, usersTable,
  assignmentsTable, assignmentSubmissionsTable,
} from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  liveWindow,
  acceptsEnrolment,
  showsInCatalogue,
  CLOSED_TO_ENROLMENT_MESSAGE,
  generateCertificateCode,
  normaliseCertificateCode,
  type ProgressEntry,
  isModuleStaff, satisfiesRole,
} from "@workspace/domain";
import { SetPortfolioVisibilityBody } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { progressForUser, enrolledProgramIds } from "../lib/progress";
import { sendEnrollmentConfirmation, sendWaitlistConfirmation } from "../lib/enrollmentEmails";

const router: IRouter = Router();

router.post("/programs/:id/enroll", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const programId = Number(req.params.id);
  const program = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (program.length === 0 || (!showsInCatalogue(program[0].status) && !acceptsEnrolment(program[0].status))) {
    res.status(404).json({ error: "Program not found" });
    return;
  }
  // A closed programme is still on the site, so this is a real refusal rather
  // than a missing page, and the learner is told which it is.
  if (!acceptsEnrolment(program[0].status)) {
    res.status(409).json({ error: CLOSED_TO_ENROLMENT_MESSAGE });
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
      .values({ userId: user.id, programId, status, certificateCode: generateCertificateCode() })
      .returning();
    return created;
  });

  // Fire-and-forget: the enrollment is committed; an email failure only logs.
  if (result.status === "enrolled") {
    sendEnrollmentConfirmation({ email: user.email, name: user.name }, program[0]);
  } else if (result.status === "waitlisted") {
    sendWaitlistConfirmation({ email: user.email, name: user.name }, program[0]);
  }
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

  const isStaff = isModuleStaff(user.role, user.id, session.instructorId);
  const window = liveWindow(session);

  if (!isStaff) {
    const programIds = await enrolledProgramIds(user.id);
    if (!programIds.includes(session.programId)) {
      res.status(403).json({ error: "You are not enrolled in this program" });
      return;
    }
    const progress = await progressForUser(user.id, [session.programId]);
    const entry = progress.find((p) => p.sessionId === sessionId);
    if (entry?.locked) {
      res.status(403).json({ error: "Finish the previous module's work to unlock this one" });
      return;
    }
    // The join window comes from @workspace/domain, which is also what the web
    // client reads to decide when to show the button. They cannot drift apart
    // again: the old client offered "Join" at T-15 while this rejected it
    // until T-5.
    if (window.state === "unscheduled") {
      res.status(403).json({ error: "This session is not scheduled yet" });
      return;
    }
    if (!window.canJoin) {
      res.status(403).json({
        error: window.state === "ended" ? "This class has already ended" : "The room is not open yet",
      });
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

  // Attendance is recognition, never a gate — but the learner is told plainly
  // whether this join earned it, instead of finding out never.
  const countedAsOnTime = liveWindow(session, joinedAt.getTime()).countsAsOnTime;

  res.json({
    sessionId,
    joinedAt: joinedAt.toISOString(),
    joinUrl: session.meetUrl ?? null,
    countedAsOnTime,
  });
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

/* ---------- Certificates ---------- */

export function certificateCodeForVerification(rawCode: string): string | null {
  return normaliseCertificateCode(rawCode);
}

export function enrollmentCanReceiveCertificate(status: string): boolean {
  return status === "enrolled" || status === "completed";
}

function completedProgramIdsFrom(progress: ProgressEntry[]): number[] {
  const byProgram = new Map<number, ProgressEntry[]>();
  for (const p of progress) {
    const list = byProgram.get(p.programId) ?? [];
    list.push(p);
    byProgram.set(p.programId, list);
  }
  return [...byProgram.entries()]
    .filter(([, entries]) => entries.length > 0 && entries.every((e) => e.completed))
    .map(([programId]) => programId);
}

async function lastEndByProgram(programIds: number[]): Promise<Map<number, string | null>> {
  if (programIds.length === 0) return new Map();
  const rows = await db
    .select({
      programId: sessionsTable.programId,
      lastEnd: sql<string | null>`max(${sessionsTable.startsAt} + make_interval(mins => ${sessionsTable.durationMins}))`,
    })
    .from(sessionsTable)
    .where(inArray(sessionsTable.programId, programIds))
    .groupBy(sessionsTable.programId);
  return new Map(rows.map((r) => [r.programId, r.lastEnd]));
}

router.get("/my/certificates", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const programIds = await enrolledProgramIds(user.id);
  if (programIds.length === 0) {
    res.json([]);
    return;
  }
  const progress = await progressForUser(user.id, programIds);
  const completedProgramIds = completedProgramIdsFrom(progress);
  if (completedProgramIds.length === 0) {
    res.json([]);
    return;
  }

  const [programs, enrollments, lastEnds] = await Promise.all([
    db
      .select({ id: programsTable.id, title: programsTable.title })
      .from(programsTable)
      .where(inArray(programsTable.id, completedProgramIds)),
    db
      .select({
        programId: enrollmentsTable.programId,
        certificateCode: enrollmentsTable.certificateCode,
        portfolioPublic: enrollmentsTable.portfolioPublic,
      })
      .from(enrollmentsTable)
      .where(and(eq(enrollmentsTable.userId, user.id), inArray(enrollmentsTable.programId, completedProgramIds))),
    lastEndByProgram(completedProgramIds),
  ]);
  const enrollmentByProgram = new Map(enrollments.map((e) => [e.programId, e]));

  res.json(
    programs.flatMap((p) => {
      const enrollment = enrollmentByProgram.get(p.id);
      if (!enrollment) return [];
      const entries = progress.filter((e) => e.programId === p.id);
      return [{
        programId: p.id,
        programTitle: p.title,
        learnerName: user.name,
        completedAt: lastEnds.get(p.id) ? new Date(lastEnds.get(p.id)!).toISOString() : null,
        certificateId: enrollment.certificateCode,
        portfolioPublic: enrollment.portfolioPublic,
        modulesCompleted: entries.length,
        reviewsWritten: entries.reduce((sum, e) => sum + e.reviewsGiven, 0),
      }];
    }),
  );
});

router.patch("/my/certificates/:programId/portfolio", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const programId = Number(req.params.programId);
  const parsed = SetPortfolioVisibilityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const progress = await progressForUser(user.id, [programId]);
  if (!completedProgramIdsFrom(progress).includes(programId)) {
    res.status(404).json({ error: "No completed enrollment for that program" });
    return;
  }

  const [updated] = await db
    .update(enrollmentsTable)
    .set({ portfolioPublic: parsed.data.portfolioPublic })
    .where(and(eq(enrollmentsTable.userId, user.id), eq(enrollmentsTable.programId, programId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "No completed enrollment for that program" });
    return;
  }

  const [program] = await db
    .select({ title: programsTable.title })
    .from(programsTable)
    .where(eq(programsTable.id, programId));
  const lastEnds = await lastEndByProgram([programId]);
  const entries = progress.filter((e) => e.programId === programId);

  res.json({
    programId,
    programTitle: program?.title ?? "",
    learnerName: user.name,
    completedAt: lastEnds.get(programId) ? new Date(lastEnds.get(programId)!).toISOString() : null,
    certificateId: updated.certificateCode,
    portfolioPublic: updated.portfolioPublic,
    modulesCompleted: entries.length,
    reviewsWritten: entries.reduce((sum, e) => sum + e.reviewsGiven, 0),
  });
});

/**
 * Public verification. No auth.
 *
 * The code is opaque and looked up, never parsed — the old
 * AECL-{programId}-{userId} format let anyone walk the range and harvest every
 * graduate's name. Completion is recomputed here rather than trusted from a
 * stored flag, and the learner's actual work is included only when they have
 * explicitly published their portfolio.
 */
router.get("/certificates/:certificateId/verify", async (req, res) => {
  const code = certificateCodeForVerification(String(req.params.certificateId));
  if (!code) {
    res.status(404).json({ error: "Certificate not found" });
    return;
  }

  const [enrollment] = await db
    .select({
      userId: enrollmentsTable.userId,
      programId: enrollmentsTable.programId,
      portfolioPublic: enrollmentsTable.portfolioPublic,
      certificateCode: enrollmentsTable.certificateCode,
      status: enrollmentsTable.status,
    })
    .from(enrollmentsTable)
    .where(eq(enrollmentsTable.certificateCode, code));
  if (!enrollment || !enrollmentCanReceiveCertificate(enrollment.status)) {
    res.status(404).json({ error: "Certificate not found" });
    return;
  }

  const progress = await progressForUser(enrollment.userId, [enrollment.programId]);
  const entries = progress.filter((p) => p.programId === enrollment.programId);
  if (entries.length === 0 || !entries.every((e) => e.completed)) {
    res.status(404).json({ error: "Certificate not found" });
    return;
  }

  const [programRows, learnerRows, lastEnds] = await Promise.all([
    db.select({ title: programsTable.title }).from(programsTable).where(eq(programsTable.id, enrollment.programId)),
    db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, enrollment.userId)),
    lastEndByProgram([enrollment.programId]),
  ]);
  const program = programRows[0];
  const learner = learnerRows[0];
  if (!program || !learner) {
    res.status(404).json({ error: "Certificate not found" });
    return;
  }

  // The portfolio is what actually gets someone commissioned — but only if the
  // learner chose to publish it.
  let works: { title: string; body: string; submittedAt: string }[] = [];
  if (enrollment.portfolioPublic) {
    const rows = await db
      .select({
        title: assignmentsTable.title,
        body: assignmentSubmissionsTable.body,
        submittedAt: assignmentSubmissionsTable.submittedAt,
      })
      .from(assignmentSubmissionsTable)
      .innerJoin(sessionsTable, eq(assignmentSubmissionsTable.sessionId, sessionsTable.id))
      .innerJoin(assignmentsTable, eq(assignmentsTable.sessionId, sessionsTable.id))
      .where(and(
        eq(assignmentSubmissionsTable.userId, enrollment.userId),
        eq(sessionsTable.programId, enrollment.programId),
      ))
      .orderBy(asc(sessionsTable.startsAt), asc(sessionsTable.sortOrder));
    works = rows.map((r) => ({
      title: r.title,
      body: r.body,
      submittedAt: r.submittedAt.toISOString(),
    }));
  }

  res.json({
    programTitle: program.title,
    learnerName: learner.name,
    completedAt: lastEnds.get(enrollment.programId)
      ? new Date(lastEnds.get(enrollment.programId)!).toISOString()
      : null,
    certificateId: enrollment.certificateCode,
    portfolioPublic: enrollment.portfolioPublic,
    modulesCompleted: entries.length,
    reviewsWritten: entries.reduce((sum, e) => sum + e.reviewsGiven, 0),
    works,
  });
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
    programIds = await enrolledProgramIds(user.id);
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
      instructorName: sql<string | null>`coalesce(${usersTable.name}, ${sessionsTable.guestFacilitator})`,
      guestFacilitator: sessionsTable.guestFacilitator,
    })
    .from(sessionsTable)
    .innerJoin(programsTable, eq(sessionsTable.programId, programsTable.id))
    .leftJoin(usersTable, eq(sessionsTable.instructorId, usersTable.id))
    .where(baseWhere)
    .orderBy(asc(sessionsTable.startsAt), asc(sessionsTable.sortOrder), asc(sessionsTable.id));

  // Setting up the meeting room is an admin duty, so only admins receive the
  // raw link. Learners and facilitators alike reach the room by pressing Join,
  // which is also what starts counting their time in class. Everyone gets
  // hasMeetUrl so the page can say whether the room is ready yet.
  const isAdmin = satisfiesRole(user.role, ["admin"]);
  res.json(rows.map((r) => ({
    ...r,
    meetUrl: isAdmin ? r.meetUrl : null,
    hasMeetUrl: !!r.meetUrl,
  })));
});

export default router;
