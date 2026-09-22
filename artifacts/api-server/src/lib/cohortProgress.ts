import {
  db, attendanceTable, replayProgressTable, enrollmentsTable, sessionsTable, programsTable,
  quizQuestionsTable, quizAttemptsTable, assignmentsTable, assignmentSubmissionsTable,
  submissionReviewsTable, deadlineExtensionsTable, usersTable, studioInvitationsTable,
  studioGroupSessionsTable, simulationGroupAssignmentsTable, moduleUnlocksTable,
} from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  computeProgress,
  replayWatchedSeconds,
  EMPTY_COURSEWORK,
  EMPTY_PRESENCE,
  effectiveDueAt,
  weeksOfSessions,
  cohortSnapshot,
  type CourseworkStatus,
  type PresenceInput,
  type Progression,
  type ModuleKind,
  type CohortModule,
  type CohortLearner,
  type CohortSnapshot,
} from "@workspace/domain";

/**
 * Every learner on a programme, through the same function as each of them
 * individually.
 *
 * The temptation here is a clever aggregate query — count the submissions per
 * module, count the passes, divide. It would be shorter and it would be wrong
 * within a month, because "complete" is not a count: it is attendance by either
 * route, plus a quiz at the pass mark, plus a task, plus the critiques that task
 * asked for at the moment it was filed, minus anything that ran before the
 * learner joined, and every one of those has been changed at least once. A
 * second implementation of that would agree with the first until the day
 * somebody edited one of them, and the first sign of the disagreement would be
 * a learner insisting the admin's screen is wrong about their own work.
 *
 * So this loads the same tables the single-learner loader does, without the
 * `userId =` filter, groups them by learner in memory, and calls
 * `computeProgress` once per person. Forty-five learners over eight modules is
 * thirteen queries and forty-five pure function calls — cheaper than the round
 * trips it replaces, and incapable of disagreeing with the dashboard.
 *
 * "Incapable of disagreeing" was too strong, and it is worth saying where it
 * broke rather than quietly correcting it. Sharing `computeProgress` only
 * guarantees the two screens apply the same rules; it guarantees nothing about
 * their being given the same facts. When simulation modules arrived, the
 * learner's loader learned to read a module's kind, the Studio exercises sent
 * to somebody, and who walked into a group session — and this one did not. The
 * rules then ran correctly here on an incomplete account: every simulation
 * module read as an ordinary class, so the admin's screen asked forty-five
 * people for a lecture nobody had scheduled and reported them all absent from
 * work they had in fact done.
 *
 * Which is the same failure the paragraph above is about, one level down. The
 * guard against it is the test beside this file: it runs both loaders over one
 * database and fails if they ever disagree about anybody.
 */
