import { Router, type IRouter } from "express";
import {
  db, sessionsTable, enrollmentsTable,
  quizQuestionsTable, quizAttemptsTable, assignmentsTable, assignmentSubmissionsTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { UpsertSessionQuizBody, SubmitQuizAttemptBody, UpsertSessionAssignmentBody, SubmitAssignmentBody } from "@workspace/api-zod";
import {
  QUIZ_PASS_MARK, DEFAULT_RUBRIC, DEFAULT_REVIEWS_REQUIRED, isModuleStaff, isValidRubric,
  isPastDue, pastDueMessage,
} from "@workspace/domain";
import { currentRole, getCurrentUser } from "../lib/auth";
import { progressForUser } from "../lib/progress";

const router: IRouter = Router();

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

async function loadSession(sessionId: number) {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  return session ?? null;
}

/**
 * The role must be the effective one, from `currentRole`, never `user.role`.
 * A super admin's row says "superadmin", and a plain `=== "admin"` comparison
 * shut one out of the console for a day. The rule itself lives in the domain
 * so slides, coursework and simulations cannot drift apart again.
 */
export function isStaffFor(role: string | null, user: User, session: { instructorId: number | null }) {
  return isModuleStaff(role, user.id, session.instructorId);
}

/**
 * Learners may open a module's coursework only when they are enrolled in the
 * program and the module is unlocked. Staff always may.
 * Returns an error string, or null when access is allowed.
 */
export async function learnerAccessError(role: string | null, user: User, session: { id: number; programId: number; instructorId: number | null }): Promise<string | null> {
  if (isStaffFor(role, user, session)) return null;
  const [enrollment] = await db
    .select({ id: enrollmentsTable.id })
    .from(enrollmentsTable)
    .where(and(
      eq(enrollmentsTable.userId, user.id),
      eq(enrollmentsTable.programId, session.programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));
  if (!enrollment) return "You are not enrolled on this programme";
  const progress = await progressForUser(user.id, [session.programId]);
  const entry = progress.find((p) => p.sessionId === session.id);
  if (entry?.locked) return "Finish the previous module's work to unlock this one";
  return null;
}

/**
 * A deadline as it travels to the browser, and whether it has passed.
 *
 * The verdict is worked out here and sent as an answer rather than left for the
 * browser to compute from the date. A learner whose laptop clock is a day slow
 * would otherwise be handed an extra day, and one whose clock runs fast would
 * lose one — and neither would have any idea why.
 */
function deadline(dueAt: Date | null | undefined) {
  const iso = dueAt ? dueAt.toISOString() : null;
  return { dueAt: iso, closed: isPastDue(iso, Date.now()) };
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
  const accessError = await learnerAccessError(await currentRole(req), user, session);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  const questions = await db
    .select()
    .from(quizQuestionsTable)
    .where(eq(quizQuestionsTable.sessionId, sessionId))
    .orderBy(asc(quizQuestionsTable.sortOrder), asc(quizQuestionsTable.id));
  if (questions.length === 0) { res.status(404).json({ error: "No quiz for this module" }); return; }

  const best = await bestScore(user.id, sessionId);
  const staff = isStaffFor(await currentRole(req), user, session);
  res.json({
    sessionId,
    passMark: QUIZ_PASS_MARK,
    // The correct answers never leave the server for learners.
    // Learners never receive the correctIndex field at all.
    questions: questions.map((q) => ({
      id: q.id, prompt: q.prompt, options: q.options, sortOrder: q.sortOrder,
      // Origin travels with the answer key: it is a facilitator's record of
      // whether anyone reviewed the question, and no business of learners.
      ...(staff ? { correctIndex: q.correctIndex, origin: q.origin } : {}),
    })),
    bestScore: best,
    passed: (best ?? 0) >= QUIZ_PASS_MARK,
    ...deadline(session.quizDueAt),
  });
});

router.put("/sessions/:id/quiz", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(await currentRole(req), user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = UpsertSessionQuizBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  for (const q of parsed.data.questions) {
    if (q.correctIndex >= q.options.length) {
      res.status(400).json({ error: "correctIndex out of range" });
      return;
    }
  }

  // A deadline outlives any one save of the questions, so it is only touched
  // when the client actually sends one. Sending null is how it is lifted —
  // which is also how a learner who missed it is let back in.
  let quizDueAt = session.quizDueAt ?? null;
  if (parsed.data.dueAt !== undefined) {
    quizDueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
    if (quizDueAt && !Number.isFinite(quizDueAt.getTime())) {
      res.status(400).json({ error: "That due date could not be read" });
      return;
    }
    await db.update(sessionsTable).set({ quizDueAt }).where(eq(sessionsTable.id, sessionId));
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
        sessionId,
        prompt: q.prompt,
        options: q.options,
        correctIndex: q.correctIndex,
        sortOrder: i,
        // How the question came to exist. The editor works this out by
        // comparing what is being saved against the draft it came from; an
        // older client that sends nothing is recorded as hand-written, which is
        // what every question was before drafting existed.
        origin: q.origin ?? "manual",
      })))
      .returning();
  });
  res.json({
    sessionId,
    passMark: QUIZ_PASS_MARK,
    questions: saved.map((q) => ({
      id: q.id, prompt: q.prompt, options: q.options, sortOrder: q.sortOrder,
      correctIndex: q.correctIndex, origin: q.origin,
    })),
    bestScore: null,
    passed: false,
    ...deadline(quizDueAt),
  });
});

