import { Router, type IRouter } from "express";
import {
  db, sessionsTable, enrollmentsTable, usersTable,
  assignmentsTable, assignmentSubmissionsTable, submissionReviewsTable,
  submissionCommentsTable,
} from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  pickReviewTargets,
  validateReview,
  reviewScorePct,
  DEFAULT_RUBRIC,
  type RubricCriterion,
  type ReviewCandidate,
  isModuleStaff,
  aiUseLabel,
  describeProvenance,
  worthALook,
  thinCritique,
  whyDiscussionLocked,
  commentProblem,
} from "@workspace/domain";
import { SubmitReviewBody } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { progressForUser } from "../lib/progress";

const router: IRouter = Router();

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

function isStaffFor(user: User, session: { instructorId: number | null }) {
  return isModuleStaff(user.role, user.id, session.instructorId);
}

/** Enrolled and unlocked, or staff. Returns an error string, or null when allowed. */
async function accessError(
  user: User,
  session: { id: number; programId: number; instructorId: number | null },
): Promise<string | null> {
  if (isStaffFor(user, session)) return null;
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
  if (progress.find((p) => p.sessionId === session.id)?.locked) {
    return "Finish the previous module's work to unlock this one";
  }
  return null;
}

async function loadModule(sessionId: number) {
  const [row] = await db
    .select({
      id: sessionsTable.id,
      programId: sessionsTable.programId,
      instructorId: sessionsTable.instructorId,
      assignmentId: assignmentsTable.id,
      title: assignmentsTable.title,
      instructions: assignmentsTable.instructions,
      rubric: assignmentsTable.rubric,
      reviewsRequired: assignmentsTable.reviewsRequired,
    })
    .from(sessionsTable)
    .leftJoin(assignmentsTable, eq(assignmentsTable.sessionId, sessionsTable.id))
    .where(eq(sessionsTable.id, sessionId));
  return row ?? null;
}

/** Assignments created before rubrics existed fall back to the house rubric. */
function effectiveRubric(rubric: RubricCriterion[] | null | undefined): RubricCriterion[] {
  return rubric && rubric.length > 0 ? rubric : DEFAULT_RUBRIC;
}

async function countReviewsGiven(userId: number, sessionId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(submissionReviewsTable)
    .where(and(eq(submissionReviewsTable.reviewerId, userId), eq(submissionReviewsTable.sessionId, sessionId)));
  return row?.count ?? 0;
}

/* ---------- The review queue ---------- */

