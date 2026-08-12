import { Router, type IRouter } from "express";
import {
  db, sessionsTable, enrollmentsTable,
  quizQuestionsTable, quizAttemptsTable, assignmentsTable, assignmentSubmissionsTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { UpsertSessionQuizBody, SubmitQuizAttemptBody, UpsertSessionAssignmentBody, SubmitAssignmentBody } from "@workspace/api-zod";
import { QUIZ_PASS_MARK, DEFAULT_RUBRIC, DEFAULT_REVIEWS_REQUIRED, isValidRubric } from "@workspace/domain";
import { getCurrentUser } from "../lib/auth";
import { progressForUser } from "../lib/progress";

const router: IRouter = Router();

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

async function loadSession(sessionId: number) {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  return session ?? null;
}

function isStaffFor(user: User, session: { instructorId: number | null }) {
  return user.role === "admin" || (user.role === "instructor" && session.instructorId === user.id);
}

/**
 * Learners may open a module's coursework only when they are enrolled in the
 * program and the module is unlocked. Staff always may.
 * Returns an error string, or null when access is allowed.
 */
async function learnerAccessError(user: User, session: { id: number; programId: number; instructorId: number | null }): Promise<string | null> {
  if (isStaffFor(user, session)) return null;
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
  const entry = progress.find((p) => p.sessionId === session.id);
  if (entry?.locked) return "Finish the previous module's work to unlock this one";
  return null;
}

async function bestScore(userId: number, sessionId: number): Promise<number | null> {
  const [row] = await db
    .select({ best: sql<number | null>`max(${quizAttemptsTable.scorePct})::int` })
    .from(quizAttemptsTable)
    .where(and(eq(quizAttemptsTable.userId, userId), eq(quizAttemptsTable.sessionId, sessionId)));
  return row?.best ?? null;
}

/* ---------- Quiz ---------- */

router.get("/sessions/:id/quiz", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  const accessError = await learnerAccessError(user, session);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  const questions = await db
    .select()
    .from(quizQuestionsTable)
    .where(eq(quizQuestionsTable.sessionId, sessionId))
    .orderBy(asc(quizQuestionsTable.sortOrder), asc(quizQuestionsTable.id));
  if (questions.length === 0) { res.status(404).json({ error: "No quiz for this module" }); return; }

  const best = await bestScore(user.id, sessionId);
  const staff = isStaffFor(user, session);
  res.json({
    sessionId,
    passMark: QUIZ_PASS_MARK,
    // The correct answers never leave the server for learners.
    // Learners never receive the correctIndex field at all.
    questions: questions.map((q) => ({
      id: q.id, prompt: q.prompt, options: q.options, sortOrder: q.sortOrder,
      ...(staff ? { correctIndex: q.correctIndex } : {}),
    })),
    bestScore: best,
    passed: (best ?? 0) >= QUIZ_PASS_MARK,
  });
});

router.put("/sessions/:id/quiz", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = UpsertSessionQuizBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  for (const q of parsed.data.questions) {
    if (q.correctIndex >= q.options.length) {
      res.status(400).json({ error: "correctIndex out of range" });
      return;
    }
  }

  const saved = await db.transaction(async (tx) => {
    // Replacing the quiz invalidates all previous attempts: a pass on the old
    // questions must not count against the new ones.
    await tx.delete(quizAttemptsTable).where(eq(quizAttemptsTable.sessionId, sessionId));
    await tx.delete(quizQuestionsTable).where(eq(quizQuestionsTable.sessionId, sessionId));
    if (parsed.data.questions.length === 0) return [];
    return tx
      .insert(quizQuestionsTable)
      .values(parsed.data.questions.map((q, i) => ({
        sessionId, prompt: q.prompt, options: q.options, correctIndex: q.correctIndex, sortOrder: i,
      })))
      .returning();
  });
  res.json({
    sessionId,
    passMark: QUIZ_PASS_MARK,
    questions: saved.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options, sortOrder: q.sortOrder, correctIndex: q.correctIndex })),
    bestScore: null,
    passed: false,
  });
});

