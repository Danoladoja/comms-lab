import { Router, type IRouter } from "express";
import {
  db, sessionsTable, enrollmentsTable, programsTable, usersTable,
  quizQuestionsTable, quizAttemptsTable, assignmentsTable, assignmentSubmissionsTable,
  sessionReadingsTable, sessionSlidesTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { UpsertSessionQuizBody, SubmitQuizAttemptBody, UpsertSessionAssignmentBody, SubmitAssignmentBody } from "@workspace/api-zod";
import {
  QUIZ_PASS_MARK, DEFAULT_RUBRIC, DEFAULT_REVIEWS_REQUIRED, isModuleStaff, isValidRubric,
  isPastDue, pastDueMessage, readyToPost, describePost, postAnnouncement, labLetter, weekDeadline,
  disclosureProblem,
  type CourseworkPiece, type SendOutcome,
} from "@workspace/domain";
import { currentRole, getCurrentUser } from "../lib/auth";
import { progressForUser } from "../lib/progress";
import { emailConfigured, sendEmail } from "../lib/email";
import { appUrl, labLogoUrl } from "../lib/enrollmentEmails";
import { logger } from "../lib/logger";

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
  // The reason comes from the rules themselves, because a programme taught week
  // by week is not shut for the same reason as one taught module by module.
  if (entry?.locked) return entry.lockedReason ?? "Finish the previous module's work to unlock this one";
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

/**
 * The date the Lab would pick for this module's coursework, if asked.
 *
 * Offered only for a programme taught week by week, where the answer is not a
 * matter of taste: everything from a week is due at the end of the following
 * Monday. It is a suggestion and nothing more — the editor fills an empty box
 * with it so a person sees the date and can change it, rather than the server
 * quietly inventing deadlines nobody chose.
 */
async function suggestedDueAt(session: { programId: number; startsAt: Date | null }): Promise<string | null> {
  if (!session.startsAt) return null;
  const [programme] = await db
    .select({ progression: programsTable.progression })
    .from(programsTable)
    .where(eq(programsTable.id, session.programId));
  if (programme?.progression !== "week") return null;
  return weekDeadline(session.startsAt);
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

  const staff = isStaffFor(await currentRole(req), user, session);
  // A draft belongs to whoever is writing it. To everybody else the module
  // simply has no quiz yet, which is the truth.
  if (session.quizDraft && !staff) {
    res.status(404).json({ error: "No quiz for this module" });
    return;
  }

  const best = await bestScore(user.id, sessionId);
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
    draft: session.quizDraft,
    postedAt: session.quizPostedAt?.toISOString() ?? null,
    // Only staff are offered a date to set; a learner is told the one that is set.
    ...(staff ? { suggestedDueAt: await suggestedDueAt(session) } : {}),
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
  }

  /**
   * A quiz nobody has ever seen starts life as a draft.
   *
   * "Nobody has ever seen it" means no questions saved and never posted. The
   * column itself defaults to live so that every quiz written before posting
   * existed stays exactly where it is; this is the line that makes a *new* one
   * private instead. Once a cohort has been told about a module's quiz, editing
   * it never takes it back off their dashboard.
   */
  const [anyAlready] = await db
    .select({ id: quizQuestionsTable.id })
    .from(quizQuestionsTable)
    .where(eq(quizQuestionsTable.sessionId, sessionId))
    .limit(1);
  const quizDraft = !anyAlready && !session.quizPostedAt ? true : session.quizDraft;

  await db
    .update(sessionsTable)
    .set({ quizDueAt, quizDraft })
    .where(eq(sessionsTable.id, sessionId));

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
    draft: quizDraft,
    postedAt: session.quizPostedAt?.toISOString() ?? null,
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

  // Nobody sits a quiz that has not been posted.
  if (session.quizDraft) { res.status(404).json({ error: "No quiz for this module" }); return; }

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

  const staff = isStaffFor(await currentRole(req), user, session);
  // As with the quiz: a draft task does not exist as far as a learner is
  // concerned, so they are told the same thing as if it had never been written.
  if (assignment.draft && !staff) {
    res.status(404).json({ error: "No assignment for this module" });
    return;
  }

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
    ...(staff ? { origin: assignment.origin } : {}),
    ...deadline(assignment.dueAt),
    draft: assignment.draft,
    postedAt: assignment.postedAt?.toISOString() ?? null,
    ...(staff ? { suggestedDueAt: await suggestedDueAt(session) } : {}),
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
    // A task written for the first time is private until it is posted. `draft`
    // appears only here, in the insert — never in the update below — so that
    // editing a task the cohort already has does not take it back off them.
    .values({ sessionId, ...values, draft: true })
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
    draft: saved.draft,
    postedAt: saved.postedAt?.toISOString() ?? null,
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
    .select({ id: assignmentsTable.id, dueAt: assignmentsTable.dueAt, draft: assignmentsTable.draft })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.sessionId, sessionId));
  if (!assignment) { res.status(404).json({ error: "No assignment for this module" }); return; }
  // Nobody hands in work that has not been set.
  if (assignment.draft) { res.status(404).json({ error: "No assignment for this module" }); return; }

  // The door, again. Checked against the server's clock and after the work has
  // been found, so a late submission is refused for the right reason.
  if (isPastDue(assignment.dueAt?.toISOString(), Date.now())) {
    res.status(403).json({ error: pastDueMessage("assignment") });
    return;
  }

  // The disclosure is required, and it is refused here rather than only in the
  // browser: a learner is being asked to say something true about their own
  // work, and a rule enforced only on screen is a rule anybody can walk past.
  //
  // Asked last of the three, so that somebody handing in after the deadline is
  // told the door is shut rather than being sent to fill in a form that was
  // never going to be accepted.
  const disclosure = disclosureProblem(parsed.data.aiUse, parsed.data.aiNote);
  if (disclosure) { res.status(400).json({ error: disclosure }); return; }

  // Counts and timings, clamped to sane numbers. These arrive from the browser
  // and a browser can say anything, so nothing here is treated as proof — it is
  // a description of what happened, offered to a person who will use judgement.
  const count = (value: number | undefined) =>
    Math.max(0, Math.min(60 * 60 * 24, Math.round(value ?? 0)));
  const provenance = {
    aiUse: parsed.data.aiUse,
    aiNote: (parsed.data.aiNote ?? "").trim(),
    activeSeconds: count(parsed.data.activeSeconds),
    sittings: count(parsed.data.sittings),
    pasteCount: count(parsed.data.pasteCount),
    pastedChars: count(parsed.data.pastedChars),
    largestPaste: count(parsed.data.largestPaste),
  };

  const [saved] = await db
    .insert(assignmentSubmissionsTable)
    .values({ userId: user.id, sessionId, body: parsed.data.body, ...provenance })
    .onConflictDoUpdate({
      target: [assignmentSubmissionsTable.userId, assignmentSubmissionsTable.sessionId],
      // A resubmission replaces the record of how it was written, because the
      // record describes the piece that is now filed, not the one before it.
      set: { body: parsed.data.body, submittedAt: sql`now()`, ...provenance },
    })
    .returning();
  res.json({ sessionId, body: saved.body, submittedAt: saved.submittedAt.toISOString() });
});