router.get("/sessions/:id/reviews/queue", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const mod = await loadModule(sessionId);
  if (!mod) { res.status(404).json({ error: "Session not found" }); return; }
  if (!mod.assignmentId) { res.status(404).json({ error: "No assignment for this module" }); return; }

  const err = await accessError(user, mod);
  if (err) { res.status(403).json({ error: err }); return; }

  const rubric = effectiveRubric(mod.rubric);
  const reviewsRequired = mod.reviewsRequired ?? 0;
  const reviewsGiven = await countReviewsGiven(user.id, sessionId);

  const base = { sessionId, rubric, reviewsRequired, reviewsGiven };

  if (reviewsRequired === 0) {
    res.json({ ...base, canReview: false, reason: "done", targets: [] });
    return;
  }

  // You must file before you can critique — otherwise the queue is a way to
  // read everyone else's answer before writing your own.
  const [mine] = await db
    .select({ id: assignmentSubmissionsTable.id })
    .from(assignmentSubmissionsTable)
    .where(and(
      eq(assignmentSubmissionsTable.userId, user.id),
      eq(assignmentSubmissionsTable.sessionId, sessionId),
    ));
  if (!mine) {
    res.json({ ...base, canReview: false, reason: "not-submitted", targets: [] });
    return;
  }

  const [pool, alreadyReviewed] = await Promise.all([
    db
      .select({
        submissionId: assignmentSubmissionsTable.id,
        authorId: assignmentSubmissionsTable.userId,
        body: assignmentSubmissionsTable.body,
        submittedAt: assignmentSubmissionsTable.submittedAt,
        reviewCount: sql<number>`count(${submissionReviewsTable.id})::int`,
      })
      .from(assignmentSubmissionsTable)
      .leftJoin(submissionReviewsTable, eq(submissionReviewsTable.submissionId, assignmentSubmissionsTable.id))
      .where(eq(assignmentSubmissionsTable.sessionId, sessionId))
      .groupBy(
        assignmentSubmissionsTable.id,
        assignmentSubmissionsTable.userId,
        assignmentSubmissionsTable.body,
        assignmentSubmissionsTable.submittedAt,
      ),
    db
      .select({ submissionId: submissionReviewsTable.submissionId })
      .from(submissionReviewsTable)
      .where(and(
        eq(submissionReviewsTable.reviewerId, user.id),
        eq(submissionReviewsTable.sessionId, sessionId),
      )),
  ]);

  const bodyById = new Map(pool.map((p) => [p.submissionId, p.body]));
  const candidates: ReviewCandidate[] = pool.map((p) => ({
    submissionId: p.submissionId,
    authorId: p.authorId,
    reviewCount: p.reviewCount,
    submittedAt: p.submittedAt,
  }));
  const outstanding = Math.max(0, reviewsRequired - reviewsGiven);
  const targets = pickReviewTargets(
    candidates,
    user.id,
    alreadyReviewed.map((r) => r.submissionId),
    // Always offer at least one, so a learner who wants to give more than the
    // minimum can — the requirement is a floor, not a ceiling.
    Math.max(outstanding, 1),
  );

  res.json({
    ...base,
    canReview: targets.length > 0,
    reason: targets.length > 0 ? "" : outstanding === 0 ? "done" : "none-available",
    targets: targets.map((t) => ({
      submissionId: t.submissionId,
      // The author is deliberately absent: critique is blind both ways.
      body: bodyById.get(t.submissionId) ?? "",
      submittedAt: t.submittedAt.toISOString(),
    })),
  });
});

/* ---------- Writing a critique ---------- */

router.post("/submissions/:submissionId/reviews", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const submissionId = Number(req.params.submissionId);

  const [submission] = await db
    .select({
      id: assignmentSubmissionsTable.id,
      authorId: assignmentSubmissionsTable.userId,
      sessionId: assignmentSubmissionsTable.sessionId,
    })
    .from(assignmentSubmissionsTable)
    .where(eq(assignmentSubmissionsTable.id, submissionId));
  if (!submission) { res.status(404).json({ error: "Submission not found" }); return; }

  if (submission.authorId === user.id) {
    res.status(403).json({ error: "You cannot review your own submission" });
    return;
  }

  const mod = await loadModule(submission.sessionId);
  if (!mod || !mod.assignmentId) { res.status(404).json({ error: "No assignment for this module" }); return; }
  const err = await accessError(user, mod);
  if (err) { res.status(403).json({ error: err }); return; }

  // Staff may critique without submitting; learners may not.
  if (!isStaffFor(user, mod)) {
    const [mine] = await db
      .select({ id: assignmentSubmissionsTable.id })
      .from(assignmentSubmissionsTable)
      .where(and(
        eq(assignmentSubmissionsTable.userId, user.id),
        eq(assignmentSubmissionsTable.sessionId, submission.sessionId),
      ));
    if (!mine) {
      res.status(403).json({ error: "Submit your own work before critiquing someone else's" });
      return;
    }
  }

  const parsed = SubmitReviewBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const rubric = effectiveRubric(mod.rubric);
  const problem = validateReview(rubric, parsed.data.scores, parsed.data.comment);
  if (problem) { res.status(400).json({ error: problem }); return; }

  const inserted = await db
    .insert(submissionReviewsTable)
    .values({
      submissionId,
      reviewerId: user.id,
      sessionId: submission.sessionId,
      scores: parsed.data.scores,
      comment: parsed.data.comment.trim(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length === 0) {
    res.status(409).json({ error: "You have already reviewed this submission" });
    return;
  }

  const saved = inserted[0];
  res.status(201).json({
    id: saved.id,
    scores: saved.scores,
    comment: saved.comment,
    createdAt: saved.createdAt.toISOString(),
    scorePct: reviewScorePct(rubric, saved.scores),
  });
});

/* ---------- Reading your own feedback ---------- */

router.get("/sessions/:id/feedback", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  const mod = await loadModule(sessionId);
  if (!mod) { res.status(404).json({ error: "Session not found" }); return; }
  if (!mod.assignmentId) { res.status(404).json({ error: "No assignment for this module" }); return; }

  const err = await accessError(user, mod);
  if (err) { res.status(403).json({ error: err }); return; }

  const rubric = effectiveRubric(mod.rubric);
  const reviewsRequired = mod.reviewsRequired ?? 0;
  const reviewsGiven = await countReviewsGiven(user.id, sessionId);
  // Give to receive. This is what stops the critique loop from starving.
  const unlocked = reviewsRequired === 0 || reviewsGiven >= reviewsRequired;

  if (!unlocked) {
    res.json({ sessionId, unlocked: false, reviewsRequired, reviewsGiven, rubric, reviews: [] });
    return;
  }

  const rows = await db
    .select({
      id: submissionReviewsTable.id,
      scores: submissionReviewsTable.scores,
      comment: submissionReviewsTable.comment,
      createdAt: submissionReviewsTable.createdAt,
    })
    .from(submissionReviewsTable)
    .innerJoin(assignmentSubmissionsTable, eq(submissionReviewsTable.submissionId, assignmentSubmissionsTable.id))
    .where(and(
      eq(assignmentSubmissionsTable.userId, user.id),
      eq(assignmentSubmissionsTable.sessionId, sessionId),
    ))
    .orderBy(asc(submissionReviewsTable.createdAt));

  res.json({
    sessionId,
    unlocked: true,
    reviewsRequired,
    reviewsGiven,
    rubric,
    // Reviewer identity is never sent — people write braver feedback unsigned.
    reviews: rows.map((r) => ({
      id: r.id,
      scores: r.scores,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
      scorePct: reviewScorePct(rubric, r.scores),
    })),
  });
});

