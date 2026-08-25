/**
 * Peer critique — how a learner's review queue is chosen.
 *
 * Craft is learned by editing someone else's mess, and peer critique is the
 * only assessment that scales without instructor hours. Two rules make it work:
 *
 *   1. You must submit before you can review. Otherwise the queue is a way to
 *      read everyone else's answer before writing your own.
 *   2. You must review before you can read your own feedback. This is what
 *      keeps the loop from starving — everyone has a reason to show up.
 *
 * Targets are picked on demand rather than pre-assigned, so a learner who
 * submits late still gets a queue and a cohort with uneven submission times
 * still ends up with even coverage.
 */

export const DEFAULT_REVIEWS_REQUIRED = 2;

export type ReviewCandidate = {
  submissionId: number;
  authorId: number;
  /** Reviews this submission has already received, from anyone. */
  reviewCount: number;
  submittedAt: Date;
};

/**
 * Choose which submissions a reviewer should critique next.
 *
 * Least-reviewed first (so nobody's work goes unseen), oldest submission as the
 * tie-break (so the person who filed first is not left waiting), submission id
 * last so the result is stable for a given database state.
 */
export function pickReviewTargets(
  candidates: ReviewCandidate[],
  reviewerId: number,
  alreadyReviewedSubmissionIds: Iterable<number>,
  needed: number,
): ReviewCandidate[] {
  if (needed <= 0) return [];
  const seen = new Set(alreadyReviewedSubmissionIds);
  return candidates
    .filter((c) => c.authorId !== reviewerId && !seen.has(c.submissionId))
    .sort(
      (a, b) =>
        a.reviewCount - b.reviewCount ||
        a.submittedAt.getTime() - b.submittedAt.getTime() ||
        a.submissionId - b.submissionId,
    )
    .slice(0, needed);
}

export type RubricCriterion = {
  id: string;
  label: string;
  description: string;
  /** Scores run 1..maxScore. Keep the scale short — long scales collapse to "4". */
  maxScore: number;
};

/**
 * The default rubric for an energy-communications "make". Facilitators can
 * replace it per assignment; this is what they start from.
 *
 * Every criterion is about the craft, not about effort or presentation. A
 * reviewer scoring "sourcing" has to point at a sentence.
 */
export const DEFAULT_RUBRIC: RubricCriterion[] = [
  {
    id: "lede",
    label: "The lede",
    description: "Is the most important thing first? Quote the sentence you think is the real story.",
    maxScore: 4,
  },
  {
    id: "sourcing",
    label: "Sourcing",
    description: "Is every claim attributable? Name one claim that needs a source it does not have.",
    maxScore: 4,
  },
  {
    id: "accuracy",
    label: "Technical accuracy",
    description:
      "Units, terminology, and scale — capacity vs generation, MW vs MWh, tariffs vs subsidies. Flag anything you would have to check.",
    maxScore: 4,
  },
  {
    id: "clarity",
    label: "Plain language",
    description: "Could a reader outside the sector follow it? Point to the most jargon-heavy sentence.",
    maxScore: 4,
  },
  {
    id: "stakes",
    label: "Stakes",
    description: "Is it clear who is affected and how? Name the person whose life this story changes.",
    maxScore: 4,
  },
];

export function isValidRubric(rubric: unknown): rubric is RubricCriterion[] {
  return (
    Array.isArray(rubric) &&
    rubric.length > 0 &&
    rubric.every(
      (c) =>
        !!c &&
        typeof c === "object" &&
        typeof (c as RubricCriterion).id === "string" &&
        (c as RubricCriterion).id.length > 0 &&
        typeof (c as RubricCriterion).label === "string" &&
        typeof (c as RubricCriterion).maxScore === "number" &&
        (c as RubricCriterion).maxScore >= 2 &&
        (c as RubricCriterion).maxScore <= 10,
    )
  );
}

/**
 * A review is only useful if it says something. Scores alone are noise, so a
 * minimum comment length is enforced — it is the cheapest possible guard
 * against "good job" reviews.
 */
export const MIN_REVIEW_COMMENT_LENGTH = 120;

export type ReviewScores = Record<string, number>;

export function validateReview(
  rubric: RubricCriterion[],
  scores: ReviewScores,
  comment: string,
): string | null {
  for (const criterion of rubric) {
    const score = scores[criterion.id];
    if (typeof score !== "number" || !Number.isInteger(score)) {
      return `Score missing for "${criterion.label}"`;
    }
    if (score < 1 || score > criterion.maxScore) {
      return `Score for "${criterion.label}" must be between 1 and ${criterion.maxScore}`;
    }
  }
  if (comment.trim().length < MIN_REVIEW_COMMENT_LENGTH) {
    return `Write at least ${MIN_REVIEW_COMMENT_LENGTH} characters of feedback — say what you would change and why`;
  }
  return null;
}

/** Mean score across criteria, normalised to 0-100. Shown to the author, never used as a gate. */
export function reviewScorePct(rubric: RubricCriterion[], scores: ReviewScores): number {
  if (rubric.length === 0) return 0;
  const total = rubric.reduce((sum, c) => sum + (scores[c.id] ?? 0) / c.maxScore, 0);
  return Math.round((total / rubric.length) * 100);
}