/* ---------- Posting the coursework to the cohort ---------- */

/**
 * What a press of Post would publish, and who would hear about it.
 *
 * Asked for before the button is pressed, so the sentence the admin reads is
 * about the actual cohort rather than a guess.
 */
async function courseworkState(
  sessionId: number,
  session: { quizDraft: boolean; quizDueAt: Date | null; quizPostedAt: Date | null; readingsDraft: boolean },
) {
  const [[anyQuestion], [task], [anyReading], [deck]] = await Promise.all([
    db.select({ id: quizQuestionsTable.id }).from(quizQuestionsTable)
      .where(eq(quizQuestionsTable.sessionId, sessionId)).limit(1),
    db.select().from(assignmentsTable).where(eq(assignmentsTable.sessionId, sessionId)),
    db.select({ id: sessionReadingsTable.id }).from(sessionReadingsTable)
      .where(eq(sessionReadingsTable.sessionId, sessionId)).limit(1),
    db.select({ id: sessionSlidesTable.id, visibleToLearners: sessionSlidesTable.visibleToLearners })
      .from(sessionSlidesTable).where(eq(sessionSlidesTable.sessionId, sessionId)),
  ]);

  const pieces: CourseworkPiece[] = [
    {
      kind: "quiz",
      exists: !!anyQuestion,
      draft: session.quizDraft,
      dueAt: session.quizDueAt?.toISOString() ?? null,
    },
    {
      kind: "assignment",
      exists: !!task,
      draft: task?.draft ?? true,
      title: task?.title ?? null,
      dueAt: task?.dueAt?.toISOString() ?? null,
    },
    {
      kind: "slides",
      exists: !!deck,
      // The deck already had its own idea of this, under another name. It is
      // read rather than replaced, so a deck deliberately hidden stays hidden.
      draft: deck ? !deck.visibleToLearners : true,
    },
    {
      kind: "readings",
      exists: !!anyReading,
      draft: session.readingsDraft,
    },
  ];
  return { pieces, task };
}