/* ---------- What staff can see ---------- */

/**
 * Every piece filed for a module, and every critique of it, with names.
 *
 * Before this, nobody at the Lab could read any of it. Written work left the
 * database by three doors only — back to its author, anonymously to two peers,
 * and onto a public certificate if the learner opted in — and staff were on
 * none of them. So a facilitator could not tell whether the critiques were any
 * good, could not spot a learner quietly drowning, could not settle a dispute
 * about unfair feedback, and could not find somebody being cruel behind the
 * anonymity the Lab itself granted them.
 *
 * Critiques carry their author's name here, and only here. The learner who
 * received one still sees it unsigned, which is what keeps feedback brave.
 */
router.get("/admin/sessions/:id/work", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) { res.status(400).json({ error: "That is not a module." }); return; }
  const mod = await loadModule(sessionId);
  if (!mod) { res.status(404).json({ error: "Session not found" }); return; }
  // Staff only. Not "enrolled and unlocked" — this is the one screen in the Lab
  // that shows one learner's work to somebody who did not write it.
  if (!isStaffFor(user, mod)) { res.status(403).json({ error: "Forbidden" }); return; }

  const rubric = effectiveRubric(mod.rubric);

  const [pieces, critiques, cohort] = await Promise.all([
    db
      .select({
        submissionId: assignmentSubmissionsTable.id,
        authorId: assignmentSubmissionsTable.userId,
        authorName: usersTable.name,
        body: assignmentSubmissionsTable.body,
        submittedAt: assignmentSubmissionsTable.submittedAt,
        aiUse: assignmentSubmissionsTable.aiUse,
        aiNote: assignmentSubmissionsTable.aiNote,
        activeSeconds: assignmentSubmissionsTable.activeSeconds,
        sittings: assignmentSubmissionsTable.sittings,
        pasteCount: assignmentSubmissionsTable.pasteCount,
        pastedChars: assignmentSubmissionsTable.pastedChars,
        largestPaste: assignmentSubmissionsTable.largestPaste,
        withdrawnAt: assignmentSubmissionsTable.withdrawnAt,
      })
      .from(assignmentSubmissionsTable)
      .innerJoin(usersTable, eq(usersTable.id, assignmentSubmissionsTable.userId))
      .where(eq(assignmentSubmissionsTable.sessionId, sessionId))
      .orderBy(asc(assignmentSubmissionsTable.submittedAt)),
    db
      .select({
        id: submissionReviewsTable.id,
        submissionId: submissionReviewsTable.submissionId,
        reviewerId: submissionReviewsTable.reviewerId,
        reviewerName: usersTable.name,
        scores: submissionReviewsTable.scores,
        comment: submissionReviewsTable.comment,
        createdAt: submissionReviewsTable.createdAt,
      })
      .from(submissionReviewsTable)
      .innerJoin(usersTable, eq(usersTable.id, submissionReviewsTable.reviewerId))
      .where(eq(submissionReviewsTable.sessionId, sessionId))
      .orderBy(asc(submissionReviewsTable.createdAt)),
    db
      .select({ id: usersTable.id, name: usersTable.name })
      .from(enrollmentsTable)
      .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
      .where(and(
        eq(enrollmentsTable.programId, mod.programId),
        eq(enrollmentsTable.status, "enrolled"),
      ))
      .orderBy(asc(usersTable.name)),
  ]);

  // Everything one reviewer wrote for this module, so a critique can be compared
  // with that person's others — the "five identical reviews" the database was
  // built to let a facilitator find.
  const byReviewer = new Map<number, string[]>();
  for (const c of critiques) {
    byReviewer.set(c.reviewerId, [...(byReviewer.get(c.reviewerId) ?? []), c.comment]);
  }

  const reviewsRequired = mod.reviewsRequired ?? 0;
  const givenBy = new Map<number, number>();
  for (const c of critiques) givenBy.set(c.reviewerId, (givenBy.get(c.reviewerId) ?? 0) + 1);
  const submitted = new Set(pieces.map((p) => p.authorId));

  res.json({
    sessionId,
    title: mod.title ?? "",
    rubric,
    reviewsRequired,
    // The two lists a facilitator actually chases, worked out here so the
    // console does not have to subtract one set of people from another.
    missing: cohort.filter((c) => !submitted.has(c.id)).map((c) => c.name),
    owing: cohort
      .filter((c) => submitted.has(c.id) && (givenBy.get(c.id) ?? 0) < reviewsRequired)
      .map((c) => ({ name: c.name, given: givenBy.get(c.id) ?? 0 })),
    pieces: pieces.map((p) => {
      const provenance = {
        activeSeconds: p.activeSeconds,
        sittings: p.sittings,
        pasteCount: p.pasteCount,
        pastedChars: p.pastedChars,
        largestPaste: p.largestPaste,
        finalChars: p.body.length,
      };
      return {
        submissionId: p.submissionId,
        authorName: p.authorName,
        body: p.body,
        submittedAt: p.submittedAt.toISOString(),
        withdrawn: !!p.withdrawnAt,
        aiUse: p.aiUse,
        aiUseLabel: aiUseLabel(p.aiUse),
        aiNote: p.aiNote,
        // A sentence about what happened, never a score about who wrote it.
        provenance: describeProvenance(provenance),
        worthALook: worthALook(provenance),
        critiques: critiques
          .filter((c) => c.submissionId === p.submissionId)
          .map((c) => ({
            id: c.id,
            reviewerName: c.reviewerName,
            comment: c.comment,
            scorePct: reviewScorePct(rubric, c.scores),
            createdAt: c.createdAt.toISOString(),
            thin: thinCritique(
              c.comment,
              (byReviewer.get(c.reviewerId) ?? []).filter((other) => other !== c.comment),
            ),
          })),
      };
    }),
  });
});

