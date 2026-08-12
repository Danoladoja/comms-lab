import { Router, type IRouter } from "express";
import {
  db, sessionsTable, enrollmentsTable,
  assignmentsTable, assignmentSubmissionsTable, submissionReviewsTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  pickReviewTargets,
  validateReview,
  reviewScorePct,
  DEFAULT_RUBRIC,
  type RubricCriterion,
  type ReviewCandidate,
} from "@workspace/domain";
import { SubmitReviewBody } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { progressForUser } from "../lib/progress";

const router: IRouter = Router();

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

function isStaffFor(user: User, session: { instructorId: number | null }) {
  return user.role === "admin" || (user.role === "instructor" && session.instructorId === user.id);
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
  if (!enrollment) return "You are not enrolled in this program";
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

export default router;
