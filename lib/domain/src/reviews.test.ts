import { describe, expect, it } from "vitest";
import {
  pickReviewTargets,
  validateReview,
  reviewScorePct,
  isValidRubric,
  DEFAULT_RUBRIC,
  MIN_REVIEW_COMMENT_LENGTH,
  type ReviewCandidate,
} from "./reviews";

// By default a higher submissionId means a later submission, which is what the
// database produces. Pass minutesAgo explicitly to test the tie-break directly.
function candidate(
  submissionId: number,
  authorId: number,
  reviewCount = 0,
  minutesAgo = 100 - submissionId,
): ReviewCandidate {
  return {
    submissionId,
    authorId,
    reviewCount,
    submittedAt: new Date(Date.UTC(2026, 8, 10, 12, -minutesAgo)),
  };
}

describe("pickReviewTargets", () => {
  it("never hands a learner their own submission", () => {
    const targets = pickReviewTargets([candidate(1, 7), candidate(2, 8)], 7, [], 2);
    expect(targets.map((t) => t.submissionId)).toEqual([2]);
  });

  it("skips submissions the reviewer has already critiqued", () => {
    const pool = [candidate(1, 10), candidate(2, 11), candidate(3, 12)];
    const targets = pickReviewTargets(pool, 99, [2], 2);
    expect(targets.map((t) => t.submissionId)).toEqual([1, 3]);
  });

  it("prefers the least-reviewed work so nobody goes unseen", () => {
    const pool = [
      candidate(1, 10, 3),
      candidate(2, 11, 0),
      candidate(3, 12, 1),
    ];
    const targets = pickReviewTargets(pool, 99, [], 2);
    expect(targets.map((t) => t.submissionId)).toEqual([2, 3]);
  });

  it("breaks ties by who submitted first", () => {
    const early = candidate(5, 10, 0, 100);
    const late = candidate(4, 11, 0, 5);
    const targets = pickReviewTargets([late, early], 99, [], 1);
    expect(targets[0].submissionId).toBe(5);
  });

  it("returns fewer than requested rather than repeating work", () => {
    const targets = pickReviewTargets([candidate(1, 10)], 99, [], 3);
    expect(targets).toHaveLength(1);
  });

  it("returns nothing when no reviews are required", () => {
    expect(pickReviewTargets([candidate(1, 10)], 99, [], 0)).toEqual([]);
  });

  it("is stable — the same database state yields the same queue", () => {
    const pool = [candidate(1, 10, 1), candidate(2, 11, 1), candidate(3, 12, 1)];
    const first = pickReviewTargets(pool, 99, [], 2).map((t) => t.submissionId);
    const second = pickReviewTargets([...pool].reverse(), 99, [], 2).map((t) => t.submissionId);
    expect(first).toEqual(second);
  });
});

describe("validateReview", () => {
  const goodComment = "x".repeat(MIN_REVIEW_COMMENT_LENGTH);
  const fullScores = Object.fromEntries(DEFAULT_RUBRIC.map((c) => [c.id, 3]));

  it("accepts a complete review", () => {
    expect(validateReview(DEFAULT_RUBRIC, fullScores, goodComment)).toBeNull();
  });

  it("rejects a missing criterion score", () => {
    const { lede: _omitted, ...rest } = fullScores;
    expect(validateReview(DEFAULT_RUBRIC, rest, goodComment)).toMatch(/The lede/);
  });

  it("rejects an out-of-range score", () => {
    expect(validateReview(DEFAULT_RUBRIC, { ...fullScores, lede: 9 }, goodComment)).toMatch(
      /between 1 and 4/,
    );
  });

  it("rejects a drive-by 'good job' review", () => {
    expect(validateReview(DEFAULT_RUBRIC, fullScores, "good job")).toMatch(/at least/);
  });

  it("does not count whitespace towards the minimum", () => {
    expect(validateReview(DEFAULT_RUBRIC, fullScores, "  " + " ".repeat(300))).toMatch(/at least/);
  });
});

describe("reviewScorePct", () => {
  it("returns 100 for full marks", () => {
    const scores = Object.fromEntries(DEFAULT_RUBRIC.map((c) => [c.id, c.maxScore]));
    expect(reviewScorePct(DEFAULT_RUBRIC, scores)).toBe(100);
  });

  it("normalises across criteria with different scales", () => {
    const rubric = [
      { id: "a", label: "A", description: "", maxScore: 4 },
      { id: "b", label: "B", description: "", maxScore: 10 },
    ];
    expect(reviewScorePct(rubric, { a: 2, b: 5 })).toBe(50);
  });

  it("is 0 for an empty rubric rather than NaN", () => {
    expect(reviewScorePct([], {})).toBe(0);
  });
});

describe("isValidRubric", () => {
  it("accepts the default rubric", () => {
    expect(isValidRubric(DEFAULT_RUBRIC)).toBe(true);
  });

  it("rejects an empty rubric", () => {
    expect(isValidRubric([])).toBe(false);
  });

  it("rejects a criterion with an absurd scale", () => {
    expect(isValidRubric([{ id: "a", label: "A", description: "", maxScore: 100 }])).toBe(false);
  });

  it("rejects non-arrays", () => {
    expect(isValidRubric({ id: "a" })).toBe(false);
    expect(isValidRubric(null)).toBe(false);
  });
});