/**
 * Take one piece out of the cohort discussion, or put it back.
 *
 * Everyone is in by default and learners have no opt-out, which is a defensible
 * rule for a professional workshop and a cruel one for somebody who wrote
 * something more personal than they meant to. This is the remedy. It hides the
 * piece from the discussion only — the work still counts towards the module and
 * staff still see it.
 */
router.post("/admin/submissions/:id/withdraw", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const submissionId = Number(req.params.id);
  if (!Number.isInteger(submissionId)) { res.status(400).json({ error: "That is not a submission." }); return; }

  const [submission] = await db
    .select({ id: assignmentSubmissionsTable.id, sessionId: assignmentSubmissionsTable.sessionId })
    .from(assignmentSubmissionsTable)
    .where(eq(assignmentSubmissionsTable.id, submissionId));
  if (!submission) { res.status(404).json({ error: "That piece no longer exists." }); return; }

  const mod = await loadModule(submission.sessionId);
  if (!mod || !isStaffFor(user, mod)) { res.status(403).json({ error: "Forbidden" }); return; }

  const withdraw = req.body?.withdrawn !== false;
  await db
    .update(assignmentSubmissionsTable)
    .set({
      withdrawnAt: withdraw ? new Date() : null,
      withdrawnBy: withdraw ? user.id : null,
    })
    .where(eq(assignmentSubmissionsTable.id, submissionId));

  res.json({ submissionId, withdrawn: withdraw });
});