router.post("/sessions/:id/quiz/attempts", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  const accessError = await learnerAccessError(await currentRole(req), user, session);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  // The deadline is enforced here, not merely displayed. The button in the
  // browser is a courtesy; this is the door.
  if (isPastDue(session.quizDueAt?.toISOString(), Date.now())) {
    res.status(403).json({ error: pastDueMessage("quiz") });
    return;
  }

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
  const accessError = await learnerAccessError(await currentRole(req), user, session);
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
    // Staff only, as on quiz questions. Without it the editor cannot tell a task
    // it drafted last week from one a person wrote, and would record every later
    // save as hand-written.
    ...(isStaffFor(await currentRole(req), user, session) ? { origin: assignment.origin } : {}),
    ...deadline(assignment.dueAt),
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
  if (!isStaffFor(await currentRole(req), user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = UpsertSessionAssignmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const rubric = parsed.data.rubric ?? DEFAULT_RUBRIC;
  if (!isValidRubric(rubric)) {
    res.status(400).json({ error: "Rubric must have at least one criterion, each scored 2-10" });
    return;
  }
  const reviewsRequired = parsed.data.reviewsRequired ?? DEFAULT_REVIEWS_REQUIRED;

  const [existing] = await db
    .select({ dueAt: assignmentsTable.dueAt })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.sessionId, sessionId));

  // As on the quiz: only touched when the client sends one, and null lifts it.
  let dueAt = existing?.dueAt ?? null;
  if (parsed.data.dueAt !== undefined) {
    dueAt = parsed.data.dueAt ? new Date(parsed.data.dueAt) : null;
    if (dueAt && !Number.isFinite(dueAt.getTime())) {
      res.status(400).json({ error: "That due date could not be read" });
      return;
    }
  }

  const values = {
    title: parsed.data.title,
    instructions: parsed.data.instructions ?? "",
    rubric,
    reviewsRequired,
    dueAt,
    origin: parsed.data.origin ?? "manual",
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
    origin: saved.origin,
    ...deadline(saved.dueAt),
    mySubmission: null,
  });
});

router.post("/sessions/:id/assignment/submission", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  const accessError = await learnerAccessError(await currentRole(req), user, session);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  const parsed = SubmitAssignmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [assignment] = await db
    .select({ id: assignmentsTable.id, dueAt: assignmentsTable.dueAt })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.sessionId, sessionId));
  if (!assignment) { res.status(404).json({ error: "No assignment for this module" }); return; }

  // The door, again. Checked against the server's clock and after the work has
  // been found, so a late submission is refused for the right reason.
  if (isPastDue(assignment.dueAt?.toISOString(), Date.now())) {
    res.status(403).json({ error: pastDueMessage("assignment") });
    return;
  }

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