router.post("/sessions/:id/quiz/attempts", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  const accessError = await learnerAccessError(user, session);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  const parsed = SubmitQuizAttemptBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const questions = await db
    .select()
    .from(quizQuestionsTable)
    .where(eq(quizQuestionsTable.sessionId, sessionId));
  if (questions.length === 0) { res.status(404).json({ error: "No quiz for this module" }); return; }

  const answerByQuestion = new Map(parsed.data.answers.map((a) => [a.questionId, a.answerIndex]));
  const correctCount = questions.filter((q) => answerByQuestion.get(q.id) === q.correctIndex).length;
  const scorePct = Math.round((correctCount / questions.length) * 100);
  const passed = scorePct >= QUIZ_PASS_MARK;
  await db.insert(quizAttemptsTable).values({ userId: user.id, sessionId, scorePct, passed });
  const best = Math.max(scorePct, (await bestScore(user.id, sessionId)) ?? 0);

  res.json({ sessionId, scorePct, passed, correctCount, totalQuestions: questions.length, bestScore: best });
});

/* ---------- Assignment ---------- */

router.get("/sessions/:id/assignment", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  const accessError = await learnerAccessError(user, session);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.sessionId, sessionId));
  if (!assignment) { res.status(404).json({ error: "No assignment for this module" }); return; }
  const [submission] = await db
    .select()
    .from(assignmentSubmissionsTable)
    .where(and(eq(assignmentSubmissionsTable.userId, user.id), eq(assignmentSubmissionsTable.sessionId, sessionId)));

  res.json({
    sessionId,
    title: assignment.title,
    instructions: assignment.instructions,
    // Assignments written before rubrics existed fall back to the house rubric
    // rather than silently becoming un-critiquable.
    rubric: assignment.rubric.length > 0 ? assignment.rubric : DEFAULT_RUBRIC,
    reviewsRequired: assignment.reviewsRequired,
    mySubmission: submission
      ? { sessionId, body: submission.body, submittedAt: submission.submittedAt.toISOString() }
      : null,
  });
});

router.put("/sessions/:id/assignment", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = UpsertSessionAssignmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const rubric = parsed.data.rubric ?? DEFAULT_RUBRIC;
  if (!isValidRubric(rubric)) {
    res.status(400).json({ error: "Rubric must have at least one criterion, each scored 2-10" });
    return;
  }
  const reviewsRequired = parsed.data.reviewsRequired ?? DEFAULT_REVIEWS_REQUIRED;

  const values = {
    title: parsed.data.title,
    instructions: parsed.data.instructions ?? "",
    rubric,
    reviewsRequired,
  };
  const [saved] = await db
    .insert(assignmentsTable)
    .values({ sessionId, ...values })
    .onConflictDoUpdate({ target: assignmentsTable.sessionId, set: values })
    .returning();
  res.json({
    sessionId,
    title: saved.title,
    instructions: saved.instructions,
    rubric: saved.rubric,
    reviewsRequired: saved.reviewsRequired,
    mySubmission: null,
  });
});

router.post("/sessions/:id/assignment/submission", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  const accessError = await learnerAccessError(user, session);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  const parsed = SubmitAssignmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [assignment] = await db.select({ id: assignmentsTable.id }).from(assignmentsTable).where(eq(assignmentsTable.sessionId, sessionId));
  if (!assignment) { res.status(404).json({ error: "No assignment for this module" }); return; }

  const [saved] = await db
    .insert(assignmentSubmissionsTable)
    .values({ userId: user.id, sessionId, body: parsed.data.body })
    .onConflictDoUpdate({
      target: [assignmentSubmissionsTable.userId, assignmentSubmissionsTable.sessionId],
      set: { body: parsed.data.body, submittedAt: sql`now()` },
    })
    .returning();
  res.json({ sessionId, body: saved.body, submittedAt: saved.submittedAt.toISOString() });
});

export default router;