/* ---------- The cohort discussion ---------- */

/**
 * Everyone's work for one module, once you have earned the right to read it.
 *
 * The gate is the same one that unseals your own feedback — file your piece,
 * write the critiques you owe — so there is a single rule to explain rather
 * than two that nearly match.
 *
 * Pieces are named, because you cannot discuss writing with somebody whose name
 * you do not know. Critiques are not, because those were written under a promise
 * of anonymity and the promise does not expire when the exercise ends. The
 * author's AI disclosure travels with the piece: that is the point of asking for
 * it, and a cohort that reads each other's disclosures learns the habit faster
 * than one that is merely told to have it.
 */
router.get("/sessions/:id/discussion", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) { res.status(400).json({ error: "That is not a module." }); return; }
  const mod = await loadModule(sessionId);
  if (!mod) { res.status(404).json({ error: "Session not found" }); return; }
  if (!mod.assignmentId) { res.status(404).json({ error: "No assignment for this module" }); return; }

  const err = await accessError(user, mod);
  if (err) { res.status(403).json({ error: err }); return; }

  const staff = isStaffFor(user, mod);
  const reviewsRequired = mod.reviewsRequired ?? 0;
  const [reviewsGiven, mineRows] = await Promise.all([
    countReviewsGiven(user.id, sessionId),
    db
      .select({ id: assignmentSubmissionsTable.id })
      .from(assignmentSubmissionsTable)
      .where(and(
        eq(assignmentSubmissionsTable.userId, user.id),
        eq(assignmentSubmissionsTable.sessionId, sessionId),
      )),
  ]);

  const gate = { submitted: mineRows.length > 0, reviewsRequired, reviewsGiven };
  const locked = whyDiscussionLocked(gate, staff);
  const base = {
    sessionId,
    title: mod.title ?? "",
    instructions: mod.instructions ?? "",
    reviewsRequired,
    reviewsGiven,
  };
  if (locked) {
    res.json({ ...base, open: false, lockedReason: locked, pieces: [] });
    return;
  }

  const [pieces, critiques, comments] = await Promise.all([
    db
      .select({
        submissionId: assignmentSubmissionsTable.id,
        authorId: assignmentSubmissionsTable.userId,
        authorName: usersTable.name,
        body: assignmentSubmissionsTable.body,
        submittedAt: assignmentSubmissionsTable.submittedAt,
        aiUse: assignmentSubmissionsTable.aiUse,
        aiNote: assignmentSubmissionsTable.aiNote,
      })
      .from(assignmentSubmissionsTable)
      .innerJoin(usersTable, eq(usersTable.id, assignmentSubmissionsTable.userId))
      .where(and(
        eq(assignmentSubmissionsTable.sessionId, sessionId),
        // Withdrawn pieces leave the discussion and nothing else.
        isNull(assignmentSubmissionsTable.withdrawnAt),
      ))
      .orderBy(asc(assignmentSubmissionsTable.submittedAt)),
    db
      .select({
        id: submissionReviewsTable.id,
        submissionId: submissionReviewsTable.submissionId,
        comment: submissionReviewsTable.comment,
        createdAt: submissionReviewsTable.createdAt,
      })
      .from(submissionReviewsTable)
      .where(eq(submissionReviewsTable.sessionId, sessionId))
      .orderBy(asc(submissionReviewsTable.createdAt)),
    db
      .select({
        id: submissionCommentsTable.id,
        submissionId: submissionCommentsTable.submissionId,
        authorId: submissionCommentsTable.userId,
        authorName: usersTable.name,
        body: submissionCommentsTable.body,
        createdAt: submissionCommentsTable.createdAt,
      })
      .from(submissionCommentsTable)
      .innerJoin(usersTable, eq(usersTable.id, submissionCommentsTable.userId))
      .where(eq(submissionCommentsTable.sessionId, sessionId))
      .orderBy(asc(submissionCommentsTable.createdAt)),
  ]);

  res.json({
    ...base,
    open: true,
    lockedReason: "",
    pieces: pieces.map((p) => ({
      submissionId: p.submissionId,
      authorName: p.authorName,
      mine: p.authorId === user.id,
      body: p.body,
      submittedAt: p.submittedAt.toISOString(),
      aiUseLabel: aiUseLabel(p.aiUse),
      aiNote: p.aiNote,
      // Unsigned here, and signed only on the staff screen.
      critiques: critiques
        .filter((c) => c.submissionId === p.submissionId)
        .map((c) => ({ id: c.id, comment: c.comment, createdAt: c.createdAt.toISOString() })),
      comments: comments
        .filter((c) => c.submissionId === p.submissionId)
        .map((c) => ({
          id: c.id,
          authorName: c.authorName,
          mine: c.authorId === user.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
        })),
    })),
  });
});