export async function cohortProgressFor(programId: number): Promise<{
  programme: { id: number; title: string };
  modules: CohortModule[];
  snapshot: CohortSnapshot;
  /**
   * Each learner with their raw entries, for callers that need a detail the
   * snapshot rolls up — the extensions panel wants "attended, quiz passed, task
   * submitted, critiques given" as four separate facts about one module.
   *
   * Handed out rather than recomputed for the same reason the snapshot exists:
   * a second pass over the same tables would be a second opinion.
   */
  learners: CohortLearner[];
} | null> {
  const [programme] = await db
    .select({ id: programsTable.id, title: programsTable.title, progression: programsTable.progression })
    .from(programsTable)
    .where(eq(programsTable.id, programId));
  if (!programme) return null;

  const sessions = await db
    .select({
      id: sessionsTable.id,
      programId: sessionsTable.programId,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      sortOrder: sessionsTable.sortOrder,
      title: sessionsTable.title,
      kind: sessionsTable.kind,
      recordingDurationSeconds: sessionsTable.recordingDurationSeconds,
      quizDueAt: sessionsTable.quizDueAt,
      quizDraft: sessionsTable.quizDraft,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.programId, programId));

  const roster = await db
    .select({
      userId: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      createdAt: enrollmentsTable.createdAt,
      startedAt: enrollmentsTable.startedAt,
    })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
    .where(and(
      eq(enrollmentsTable.programId, programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ))
    .orderBy(asc(usersTable.name));

  // Keep every IN clause non-empty: a programme with no classes yet, or none
  // with anybody on it, must render an empty tracker rather than a 500.
  const sessionIds = sessions.map((s) => s.id).concat(-1);
  const userIds = roster.map((r) => r.userId).concat(-1);

  const [att, replay, quizSessions, bestAttempts, assignments, submissions, reviewsGiven, reviewsReceived, extensions, studioInvites, groupArrivals, unlocks] =
    await Promise.all([
      db.select().from(attendanceTable).where(and(
        inArray(attendanceTable.sessionId, sessionIds),
        inArray(attendanceTable.userId, userIds),
      )),
      db.select().from(replayProgressTable).where(and(
        inArray(replayProgressTable.sessionId, sessionIds),
        inArray(replayProgressTable.userId, userIds),
      )),
      // Drafts excluded, exactly as the learner's own loader excludes them. A
      // quiz nobody has posted is not work anybody is behind on.
      db
        .selectDistinct({ sessionId: quizQuestionsTable.sessionId })
        .from(quizQuestionsTable)
        .innerJoin(sessionsTable, eq(sessionsTable.id, quizQuestionsTable.sessionId))
        .where(and(inArray(quizQuestionsTable.sessionId, sessionIds), eq(sessionsTable.quizDraft, false))),
      db
        .select({
          userId: quizAttemptsTable.userId,
          sessionId: quizAttemptsTable.sessionId,
          best: sql<number>`max(${quizAttemptsTable.scorePct})::int`,
        })
        .from(quizAttemptsTable)
        .where(and(
          inArray(quizAttemptsTable.sessionId, sessionIds),
          inArray(quizAttemptsTable.userId, userIds),
        ))
        .groupBy(quizAttemptsTable.userId, quizAttemptsTable.sessionId),
      db
        .select({
          sessionId: assignmentsTable.sessionId,
          reviewsRequired: assignmentsTable.reviewsRequired,
          dueAt: assignmentsTable.dueAt,
        })
        .from(assignmentsTable)
        .where(and(inArray(assignmentsTable.sessionId, sessionIds), eq(assignmentsTable.draft, false))),
      db
        .select({
          userId: assignmentSubmissionsTable.userId,
          sessionId: assignmentSubmissionsTable.sessionId,
          submittedAt: assignmentSubmissionsTable.submittedAt,
          reviewsRequiredAtSubmission: assignmentSubmissionsTable.reviewsRequiredAtSubmission,
          reviewsClearedRequired: assignmentSubmissionsTable.reviewsClearedRequired,
        })
        .from(assignmentSubmissionsTable)
        .where(inArray(assignmentSubmissionsTable.sessionId, sessionIds)),
      db
        .select({
          reviewerId: submissionReviewsTable.reviewerId,
          sessionId: submissionReviewsTable.sessionId,
          count: sql<number>`count(*)::int`,
        })
        .from(submissionReviewsTable)
        .where(inArray(submissionReviewsTable.sessionId, sessionIds))
        .groupBy(submissionReviewsTable.reviewerId, submissionReviewsTable.sessionId),
      db
        .select({
          userId: assignmentSubmissionsTable.userId,
          sessionId: assignmentSubmissionsTable.sessionId,
          count: sql<number>`count(${submissionReviewsTable.id})::int`,
        })
        .from(assignmentSubmissionsTable)
        .leftJoin(submissionReviewsTable, eq(submissionReviewsTable.submissionId, assignmentSubmissionsTable.id))
        .where(inArray(assignmentSubmissionsTable.sessionId, sessionIds))
        .groupBy(assignmentSubmissionsTable.userId, assignmentSubmissionsTable.sessionId),
      db
        .select({
          userId: deadlineExtensionsTable.userId,
          sessionId: deadlineExtensionsTable.sessionId,
          dueAt: deadlineExtensionsTable.dueAt,
        })
        .from(deadlineExtensionsTable)
        .where(and(
          inArray(deadlineExtensionsTable.sessionId, sessionIds),
          inArray(deadlineExtensionsTable.userId, userIds),
        )),
      // The Studio exercises sent to anybody on this cohort, and whether each
      // was finished. Read exactly as the single-learner loader reads them —
      // the long note on why an invitation's module only counts on a
      // simulation module is in ./progress.ts and is not worth saying twice.
      db
        .select({
          userId: studioInvitationsTable.userId,
          sessionId: studioInvitationsTable.sessionId,
          completedAt: studioInvitationsTable.completedAt,
        })
        .from(studioInvitationsTable)
        .where(and(
          inArray(studioInvitationsTable.userId, userIds),
          inArray(studioInvitationsTable.sessionId, sessionIds),
        )),
      // The approved group sessions filed against a module, and who walked in.
      //
      // Left-joined rather than inner-joined so a module keeps its group
      // session in the answer even where nobody has arrived yet: the session
      // existing is what makes the exercise something the module asks for, and
      // an empty `enteredAt` is the honest record of somebody who never came.
      db
        .select({
          sessionId: studioGroupSessionsTable.sessionId,
          userId: simulationGroupAssignmentsTable.userId,
          enteredAt: simulationGroupAssignmentsTable.enteredAt,
        })
        .from(studioGroupSessionsTable)
        .leftJoin(simulationGroupAssignmentsTable, and(
          eq(simulationGroupAssignmentsTable.runId, studioGroupSessionsTable.runId),
          inArray(simulationGroupAssignmentsTable.userId, userIds),
        ))
        .where(and(
          inArray(studioGroupSessionsTable.sessionId, sessionIds),
          sql`${studioGroupSessionsTable.approvedAt} is not null`,
        )),
      // Modules opened by hand for somebody on this cohort — the same rows the
      // single-learner loader reads, for the same reason.
      db
        .select({
          userId: moduleUnlocksTable.userId,
          sessionId: moduleUnlocksTable.sessionId,
          reason: moduleUnlocksTable.reason,
        })
        .from(moduleUnlocksTable)
        .where(and(
          inArray(moduleUnlocksTable.userId, userIds),
          inArray(moduleUnlocksTable.sessionId, sessionIds),
        )),
    ]);

  /* ---- index everything by (user, session) once ---- */

  const key = (userId: number, sessionId: number) => `${userId}:${sessionId}`;

  const attByKey = new Map(att.map((a) => [key(a.userId, a.sessionId), a]));
  const replayByKey = new Map(replay.map((r) => [key(r.userId, r.sessionId), r]));
  const bestByKey = new Map(bestAttempts.map((a) => [key(a.userId, a.sessionId), a.best]));
  const submissionByKey = new Map(submissions.map((s) => [key(s.userId, s.sessionId), s]));
  const givenByKey = new Map(reviewsGiven.map((r) => [key(r.reviewerId, r.sessionId), r.count]));
  const receivedByKey = new Map(reviewsReceived.map((r) => [key(r.userId, r.sessionId), r.count]));
  const extensionByKey = new Map(extensions.map((e) => [key(e.userId, e.sessionId), e.dueAt.toISOString()]));

  const quizSet = new Set(quizSessions.map((q) => q.sessionId));

  // Staff overrides, by (learner, module). The reason travels too, because the
  // panel that shows a module as open is also where somebody asks why.
  const unlockByKey = new Map(unlocks.map((u) => [key(u.userId, u.sessionId), u.reason]));

  /* ---- the Studio, by the same reading the learner's own screen gives it ---- */

  // Only a simulation module's exercise is a gate. An exercise filed against an
  // ordinary class was practice somebody was given, not work they owe.
  const simulationModules = new Set(
    sessions.filter((s) => s.kind === "simulation").map((s) => s.id),
  );
  // Sent to one person: only that person's module is asked for.
  const exerciseByKey = new Map<string, boolean>();
  for (const invite of studioInvites) {
    if (invite.sessionId === null || !simulationModules.has(invite.sessionId)) continue;
    const k = key(invite.userId, invite.sessionId);
    // Somebody re-sent an exercise after missing the first is done once any of
    // them is done.
    exerciseByKey.set(k, (exerciseByKey.get(k) ?? false) || invite.completedAt !== null);
  }
  // A group session has no invitation, because the cohort is the room: it is
  // asked of everybody enrolled, and turning up is the work.
  const groupModules = new Set<number>();
  const arrivedByKey = new Set<string>();
  for (const room of groupArrivals) {
    if (room.sessionId === null || !simulationModules.has(room.sessionId)) continue;
    groupModules.add(room.sessionId);
    if (room.userId !== null && room.enteredAt !== null) {
      arrivedByKey.add(key(room.userId, room.sessionId));
    }
  }

  const reviewsRequiredBySession = new Map(assignments.map((a) => [a.sessionId, a.reviewsRequired]));
  const assignmentDueBySession = new Map(assignments.map((a) => [a.sessionId, a.dueAt]));

  // How many people filed on each module, so nobody is asked for more critiques
  // than there is work to critique. Counted once and adjusted per learner,
  // because a learner never critiques their own submission.
  const filedPerSession = new Map<number, number>();
  for (const s of submissions) {
    filedPerSession.set(s.sessionId, (filedPerSession.get(s.sessionId) ?? 0) + 1);
  }

  const progressionByProgram = new Map<number, Progression>([
    [programme.id, programme.progression === "week" ? "week" : "module"],
  ]);
  const weekOfSession = weeksOfSessions(sessions);

  const sessionsLite = sessions.map((s) => ({
    id: s.id,
    programId: s.programId,
    startsAt: s.startsAt,
    durationMins: s.durationMins,
    sortOrder: s.sortOrder,
    title: s.title,
    // An unreadable value falls back to a class, which is what every module
    // written before simulation modules existed is.
    kind: (s.kind === "simulation" ? "simulation" : "class") as ModuleKind,
  }));

  const now = Date.now();

  const learners: CohortLearner[] = roster.map((person) => {
    const attendance = new Map<number, Date>();
    const presenceBySession = new Map<number, PresenceInput>();
    const coursework = new Map<number, CourseworkStatus>();
    const submittedAtBySession = new Map<number, string>();

    for (const s of sessions) {
      const k = key(person.userId, s.id);
      const a = attByKey.get(k);
      if (a) attendance.set(s.id, a.joinedAt);

      const r = replayByKey.get(k);
      presenceBySession.set(s.id, {
        ...EMPTY_PRESENCE,
        waived: !!a?.presenceWaivedAt,
        liveSeconds: a?.liveSeconds ?? 0,
        // The module's settled length, not each learner's own copy of it —
        // see the note on the same two lines in ./progress.ts. Reading the
        // learner's copy here was how the admin's percentage and the
        // learner's came to differ on the same recording.
        replayWatchedSeconds: r
          ? replayWatchedSeconds(r.buckets, s.recordingDurationSeconds ?? r.durationSeconds)
          : 0,
        replayDurationSeconds: s.recordingDurationSeconds ?? r?.durationSeconds ?? null,
      });

      const submission = submissionByKey.get(k);
      if (submission?.submittedAt) {
        submittedAtBySession.set(s.id, submission.submittedAt.toISOString());
      }

      const extendedTo = extensionByKey.get(k) ?? null;
      const filedHere = filedPerSession.get(s.id) ?? 0;

      // What the Studio asks of this person on this module, and whether they
      // have done it. A group session is asked of the whole room; a solo
      // exercise only of whoever was sent one. Either satisfies the module.
      const inGroupRoom = groupModules.has(s.id);
      const sentExercise = exerciseByKey.has(k);
      const hasSimulation = inGroupRoom || sentExercise;
      const simulationDone =
        (exerciseByKey.get(k) ?? false) || arrivedByKey.has(k);

      coursework.set(s.id, {
        ...EMPTY_COURSEWORK,
        hasQuiz: quizSet.has(s.id),
        quizBestScore: bestByKey.get(k) ?? null,
        hasAssignment: reviewsRequiredBySession.has(s.id),
        assignmentSubmitted: !!submission,
        // What they were asked for when they filed, never what the module asks
        // today — raising the number afterwards must not reach back and
        // un-complete somebody's module.
        reviewsRequired: submission?.reviewsRequiredAtSubmission
          ?? reviewsRequiredBySession.get(s.id) ?? 0,
        // What they were asked for at the moment they satisfied it. Null on
        // anybody who never has, and on everything filed before this was
        // recorded — the same guard against a raised number reaching back.
        reviewsCleared: submission?.reviewsClearedRequired ?? null,
        reviewsGiven: givenByKey.get(k) ?? 0,
        reviewsReceived: receivedByKey.get(k) ?? 0,
        peersToReview: Math.max(0, filedHere - (submission ? 1 : 0)),
        hasSimulation,
        simulationDone,
        quizDueAt: effectiveDueAt(
          s.quizDraft ? null : s.quizDueAt?.toISOString() ?? null,
          extendedTo,
        ),
        assignmentDueAt: effectiveDueAt(
          assignmentDueBySession.get(s.id)?.toISOString() ?? null,
          extendedTo,
        ),
      });
    }

    return {
      userId: person.userId,
      name: person.name,
      email: person.email,
      entries: computeProgress(
        sessionsLite,
        attendance,
        new Map([[programId, person.startedAt ?? person.createdAt]]),
        coursework,
        presenceBySession,
        now,
        {
          progressionByProgram,
          weekOfSession,
          openedByStaff: new Set(
            sessions
              .filter((s) => unlockByKey.has(key(person.userId, s.id)))
              .map((s) => s.id),
          ),
        },
      ),
      submittedAtBySession,
    };
  });

  const modules: CohortModule[] = sessions.map((s) => ({
    sessionId: s.id,
    title: s.title,
    startsAt: s.startsAt?.toISOString() ?? null,
    // A draft is invisible to learners, so its deadline is not one either.
    quizDueAt: s.quizDraft ? null : s.quizDueAt?.toISOString() ?? null,
    assignmentDueAt: assignmentDueBySession.get(s.id)?.toISOString() ?? null,
    sortOrder: s.sortOrder,
  }));

  return {
    programme: { id: programme.id, title: programme.title },
    modules,
    snapshot: cohortSnapshot({ modules, learners, nowMs: now }),
    learners,
  };
}
