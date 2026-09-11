import { describe, expect, it } from "vitest";
import {
  discussionOpen,
  whyDiscussionLocked,
  commentProblem,
  MAX_COMMENT_CHARS,
  type DiscussionGate,
} from "./cohortDiscussion";

const gate = (over: Partial<DiscussionGate> = {}): DiscussionGate => ({
  submitted: true,
  reviewsRequired: 2,
  reviewsGiven: 2,
  ...over,
});

describe("who gets into the discussion", () => {
  it("opens once you have filed and critiqued", () => {
    expect(discussionOpen(gate())).toBe(true);
    expect(whyDiscussionLocked(gate())).toBeNull();
  });

  it("stays shut until you have written your own piece", () => {
    // Otherwise it is a way to read everyone's answer before writing yours.
    const locked = gate({ submitted: false, reviewsGiven: 0 });
    expect(discussionOpen(locked)).toBe(false);
    expect(whyDiscussionLocked(locked)).toMatch(/submit your own piece/i);
  });

  it("stays shut while critiques are owed, and counts them", () => {
    expect(whyDiscussionLocked(gate({ reviewsGiven: 1 }))).toMatch(/^One more critique/);
    expect(whyDiscussionLocked(gate({ reviewsGiven: 0 }))).toMatch(/^2 more critiques/);
  });

  it("is open on a module with no peer critique", () => {
    // Nothing is owed, so nothing is withheld.
    expect(discussionOpen(gate({ reviewsRequired: 0, reviewsGiven: 0 }))).toBe(true);
  });

  it("counts extra critiques as more than enough", () => {
    expect(discussionOpen(gate({ reviewsGiven: 5 }))).toBe(true);
  });

  it("lets staff in without doing the exercise", () => {
    expect(discussionOpen(gate({ submitted: false, reviewsGiven: 0 }), true)).toBe(true);
    expect(whyDiscussionLocked(gate({ submitted: false }), true)).toBeNull();
  });
});

describe("what counts as a comment", () => {
  it("turns away a one-word reply", () => {
    expect(commentProblem("Agreed")).toMatch(/say a little more/i);
    expect(commentProblem("")).toMatch(/say a little more/i);
    expect(commentProblem("           ")).toMatch(/say a little more/i);
    expect(commentProblem(null)).toMatch(/say a little more/i);
  });

  it("takes a real one", () => {
    expect(commentProblem("The tariff figure in your third paragraph is the story.")).toBeNull();
  });

  it("stops somebody pasting a novel into a thread", () => {
    expect(commentProblem("x".repeat(MAX_COMMENT_CHARS))).toBeNull();
    expect(commentProblem("x".repeat(MAX_COMMENT_CHARS + 1))).toMatch(/keep it under/i);
  });
});
