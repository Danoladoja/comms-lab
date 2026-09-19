import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db, programsTable, sessionsTable, usersTable, enrollmentsTable,
  attendanceTable, replayProgressTable, assignmentsTable, assignmentSubmissionsTable,
  submissionReviewsTable, quizAttemptsTable,
} from "@workspace/db";
import {
  satisfiesRole, replayWatchedSeconds, auditFlags, auditNote, type AuditFlag,
} from "@workspace/domain";
import { GetProgressAuditResponse } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { progressForUser } from "../lib/progress";

const router: IRouter = Router();

/**
 * What is recorded against each learner, beside what the Lab says about it.
 *
 * Every number on a learner's dashboard is worked out from stored rows at the
 * moment it is asked for. That is the right design — there is one answer and it
 * cannot go stale — but it means a fault in the working appears as a wrong
 * verdict with no trace of how it got there, and the only honest reply to "is
 * my replay being counted?" was "it should be".
 *
 * So the two sides are read separately and shown together. The left is the raw
 * rows: seconds of heartbeat, buckets of recording covered, a submission or
 * not, critiques written. The right is `progressForUser` — the very same
 * function the learner's own dashboard calls, deliberately, because an audit
 * that reimplemented the rules would agree with itself and prove nothing.
 *
 * It reads and writes nothing. An audit that repairs as it goes cannot be run
 * twice.
 */
