import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db, programsTable, sessionsTable, usersTable, enrollmentsTable,
  attendanceTable, replayProgressTable, assignmentsTable, assignmentSubmissionsTable,
  submissionReviewsTable, quizAttemptsTable,
} from "@workspace/db";
import {
  satisfiesRole, replayWatchedSeconds, auditFlags, auditNote, looksWiped, duplicateNote,
  readRecord, type AuditFlag, type AccountFacts, type LearnerAccount,
} from "@workspace/domain";
import { GetProgressAuditResponse, GetLearnerRecordResponse } from "@workspace/api-zod";
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

  /*
    Two accounts, one person.

    Everything above compares what is stored against what the Lab concludes.
    That cannot see a record that has gone — there is nothing left to disagree
    with, and a learner whose history vanished looks exactly like one who never
    did anything.

    But the commonest wipe deletes nothing. A signed-in person is found by
    their Clerk id and nothing else, and two rows may share an email because
    nothing forbids it. So a learner whose sign-in identity changes — most
    often after a change to how signing in works — arrives as somebody the Lab
    has never seen, with an empty record, while every minute they watched sits
    on the row they used to be.

    Read across the whole Lab rather than this programme, because the account
    holding the record may not be enrolled on anything any more.
  */
  /*
    Written out rather than built.

    The Drizzle version of this returned zero for every count, on accounts that
    demonstrably had work against them — the correlated subqueries did not bind
    to the outer row. Zero everywhere reads as "both accounts are empty", which
    makes `looksWiped` false, which reports no duplicates at all. An empty
    result that looks exactly like a clean answer is the one wrong answer this
    check must never give, so it is written as SQL that can be run by hand and
    checked against the same database.
  */
  const found = await db.execute<{
    user_id: number; email: string; created_at: Date;
    enrolled: number; attended: number; watched: number; filed: number; critiqued: number;
  }>(sql`
    WITH shared AS (
      SELECT lower(email) AS email FROM users
      WHERE email <> '' GROUP BY lower(email) HAVING count(*) > 1
    )
    SELECT u.id AS user_id, lower(u.email) AS email, u.created_at,
      (SELECT count(*) FROM enrollments e WHERE e.user_id = u.id)::int            AS enrolled,
      (SELECT count(*) FROM session_attendance a WHERE a.user_id = u.id)::int     AS attended,
      (SELECT count(*) FROM replay_progress r WHERE r.user_id = u.id)::int        AS watched,
      (SELECT count(*) FROM assignment_submissions s WHERE s.user_id = u.id)::int AS filed,
      (SELECT count(*) FROM submission_reviews v WHERE v.reviewer_id = u.id)::int AS critiqued
    FROM users u
    JOIN shared ON shared.email = lower(u.email)
    ORDER BY lower(u.email), u.created_at
  `);

  const byEmail = new Map<string, AccountFacts[]>();
  for (const row of (found.rows ?? []) as Record<string, unknown>[]) {
    const email = String(row.email);
    const list = byEmail.get(email) ?? [];
    list.push({
      userId: Number(row.user_id),
      createdOn: new Date(row.created_at as string).toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos",
      }),
      enrolledOnProgrammes: Number(row.enrolled),
      classesAttended: Number(row.attended),
      recordingsWatched: Number(row.watched),
      tasksFiled: Number(row.filed),
      critiquesWritten: Number(row.critiqued),
    });
    byEmail.set(email, list);
  }

  const duplicates: { email: string; note: string; accounts: AccountFacts[] }[] = [];
  for (const [email, accounts] of byEmail) {
    if (looksWiped(accounts)) {
      duplicates.push({ email, note: duplicateNote(email, accounts), accounts });
    }
  }

  res.json(GetProgressAuditResponse.parse({
    programmeTitle: programme.title,
    duplicates,
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

/**
 * Where one learner's record actually is.
 *
 * The cohort audit answers "is what is stored being counted correctly". This
 * answers the question somebody actually asks when a learner says their work
 * has gone: is it there at all, and if so, under what.
 *
 * Across the whole Lab rather than one programme, because the account holding
 * a record may not be enrolled on anything any more — which is itself one of
 * the answers. And with no assumption about the shape of the trouble: two
 * accounts, one empty account, a record with no enrolment all look identical
 * to the learner and need different answers, and guessing which before looking
 * is how this went wrong three times.
 *
 * Reads only, and reads no work — counts and minutes, never a body.
 */
router.get("/admin/learner-record", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!satisfiesRole(user.role, ["admin"])) {
    res.status(403).json({ error: "Only admins can look up a record" }); return;
  }

  const email = String(req.query.email ?? "").trim().toLowerCase();
  if (!email) { res.status(400).json({ error: "Give an email address to look up" }); return; }

  const found = await db.execute<Record<string, unknown>>(sql`
    SELECT u.id AS user_id, u.name, u.role, u.created_at,
      (SELECT count(*) FROM enrollments e WHERE e.user_id = u.id)::int              AS enrolled,
      (SELECT count(*) FROM session_attendance a WHERE a.user_id = u.id)::int       AS attended,
      (SELECT coalesce(sum(a.live_seconds), 0) FROM session_attendance a WHERE a.user_id = u.id)::int
                                                                                     AS live_seconds,
      (SELECT count(*) FROM replay_progress r WHERE r.user_id = u.id)::int          AS watched,
      (SELECT coalesce(sum(jsonb_array_length(r.buckets)), 0) * 15
         FROM replay_progress r WHERE r.user_id = u.id)::int                        AS watched_seconds,
      (SELECT count(*) FROM assignment_submissions s WHERE s.user_id = u.id)::int   AS filed,
      (SELECT count(*) FROM assignment_submissions s
         WHERE s.user_id = u.id AND s.withdrawn_at IS NOT NULL)::int                AS withdrawn,
      (SELECT count(*) FROM submission_reviews v WHERE v.reviewer_id = u.id)::int   AS critiqued,
      (SELECT count(*) FROM submission_reviews v
         JOIN assignment_submissions s2 ON s2.id = v.submission_id
        WHERE s2.user_id = u.id)::int                                               AS received
    FROM users u
    WHERE lower(u.email) = ${email}
    ORDER BY u.created_at
  `);

  const rows = (found.rows ?? []) as Record<string, unknown>[];
  const accounts: LearnerAccount[] = [];
  for (const row of rows) {
    const userId = Number(row.user_id);
    const enrolments = await db
      .select({ programmeTitle: programsTable.title, status: enrollmentsTable.status })
      .from(enrollmentsTable)
      .innerJoin(programsTable, eq(programsTable.id, enrollmentsTable.programId))
      .where(eq(enrollmentsTable.userId, userId));
    const made = new Date(row.created_at as string);
    accounts.push({
      userId,
      name: String(row.name ?? "").trim() || "Unnamed",
      role: String(row.role ?? "learner"),
      // To the minute, because a learner reporting "it went about one o'clock"
      // is giving you the one fact that identifies the account they landed on.
      createdAt: made.toLocaleString("en-GB", {
        day: "numeric", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos",
      }),
      createdOn: made.toLocaleDateString("en-GB", {
        day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos",
      }),
      enrolledOnProgrammes: Number(row.enrolled),
      classesAttended: Number(row.attended),
      recordingsWatched: Number(row.watched),
      tasksFiled: Number(row.filed),
      critiquesWritten: Number(row.critiqued),
      critiquesReceived: Number(row.received),
      minutesWatched: Math.round(Number(row.watched_seconds) / 60),
      minutesInClass: Math.round(Number(row.live_seconds) / 60),
      withdrawnTasks: Number(row.withdrawn),
      // Carried for the screen; the verdict above does not read it.
      ...({ enrolments } as object),
    } as LearnerAccount);
  }

  const { verdict, note } = readRecord(accounts);
  res.json(GetLearnerRecordResponse.parse({ email, verdict, note, accounts }));
});

export default router;