/** Everyone on the programme who is still taking it, one address each. */
async function activeCohort(programId: number) {
  const rows = await db
    .select({ email: usersTable.email, name: usersTable.name })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(enrollmentsTable.userId, usersTable.id))
    .where(and(
      eq(enrollmentsTable.programId, programId),
      eq(enrollmentsTable.status, "enrolled"),
      sql`${usersTable.email} <> ''`,
    ))
    .orderBy(usersTable.id);

  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.email.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

router.get("/sessions/:id/coursework/post", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(await currentRole(req), user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { pieces } = await courseworkState(sessionId, session);
  const learners = (await activeCohort(session.programId)).length;

  res.json({
    sessionId,
    learners,
    summary: describePost(pieces, learners),
    quizDraft: pieces[0].draft && pieces[0].exists,
    assignmentDraft: pieces[1].draft && pieces[1].exists,
    slidesDraft: pieces[2].draft && pieces[2].exists,
    readingsDraft: pieces[3].draft && pieces[3].exists,
    quizPostedAt: session.quizPostedAt?.toISOString() ?? null,
    canPost: readyToPost(pieces).length > 0,
    // Offered to the two editors above, which fill an empty date box with it
    // when nothing has been saved yet. Null on a programme taught module by
    // module, where there is no obvious date to suggest.
    suggestedDueAt: await suggestedDueAt(session),
  });
});

/**
 * Post this module's coursework and tell the cohort.
 *
 * Publishing happens first and the emails follow. If it were the other way
 * round, a mail provider having a bad afternoon would leave a cohort holding a
 * letter about a quiz they cannot open — and the fix for a failed send is to
 * write to them again, which is a button that already exists.
 */
router.post("/sessions/:id/coursework/post", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(await currentRole(req), user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const { pieces } = await courseworkState(sessionId, session);
  const going = readyToPost(pieces);
  if (going.length === 0) {
    res.status(400).json({ error: describePost(pieces, 0) });
    return;
  }

  const [programme] = await db
    .select({ title: programsTable.title })
    .from(programsTable)
    .where(eq(programsTable.id, session.programId));

  const postedAt = new Date();
  const posting = going.map((p) => p.kind);
  // The quiz and the reading list both live on the module row, so one write
  // does both when both are going out.
  const onTheModule: Record<string, unknown> = {};
  if (posting.includes("quiz")) Object.assign(onTheModule, { quizDraft: false, quizPostedAt: postedAt });
  if (posting.includes("readings")) Object.assign(onTheModule, { readingsDraft: false, readingsPostedAt: postedAt });
  if (Object.keys(onTheModule).length > 0) {
    await db.update(sessionsTable).set(onTheModule).where(eq(sessionsTable.id, sessionId));
  }
  if (posting.includes("assignment")) {
    await db.update(assignmentsTable)
      .set({ draft: false, postedAt })
      .where(eq(assignmentsTable.sessionId, sessionId));
  }
  if (posting.includes("slides")) {
    await db.update(sessionSlidesTable)
      .set({ visibleToLearners: true })
      .where(eq(sessionSlidesTable.sessionId, sessionId));
  }

  const announcement = postAnnouncement({
    moduleTitle: session.title,
    programmeTitle: programme?.title ?? "",
    pieces,
  });

  const people = await activeCohort(session.programId);
  const outcomes: SendOutcome[] = [];

  if (people.length > 0 && emailConfigured()) {
    // One at a time, as everywhere else the Lab writes to a cohort: a burst of
    // fifty is the quickest way to be cut off halfway through with nobody able
    // to say who heard.
    for (const person of people) {
      const { html, text } = labLetter({
        greetingName: person.name,
        paragraphs: announcement.paragraphs,
        action: { label: "Open the classroom", url: appUrl(`/classroom/${sessionId}`) },
        logoUrl: labLogoUrl(),
      });
      try {
        await sendEmail({
          to: { email: person.email, name: person.name || person.email },
          subject: announcement.subject,
          html,
          text,
        });
        outcomes.push({ email: person.email, name: person.name, status: "sent", detail: "Delivered to their inbox." });
      } catch (err) {
        logger.error({ err, to: person.email, sessionId }, "Coursework notice failed for one person");
        outcomes.push({
          email: person.email,
          name: person.name,
          status: "failed",
          detail: "Their address was refused. Check it in the enrolment list.",
        });
      }
    }
  }

  const sent = outcomes.filter((o) => o.status === "sent").length;
  logger.info({ sessionId, posting, sent, failed: outcomes.length - sent, by: user.id }, "Coursework posted");

  res.status(201).json({
    sessionId,
    posted: posting,
    // Live either way. Whether anybody was emailed is a separate fact, and the
    // console says both rather than letting one stand for the other.
    emailed: sent,
    failed: outcomes.length - sent,
    mailConfigured: emailConfigured(),
    outcomes,
  });
});

export default router;