router.get("/admin/programs/:programId/progress-audit", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!satisfiesRole(user.role, ["admin"])) {
    res.status(403).json({ error: "Only admins can read the audit" }); return;
  }

  const programId = Number(req.params.programId);
  if (!Number.isInteger(programId) || programId < 1) {
    res.status(400).json({ error: "That is not a programme" }); return;
  }
  const [programme] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (!programme) { res.status(404).json({ error: "Programme not found" }); return; }

  const modules = await db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      kind: sessionsTable.kind,
      recordingUrl: sessionsTable.recordingUrl,
      recordingDurationSeconds: sessionsTable.recordingDurationSeconds,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.programId, programId))
    .orderBy(asc(sessionsTable.startsAt), asc(sessionsTable.sortOrder), asc(sessionsTable.id));
  const sessionIds = modules.map((m) => m.id).concat(-1);

  const learners = await db
    .select({ userId: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
    .where(and(
      eq(enrollmentsTable.programId, programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ))
    .orderBy(asc(usersTable.name));

  // The raw rows, for the whole cohort at once. Read directly rather than
  // through anything that already has an opinion about them.
  const [attendance, replay, published, submissions, given, received, quizzes] = await Promise.all([
    db.select({ userId: attendanceTable.userId, sessionId: attendanceTable.sessionId, liveSeconds: attendanceTable.liveSeconds })
      .from(attendanceTable).where(inArray(attendanceTable.sessionId, sessionIds)),
    db.select().from(replayProgressTable).where(inArray(replayProgressTable.sessionId, sessionIds)),
    db.select({ sessionId: assignmentsTable.sessionId })
      .from(assignmentsTable)
      .where(and(inArray(assignmentsTable.sessionId, sessionIds), eq(assignmentsTable.draft, false))),
    db.select({
      userId: assignmentSubmissionsTable.userId,
      sessionId: assignmentSubmissionsTable.sessionId,
      id: assignmentSubmissionsTable.id,
      withdrawnAt: assignmentSubmissionsTable.withdrawnAt,
      // The length rather than the words. A learner's work is theirs, and this
      // screen has no business showing it to answer a question about whether
      // it is there at all.
      bodyLength: sql<number>`length(${assignmentSubmissionsTable.body})::int`,
    }).from(assignmentSubmissionsTable).where(inArray(assignmentSubmissionsTable.sessionId, sessionIds)),
    db.select({
      userId: submissionReviewsTable.reviewerId,
      sessionId: submissionReviewsTable.sessionId,
      count: sql<number>`count(*)::int`,
    }).from(submissionReviewsTable)
      .where(inArray(submissionReviewsTable.sessionId, sessionIds))
      .groupBy(submissionReviewsTable.reviewerId, submissionReviewsTable.sessionId),
    db.select({
      userId: assignmentSubmissionsTable.userId,
      sessionId: assignmentSubmissionsTable.sessionId,
      count: sql<number>`count(${submissionReviewsTable.id})::int`,
    }).from(assignmentSubmissionsTable)
      .leftJoin(submissionReviewsTable, eq(submissionReviewsTable.submissionId, assignmentSubmissionsTable.id))
      .where(inArray(assignmentSubmissionsTable.sessionId, sessionIds))
      .groupBy(assignmentSubmissionsTable.userId, assignmentSubmissionsTable.sessionId),
    db.select({
      userId: quizAttemptsTable.userId,
      sessionId: quizAttemptsTable.sessionId,
      best: sql<number>`max(${quizAttemptsTable.scorePct})::int`,
    }).from(quizAttemptsTable)
      .where(inArray(quizAttemptsTable.sessionId, sessionIds))
      .groupBy(quizAttemptsTable.userId, quizAttemptsTable.sessionId),
  ]);

  const key = (userId: number, sessionId: number) => `${userId}:${sessionId}`;
  const liveBy = new Map(attendance.map((a) => [key(a.userId, a.sessionId), a.liveSeconds]));
  const replayBy = new Map(replay.map((r) => [key(r.userId, r.sessionId), r]));
  const publishedTask = new Set(published.map((a) => a.sessionId));
  const submissionBy = new Map(submissions.map((s) => [key(s.userId, s.sessionId), s]));
  const givenBy = new Map(given.map((g) => [key(g.userId, g.sessionId), g.count]));
  const receivedBy = new Map(received.map((r) => [key(r.userId, r.sessionId), r.count]));
  const quizBy = new Map(quizzes.map((q) => [key(q.userId, q.sessionId), q.best]));
  const moduleById = new Map(modules.map((m) => [m.id, m]));

  const minutes = (seconds: number | null | undefined) =>
    seconds === null || seconds === undefined ? null : Math.round(seconds / 60);

  /*
    The Lab's own verdict, from the Lab's own function.

    Per learner, which is a query or so each. This is an admin screen read a
    handful of times, and reimplementing the rules here to make it one query
    would produce an audit that agrees with itself and proves nothing. Run a
    few at a time so a cohort of fifty does not open fifty connections at once.
  */
  const verdicts = new Map<number, Awaited<ReturnType<typeof progressForUser>>>();
  for (let i = 0; i < learners.length; i += 5) {
    const batch = learners.slice(i, i + 5);
    const results = await Promise.all(batch.map((l) => progressForUser(l.userId, [programId])));
    batch.forEach((l, n) => verdicts.set(l.userId, results[n]));
  }

  const allFlags: { flags: AuditFlag[] }[] = [];
  const rows = learners.map((learner) => {
    const verdict = verdicts.get(learner.userId) ?? [];
    const learnerRows = modules.map((mod) => {
      const k = key(learner.userId, mod.id);
      const entry = verdict.find((e) => e.sessionId === mod.id);
      const replayRow = replayBy.get(k);
      const watchedSeconds = replayRow
        ? replayWatchedSeconds(
          replayRow.buckets,
          mod.recordingDurationSeconds ?? replayRow.durationSeconds,
        )
        : 0;

      const flags = auditFlags({
        hasRecording: !!mod.recordingUrl,
        moduleRecordingSeconds: mod.recordingDurationSeconds ?? null,
        learnerRecordingSeconds: replayRow?.durationSeconds ?? null,
        watchedSeconds,
        presenceMet: entry?.presence?.met ?? false,
        liveSeconds: liveBy.get(k) ?? 0,
        hasAssignment: publishedTask.has(mod.id),
        hasSubmission: submissionBy.has(k),
        withdrawn: !!submissionBy.get(k)?.withdrawnAt,
        withdrawnOn: submissionBy.get(k)?.withdrawnAt
          ? submissionBy.get(k)!.withdrawnAt!.toLocaleDateString("en-GB", {
            day: "numeric", month: "short", timeZone: "Africa/Lagos",
          })
          : null,
        bodyLength: submissionBy.get(k)?.bodyLength ?? 0,
        critiquesGiven: givenBy.get(k) ?? 0,
        reviewsRequired: entry?.reviewsRequired ?? 0,
        reviewsCleared: entry?.reviewsCleared ?? null,
        hasQuiz: entry?.hasQuiz ?? false,
        quizBestScore: quizBy.get(k) ?? null,
        quizPassed: entry?.quizPassed ?? false,
        completed: entry?.completed ?? false,
      });
      allFlags.push({ flags });

      return {
        sessionId: mod.id,
        liveMinutes: Math.round((liveBy.get(k) ?? 0) / 60),
        watchedMinutes: Math.round(watchedSeconds / 60),
        learnerRecordingMinutes: minutes(replayRow?.durationSeconds),
        hasSubmission: submissionBy.has(k),
        withdrawn: !!submissionBy.get(k)?.withdrawnAt,
        critiquesGiven: givenBy.get(k) ?? 0,
        critiquesReceived: receivedBy.get(k) ?? 0,
        quizBestScore: quizBy.get(k) ?? null,
        progressPct: entry?.progressPct ?? 0,
        completed: entry?.completed ?? false,
        locked: entry?.locked ?? false,
        presenceMet: entry?.presence?.met ?? false,
        reviewsRequired: entry?.reviewsRequired ?? 0,
        reviewsCleared: entry?.reviewsCleared ?? null,
        flags,
      };
    });

    return {
      userId: learner.userId,
      name: (learner.name ?? "").trim() || learner.email || "Unnamed",
      email: learner.email ?? "",
      flagged: learnerRows.filter((r) => r.flags.length > 0).length,
      rows: learnerRows,
    };
  });

  res.json(GetProgressAuditResponse.parse({
    programmeTitle: programme.title,
    note: auditNote(allFlags, learners.length),
    modules: modules.map((m) => ({
      id: m.id,
      title: m.title,
      kind: m.kind,
      recordingMinutes: minutes(m.recordingDurationSeconds),
    })),
    // The ones with something to answer for first. Nobody opens an audit to
    // read the clean rows.
    learners: [...rows].sort((a, b) => b.flagged - a.flagged || a.name.localeCompare(b.name)),
  }));
});

export default router;
