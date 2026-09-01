import { Router, type IRouter } from "express";
import {
  db, attendanceTable, replayProgressTable, enrollmentsTable, sessionsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  liveWindow,
  heartbeatCredit,
  mergeReplayBuckets,
  replayWatchedSeconds,
  presenceStatus,
  isModuleStaff,
} from "@workspace/domain";
import { RecordReplayProgressBody } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { progressForUser } from "../lib/progress";

const router: IRouter = Router();

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * Enrolled, and the module is unlocked. Staff are exempt: an instructor
 * reviewing their own recording is not accruing a completion.
 */
async function accessError(
  user: User,
  session: { id: number; programId: number; instructorId: number | null },
): Promise<string | null> {
  if (isModuleStaff(user.role, user.id, session.instructorId)) return null;
  const [enrollment] = await db
    .select({ id: enrollmentsTable.id })
    .from(enrollmentsTable)
    .where(and(
      eq(enrollmentsTable.userId, user.id),
      eq(enrollmentsTable.programId, session.programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));
  if (!enrollment) return "You are not enrolled in this program";
  const progress = await progressForUser(user.id, [session.programId]);
  if (progress.find((p) => p.sessionId === session.id)?.locked) {
    return "Finish the previous module's work to unlock this one";
  }
  return null;
}

/** Recompute the presence figure for one module, for the response. */
async function currentPresence(userId: number, session: { id: number; durationMins: number }) {
  const [[att], [replay]] = await Promise.all([
    db
      .select()
      .from(attendanceTable)
      .where(and(eq(attendanceTable.userId, userId), eq(attendanceTable.sessionId, session.id))),
    db
      .select()
      .from(replayProgressTable)
      .where(and(eq(replayProgressTable.userId, userId), eq(replayProgressTable.sessionId, session.id))),
  ]);
  return presenceStatus({
    liveSeconds: att?.liveSeconds ?? 0,
    sessionSeconds: session.durationMins * 60,
    replayWatchedSeconds: replay ? replayWatchedSeconds(replay.buckets, replay.durationSeconds) : 0,
    replayDurationSeconds: replay?.durationSeconds ?? null,
  });
}

/* ---------- Live: heartbeat while the class is running ---------- */

router.post("/sessions/:id/presence/heartbeat", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const err = await accessError(user, session);
  if (err) { res.status(403).json({ error: err }); return; }

  const win = liveWindow(session);
  if (win.startsAtMs === null || win.endsAtMs === null) {
    res.status(403).json({ error: "This session is not scheduled" });
    return;
  }
  // Beats only count while the class is actually running. Outside the window
  // there is nothing to be present for.
  const now = Date.now();
  if (now < win.startsAtMs || now > win.endsAtMs) {
    res.status(403).json({ error: "The class is not running" });
    return;
  }

  // Attendance rows are created by the join endpoint, but a learner who opened
  // the classroom without clicking through to Meet is still in the room.
  const [existing] = await db
    .insert(attendanceTable)
    .values({ userId: user.id, sessionId, lastHeartbeatAt: new Date(now) })
    .onConflictDoNothing()
    .returning();

  let liveSeconds = existing?.liveSeconds ?? 0;

  if (!existing) {
    const [row] = await db
      .select()
      .from(attendanceTable)
      .where(and(eq(attendanceTable.userId, user.id), eq(attendanceTable.sessionId, sessionId)));

    const credit = heartbeatCredit({
      previousBeatMs: row?.lastHeartbeatAt?.getTime() ?? null,
      nowMs: now,
      sessionStartMs: win.startsAtMs,
      sessionEndMs: win.endsAtMs,
    });

    const [updated] = await db
      .update(attendanceTable)
      .set({
        liveSeconds: sql`${attendanceTable.liveSeconds} + ${credit}`,
        lastHeartbeatAt: new Date(now),
      })
      .where(and(eq(attendanceTable.userId, user.id), eq(attendanceTable.sessionId, sessionId)))
      .returning();
    liveSeconds = updated?.liveSeconds ?? 0;
  }

  res.json({
    sessionId,
    liveSeconds,
    presence: await currentPresence(user.id, session),
  });
});

/* ---------- Replay: which slices of the recording were played ---------- */

router.post("/sessions/:id/replay/progress", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const err = await accessError(user, session);
  if (err) { res.status(403).json({ error: err }); return; }

  const parsed = RecordReplayProgressBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db
    .select()
    .from(replayProgressTable)
    .where(and(eq(replayProgressTable.userId, user.id), eq(replayProgressTable.sessionId, sessionId)));

  // Keep the longest duration any player has reported: a truncated read while
  // the video is still loading should not shrink the denominator.
  const durationSeconds = Math.max(
    parsed.data.durationSeconds ?? 0,
    existing?.durationSeconds ?? 0,
  ) || null;

  const buckets = mergeReplayBuckets(existing?.buckets ?? [], parsed.data.buckets, durationSeconds);

  if (existing) {
    await db
      .update(replayProgressTable)
      .set({ buckets, durationSeconds })
      .where(eq(replayProgressTable.id, existing.id));
  } else {
    await db
      .insert(replayProgressTable)
      .values({ userId: user.id, sessionId, buckets, durationSeconds })
      .onConflictDoNothing();
  }

  res.json({
    sessionId,
    watchedSeconds: replayWatchedSeconds(buckets, durationSeconds),
    durationSeconds,
    presence: await currentPresence(user.id, session),
  });
});

export default router;