/** Say something in the discussion. Comments are signed — this is a conversation. */
router.post("/submissions/:id/comments", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const submissionId = Number(req.params.id);
  if (!Number.isInteger(submissionId)) { res.status(400).json({ error: "That is not a piece of work." }); return; }

  const [submission] = await db
    .select({
      id: assignmentSubmissionsTable.id,
      sessionId: assignmentSubmissionsTable.sessionId,
      withdrawnAt: assignmentSubmissionsTable.withdrawnAt,
    })
    .from(assignmentSubmissionsTable)
    .where(eq(assignmentSubmissionsTable.id, submissionId));
  if (!submission) { res.status(404).json({ error: "That piece no longer exists." }); return; }
  if (submission.withdrawnAt) {
    res.status(403).json({ error: "This piece is no longer part of the discussion." });
    return;
  }

  const mod = await loadModule(submission.sessionId);
  if (!mod) { res.status(404).json({ error: "Session not found" }); return; }
  const err = await accessError(user, mod);
  if (err) { res.status(403).json({ error: err }); return; }

  const staff = isStaffFor(user, mod);
  const reviewsRequired = mod.reviewsRequired ?? 0;
  const [reviewsGiven, mineRows] = await Promise.all([
    countReviewsGiven(user.id, submission.sessionId),
    db
      .select({ id: assignmentSubmissionsTable.id })
      .from(assignmentSubmissionsTable)
      .where(and(
        eq(assignmentSubmissionsTable.userId, user.id),
        eq(assignmentSubmissionsTable.sessionId, submission.sessionId),
      )),
  ]);
  const locked = whyDiscussionLocked(
    { submitted: mineRows.length > 0, reviewsRequired, reviewsGiven },
    staff,
  );
  if (locked) { res.status(403).json({ error: locked }); return; }

  const body = typeof req.body?.body === "string" ? req.body.body : "";
  const problem = commentProblem(body);
  if (problem) { res.status(400).json({ error: problem }); return; }

  const [saved] = await db
    .insert(submissionCommentsTable)
    .values({
      submissionId,
      sessionId: submission.sessionId,
      userId: user.id,
      body: body.trim(),
    })
    .returning();

  res.status(201).json({
    id: saved.id,
    submissionId,
    authorName: user.name,
    mine: true,
    body: saved.body,
    createdAt: saved.createdAt.toISOString(),
  });
});

export default router;
