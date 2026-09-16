import { Router, type IRouter } from "express";
import {
  db, attendanceTable, replayProgressTable, enrollmentsTable, sessionsTable,
} from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  liveWindow,
  heartbeatCredit,
  mergeReplayBuckets,
  settleRecordingLength,
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
  /**
   * Whether to also check the module is unlocked.
   *
   * That check runs the whole progress calculation — around eighteen queries
   * across the learner's entire programme — which is affordable once on a page
   * load and ruinous every thirty seconds for every learner in a live class.
   * At two or three classes running together the database's ten connections are
   * exhausted, heartbeats queue, and attendance is under-recorded: exactly the
   * failure the heartbeat was fixed for in the first place.
   *
   * The heartbeat therefore skips it, and loses nothing by doing so. A lock
   * governs whether a learner may *open* a module; this endpoint returns no
   * module content, only that learner's own minutes. Banking attendance for a
   * class they sat through does not move them past anything — they still have
   * to finish the previous week to reach it.
   */
  requireUnlocked = true,
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
  if (!enrollment) return "You are not enrolled on this programme";
  if (!requireUnlocked) return null;
  const progress = await progressForUser(user.id, [session.programId]);
  if (progress.find((p) => p.sessionId === session.id)?.locked) {
    return "Finish the previous module's work to unlock this one";
  }
  return null;
}

/** Recompute the presence figure for one module, for the response. */
async function currentPresence(
  userId: number,
  session: { id: number; durationMins: number; recordingDurationSeconds?: number | null },
) {
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
    waived: !!att?.presenceWaivedAt,
    liveSeconds: att?.liveSeconds ?? 0,
    sessionSeconds: session.durationMins * 60,
    // The recording's length comes from the session, never from the learner's
    // own row — that was the forgery.
    replayWatchedSeconds: replay
      ? replayWatchedSeconds(replay.buckets, session.recordingDurationSeconds ?? null)
      : 0,
    replayDurationSeconds: session.recordingDurationSeconds ?? null,
  });
}

/* ---------- Live: heartbeat while the class is running ---------- */

router.post("/sessions/:id/presence/heartbeat", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  // Not the lock check: see accessError. This runs every thirty seconds for
  // every learner in a live class, and the lock guards nothing it returns.
  const err = await accessError(user, session, false);
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

  // Nothing to watch means nothing to credit. Without this, a module that has
  // no recording at all could still be completed "on replay".
  if (!session.recordingUrl) {
    res.status(409).json({ error: "This module has no recording yet." });
    return;
  }

  const parsed = RecordReplayProgressBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // The recording's length is settled once for the whole cohort and then left
  // alone. It used to be taken from whoever was reporting, which meant a
  // learner could name their own denominator: "one second long, watched one
  // second" was a finished module and a certificate.
  const durationSeconds = settleRecordingLength({
    stored: session.recordingDurationSeconds,
    reported: parsed.data.durationSeconds,
    scheduledMins: session.durationMins,
  });
  if (durationSeconds !== session.recordingDurationSeconds && durationSeconds !== null) {
    await db
      .update(sessionsTable)
      .set({ recordingDurationSeconds: durationSeconds })
      // Only if it is still unset, so two first-viewers cannot overwrite
      // each other and the first plausible report genuinely wins.
      .where(and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.recordingDurationSeconds)));
  }

  // Read and write under a lock on the learner's own row. Two tabs — or one
  // tab retrying a slow request — used to read the same slices, merge into the
  // same starting point, and have the second write erase the first's watching.
  // The lock is on this learner's row alone, so it never blocks anybody else.
  const buckets = await db.transaction(async (tx) => {
    await tx.execute(sql`
      select id from ${replayProgressTable}
      where user_id = ${user.id} and session_id = ${sessionId}
      for update
    `);

    const [existing] = await tx
      .select()
      .from(replayProgressTable)
      .where(and(eq(replayProgressTable.userId, user.id), eq(replayProgressTable.sessionId, sessionId)));

    const merged = mergeReplayBuckets(existing?.buckets ?? [], parsed.data.buckets, durationSeconds);

    if (existing) {
      await tx
        .update(replayProgressTable)
        .set({ buckets: merged, durationSeconds })
        .where(eq(replayProgressTable.id, existing.id));
    } else {
      await tx
        .insert(replayProgressTable)
        .values({ userId: user.id, sessionId, buckets: merged, durationSeconds })
        .onConflictDoNothing();
    }
    return merged;
  });

  res.json({
    sessionId,
    watchedSeconds: replayWatchedSeconds(buckets, durationSeconds),
    durationSeconds,
    presence: await currentPresence(user.id, session),
  });
});

export default router;
