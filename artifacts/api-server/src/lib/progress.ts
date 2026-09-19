import {
  db, attendanceTable, replayProgressTable, enrollmentsTable, sessionsTable, programsTable,
  quizQuestionsTable, quizAttemptsTable, assignmentsTable, assignmentSubmissionsTable,
  submissionReviewsTable, deadlineExtensionsTable, studioInvitationsTable,
  studioGroupSessionsTable, simulationGroupAssignmentsTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  computeProgress,
  replayWatchedSeconds,
  EMPTY_COURSEWORK,
  EMPTY_PRESENCE,
  type CourseworkStatus,
  type PresenceInput,
  type ProgressEntry,
  type Progression,
  type ModuleKind,
  weeksOfSessions,
  effectiveDueAt,
} from "@workspace/domain";

export type { ProgressEntry };

/**
 * Load everything `computeProgress` needs for one learner and run it.
 *
 * The rules themselves live in @workspace/domain so they are unit-testable
 * without a database and so the client can reason about the same shape.
 */
export async function progressForUser(userId: number, programIds: number[]): Promise<ProgressEntry[]> {
  if (programIds.length === 0) return [];

  const sessions = await db
    .select({
      id: sessionsTable.id,
      programId: sessionsTable.programId,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      sortOrder: sessionsTable.sortOrder,
      title: sessionsTable.title,
      kind: sessionsTable.kind,
      quizDueAt: sessionsTable.quizDueAt,
    })
    .from(sessionsTable)
    .where(inArray(sessionsTable.programId, programIds));

  // How each programme advances. Only a programme explicitly set to "week"
  // behaves differently; everything else takes the original module-by-module
  // rule, which is also what an unreadable value falls back to.
  const programmes = await db
    .select({ id: programsTable.id, progression: programsTable.progression })
    .from(programsTable)
    .where(inArray(programsTable.id, programIds));
  const progressionByProgram = new Map<number, Progression>(
    programmes.map((p) => [p.id, p.progression === "week" ? "week" : "module"]),
  );
  const weekOfSession = weeksOfSessions(sessions);

  // `.concat(-1)` keeps the IN clause non-empty for programs with no sessions.
  const sessionIds = sessions.map((s) => s.id).concat(-1);

  const [att, replay, enrollRows, quizSessions, bestAttempts, assignments, submissions, reviewsGiven, reviewsReceived, peers, extensions, studioInvites, groupSessions] =
    await Promise.all([
      db
        .select()
        .from(attendanceTable)
        .where(and(eq(attendanceTable.userId, userId), inArray(attendanceTable.sessionId, sessionIds))),
      db
        .select()
        .from(replayProgressTable)
        .where(and(eq(replayProgressTable.userId, userId), inArray(replayProgressTable.sessionId, sessionIds))),
      db
        .select({
          programId: enrollmentsTable.programId,
          createdAt: enrollmentsTable.createdAt,
          // When they were actually let in, which for anybody promoted off the
          // waitlist is not when their row was written.
          startedAt: enrollmentsTable.startedAt,
        })
        .from(enrollmentsTable)
        .where(and(eq(enrollmentsTable.userId, userId), inArray(enrollmentsTable.programId, programIds))),
      // Drafts are excluded on purpose, and this is the most important word in
      // this file. Completing a module needs its quiz and its task, and the
      // next module waits on this one — so a quiz somebody saved but never
      // posted would quietly wall the whole cohort in, with nothing on screen
      // to explain it.
      db
        .selectDistinct({ sessionId: quizQuestionsTable.sessionId })
        .from(quizQuestionsTable)
        .innerJoin(sessionsTable, eq(sessionsTable.id, quizQuestionsTable.sessionId))
        .where(and(
          inArray(quizQuestionsTable.sessionId, sessionIds),
          eq(sessionsTable.quizDraft, false),
        )),
      db
        .select({ sessionId: quizAttemptsTable.sessionId, best: sql<number>`max(${quizAttemptsTable.scorePct})::int` })
        .from(quizAttemptsTable)
        .where(and(eq(quizAttemptsTable.userId, userId), inArray(quizAttemptsTable.sessionId, sessionIds)))
        .groupBy(quizAttemptsTable.sessionId),
      db
        .select({
          sessionId: assignmentsTable.sessionId,
          reviewsRequired: assignmentsTable.reviewsRequired,
          dueAt: assignmentsTable.dueAt,
        })
        .from(assignmentsTable)
        // As above: an unposted task must not be able to lock a programme.
        .where(and(
          inArray(assignmentsTable.sessionId, sessionIds),
          eq(assignmentsTable.draft, false),
        )),
      db
        .select({
          sessionId: assignmentSubmissionsTable.sessionId,
          id: assignmentSubmissionsTable.id,
          reviewsRequiredAtSubmission: assignmentSubmissionsTable.reviewsRequiredAtSubmission,
        })
        .from(assignmentSubmissionsTable)
        .where(and(
          eq(assignmentSubmissionsTable.userId, userId),
          inArray(assignmentSubmissionsTable.sessionId, sessionIds),
        )),
      // Critiques this learner has written, per module.
      db
        .select({ sessionId: submissionReviewsTable.sessionId, count: sql<number>`count(*)::int` })
        .from(submissionReviewsTable)
        .where(and(
          eq(submissionReviewsTable.reviewerId, userId),
          inArray(submissionReviewsTable.sessionId, sessionIds),
        ))
        .groupBy(submissionReviewsTable.sessionId),
      // Critiques this learner's own work has received, per module.
      db
        .select({ sessionId: assignmentSubmissionsTable.sessionId, count: sql<number>`count(${submissionReviewsTable.id})::int` })
        .from(assignmentSubmissionsTable)
        .leftJoin(submissionReviewsTable, eq(submissionReviewsTable.submissionId, assignmentSubmissionsTable.id))
        .where(and(
          eq(assignmentSubmissionsTable.userId, userId),
          inArray(assignmentSubmissionsTable.sessionId, sessionIds),
        ))
        .groupBy(assignmentSubmissionsTable.sessionId),
      // How many *other* people filed work on each module. This is the ceiling
      // on how many critiques anybody can possibly write, and without it a
      // cohort too small to supply reviewers strands everyone in it for good.
      db
        .select({
          sessionId: assignmentSubmissionsTable.sessionId,
          count: sql<number>`count(*) filter (where ${assignmentSubmissionsTable.userId} <> ${userId})::int`,
        })
        .from(assignmentSubmissionsTable)
        .where(inArray(assignmentSubmissionsTable.sessionId, sessionIds))
        .groupBy(assignmentSubmissionsTable.sessionId),
      // Deadlines an admin has moved for this learner alone.
      db
        .select({
          sessionId: deadlineExtensionsTable.sessionId,
          dueAt: deadlineExtensionsTable.dueAt,
        })
        .from(deadlineExtensionsTable)
        .where(and(
          eq(deadlineExtensionsTable.userId, userId),
          inArray(deadlineExtensionsTable.sessionId, sessionIds),
        )),
      /*
        The Studio exercises this learner has been sent, per module.

        `sessionId` on an invitation has always been a note of what prompted
        it. It becomes the link itself only where the module it points at is a
        simulation module — every ordinary class keeps reading it as a note, so
        an invitation sent months ago cannot suddenly shut a module.

        Unstarted and abandoned invitations are here too, with completedAt
        empty. That is the point: it is the invitation that says the work was
        asked for, and its completion that says the work was done.
      */
      db
        .select({
          sessionId: studioInvitationsTable.sessionId,
          completedAt: studioInvitationsTable.completedAt,
        })
        .from(studioInvitationsTable)
        .where(and(
          eq(studioInvitationsTable.userId, userId),
          inArray(studioInvitationsTable.sessionId, sessionIds),
        )),
      /*
        The group sessions filed against a module, and whether this learner
        walked into them.

        A group session has no invitation — the cohort is the room — so it
        cannot be read the same way as a solo exercise. What it has is an
        assignment per enrolled learner, made when the session starts, and a
        stamp on that assignment for when they actually arrived.

        Turning up is the work. The exercise runs on a clock whether a team
        answers or not, so being in the room is the whole of what can honestly
        be asked of somebody — the same bar a live class sets, measured the
        only way this room can measure it.

        Only approved sessions count. A draft is a scenario nobody has read
        yet, and it must not be able to shut a module.
      */
      db
        .select({
          sessionId: studioGroupSessionsTable.sessionId,
          enteredAt: simulationGroupAssignmentsTable.enteredAt,
        })
        .from(studioGroupSessionsTable)
        .leftJoin(simulationGroupAssignmentsTable, and(
          eq(simulationGroupAssignmentsTable.runId, studioGroupSessionsTable.runId),
          eq(simulationGroupAssignmentsTable.userId, userId),
        ))
        .where(and(
          inArray(studioGroupSessionsTable.sessionId, sessionIds),
          sql`${studioGroupSessionsTable.approvedAt} is not null`,
        )),
    ]);

  const attendance = new Map(att.map((a) => [a.sessionId, a.joinedAt]));

  // Presence has two possible sources per module; computeProgress fills in the
  // scheduled length and decides which route carries the learner.
  const liveBySession = new Map(att.map((a) => [a.sessionId, a.liveSeconds]));
  // Attendance credited without measurement — see the column's note. It says
  // "we could not measure this", which is why it travels separately from the
  // seconds rather than being faked as a number of them.
  const waivedBySession = new Set(att.filter((a) => a.presenceWaivedAt).map((a) => a.sessionId));
  const replayBySession = new Map(replay.map((r) => [r.sessionId, r]));
  const presenceBySession = new Map<number, PresenceInput>(
    sessions.map((s) => {
      const r = replayBySession.get(s.id);
      return [
        s.id,
        {
          ...EMPTY_PRESENCE,
          waived: waivedBySession.has(s.id),
          liveSeconds: liveBySession.get(s.id) ?? 0,
          replayWatchedSeconds: r ? replayWatchedSeconds(r.buckets, r.durationSeconds) : 0,
          replayDurationSeconds: r?.durationSeconds ?? null,
        },
      ];
    }),
  );
  // When they actually started. `startedAt` is empty on every row written
  // before the distinction existed, and on those `createdAt` is the same thing.
  const enrolledAtByProgram = new Map(
    enrollRows.map((e) => [e.programId, e.startedAt ?? e.createdAt]),
  );
  const quizSet = new Set(quizSessions.map((q) => q.sessionId));
  const bestBySession = new Map(bestAttempts.map((a) => [a.sessionId, a.best]));
  const reviewsRequiredBySession = new Map(assignments.map((a) => [a.sessionId, a.reviewsRequired]));
  const assignmentDueBySession = new Map(assignments.map((a) => [a.sessionId, a.dueAt]));
  const quizDueBySession = new Map(sessions.map((s) => [s.id, s.quizDueAt]));
  // Deadlines an admin has moved for this learner. Applied here so the date on
  // their own dashboard is the one the doors will actually check — being shown
  // a deadline that passed while the work is in fact open is how somebody
  // decides not to bother.
  const extendedBySession = new Map(extensions.map((e) => [e.sessionId, e.dueAt.toISOString()]));
  const submittedSet = new Set(submissions.map((s) => s.sessionId));
  // What each learner was actually asked for when they filed. Raising the
  // number afterwards must not reach back and un-complete their module.
  const askedAtSubmission = new Map(
    submissions
      .filter((s) => s.reviewsRequiredAtSubmission !== null)
      .map((s) => [s.sessionId, s.reviewsRequiredAtSubmission as number]),
  );
  const givenBySession = new Map(reviewsGiven.map((r) => [r.sessionId, r.count]));
  const receivedBySession = new Map(reviewsReceived.map((r) => [r.sessionId, r.count]));
  const peersBySession = new Map(peers.map((r) => [r.sessionId, r.count]));
  // Only a simulation module's exercise counts. A learner sent one that was
  // filed against an ordinary class has been given practice, not a gate.
  const simulationModules = new Set(
    sessions.filter((s) => s.kind === "simulation").map((s) => s.id),
  );
  const exerciseBySession = new Map<number, { done: boolean }>();
  for (const invite of studioInvites) {
    if (invite.sessionId === null || !simulationModules.has(invite.sessionId)) continue;
    const already = exerciseBySession.get(invite.sessionId);
    // Somebody re-sent an exercise after missing the first is done once any of
    // them is done.
    exerciseBySession.set(invite.sessionId, {
      done: (already?.done ?? false) || invite.completedAt !== null,
    });
  }
  // The same two answers for a group session: it was asked of them, and they
  // turned up to it.
  for (const room of groupSessions) {
    if (room.sessionId === null || !simulationModules.has(room.sessionId)) continue;
    const already = exerciseBySession.get(room.sessionId);
    exerciseBySession.set(room.sessionId, {
      done: (already?.done ?? false) || room.enteredAt !== null,
    });
  }

  const coursework = new Map<number, CourseworkStatus>(
    sessions.map((s) => [
      s.id,
      {
        ...EMPTY_COURSEWORK,
        hasQuiz: quizSet.has(s.id),
        quizBestScore: bestBySession.get(s.id) ?? null,
        hasAssignment: reviewsRequiredBySession.has(s.id),
        assignmentSubmitted: submittedSet.has(s.id),
        reviewsRequired: askedAtSubmission.get(s.id) ?? reviewsRequiredBySession.get(s.id) ?? 0,
        reviewsGiven: givenBySession.get(s.id) ?? 0,
        reviewsReceived: receivedBySession.get(s.id) ?? 0,
        peersToReview: peersBySession.get(s.id) ?? 0,
        hasSimulation: exerciseBySession.has(s.id),
        simulationDone: exerciseBySession.get(s.id)?.done ?? false,
        // Deadlines ride along so the dashboard can show what is due without
        // opening every quiz and task in turn. They change no rule below.
        quizDueAt: effectiveDueAt(
          quizDueBySession.get(s.id)?.toISOString() ?? null,
          extendedBySession.get(s.id) ?? null,
        ),
        assignmentDueAt: effectiveDueAt(
          assignmentDueBySession.get(s.id)?.toISOString() ?? null,
          extendedBySession.get(s.id) ?? null,
        ),
      },
    ]),
  );

  return computeProgress(
    // An unreadable value falls back to a class, which is what every module
    // written before simulation modules existed is.
    sessions.map((s) => ({ ...s, kind: (s.kind === "simulation" ? "simulation" : "class") as ModuleKind })),
    attendance, enrolledAtByProgram, coursework, presenceBySession, Date.now(),
    { progressionByProgram, weekOfSession },
  );
}

export async function enrolledProgramIds(userId: number): Promise<number[]> {
  const enrolled = await db
    .select({ programId: enrollmentsTable.programId })
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, userId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
  return enrolled.map((e) => e.programId);
}
