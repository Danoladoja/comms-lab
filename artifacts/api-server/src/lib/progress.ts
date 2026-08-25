import {
  db, attendanceTable, enrollmentsTable, sessionsTable,
  quizQuestionsTable, quizAttemptsTable, assignmentsTable, assignmentSubmissionsTable,
  submissionReviewsTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  computeProgress,
  EMPTY_COURSEWORK,
  type CourseworkStatus,
  type ProgressEntry,
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
    })
    .from(sessionsTable)
    .where(inArray(sessionsTable.programId, programIds));

  // `.concat(-1)` keeps the IN clause non-empty for programs with no sessions.
  const sessionIds = sessions.map((s) => s.id).concat(-1);

  const [att, enrollRows, quizSessions, bestAttempts, assignments, submissions, reviewsGiven, reviewsReceived] =
    await Promise.all([
      db
        .select()
        .from(attendanceTable)
        .where(and(eq(attendanceTable.userId, userId), inArray(attendanceTable.sessionId, sessionIds))),
      db
        .select({ programId: enrollmentsTable.programId, createdAt: enrollmentsTable.createdAt })
        .from(enrollmentsTable)
        .where(and(eq(enrollmentsTable.userId, userId), inArray(enrollmentsTable.programId, programIds))),
      db
        .selectDistinct({ sessionId: quizQuestionsTable.sessionId })
        .from(quizQuestionsTable)
        .where(inArray(quizQuestionsTable.sessionId, sessionIds)),
      db
        .select({ sessionId: quizAttemptsTable.sessionId, best: sql<number>`max(${quizAttemptsTable.scorePct})::int` })
        .from(quizAttemptsTable)
        .where(and(eq(quizAttemptsTable.userId, userId), inArray(quizAttemptsTable.sessionId, sessionIds)))
        .groupBy(quizAttemptsTable.sessionId),
      db
        .select({ sessionId: assignmentsTable.sessionId, reviewsRequired: assignmentsTable.reviewsRequired })
        .from(assignmentsTable)
        .where(inArray(assignmentsTable.sessionId, sessionIds)),
      db
        .select({ sessionId: assignmentSubmissionsTable.sessionId, id: assignmentSubmissionsTable.id })
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
    ]);

  const attendance = new Map(att.map((a) => [a.sessionId, a.joinedAt]));
  const enrolledAtByProgram = new Map(enrollRows.map((e) => [e.programId, e.createdAt]));
  const quizSet = new Set(quizSessions.map((q) => q.sessionId));
  const bestBySession = new Map(bestAttempts.map((a) => [a.sessionId, a.best]));
  const reviewsRequiredBySession = new Map(assignments.map((a) => [a.sessionId, a.reviewsRequired]));
  const submittedSet = new Set(submissions.map((s) => s.sessionId));
  const givenBySession = new Map(reviewsGiven.map((r) => [r.sessionId, r.count]));
  const receivedBySession = new Map(reviewsReceived.map((r) => [r.sessionId, r.count]));

  const coursework = new Map<number, CourseworkStatus>(
    sessions.map((s) => [
      s.id,
      {
        ...EMPTY_COURSEWORK,
        hasQuiz: quizSet.has(s.id),
        quizBestScore: bestBySession.get(s.id) ?? null,
        hasAssignment: reviewsRequiredBySession.has(s.id),
        assignmentSubmitted: submittedSet.has(s.id),
        reviewsRequired: reviewsRequiredBySession.get(s.id) ?? 0,
        reviewsGiven: givenBySession.get(s.id) ?? 0,
        reviewsReceived: receivedBySession.get(s.id) ?? 0,
      },
    ]),
  );

  return computeProgress(sessions, attendance, enrolledAtByProgram, coursework);
}

export async function enrolledProgramIds(userId: number): Promise<number[]> {
  const enrolled = await db
    .select({ programId: enrollmentsTable.programId })
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, userId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
  return enrolled.map((e) => e.programId);
}
