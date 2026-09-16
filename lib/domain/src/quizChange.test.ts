import { describe, expect, it } from "vitest";
import { sameQuiz, type ComparableQuestion } from "./quizChange";

const q = (over: Partial<ComparableQuestion> = {}): ComparableQuestion => ({
  prompt: "What does a 240% band-A tariff rise mean for a small trader?",
  options: ["Nothing", "Higher costs", "Lower costs", "It depends on the grid"],
  correctIndex: 1,
  ...over,
});

describe("has the quiz actually changed", () => {
  it("says no when nothing was touched", () => {
    // The case that matters: a facilitator opens the editor only to set a due
    // date. Erasing the cohort's passes for that un-completes their modules,
    // re-locks the following week and breaks issued certificates.
    expect(sameQuiz([q(), q({ prompt: "Second question" })], [q(), q({ prompt: "Second question" })]))
      .toBe(true);
  });

  it("ignores whitespace nobody would notice", () => {
    expect(sameQuiz([q()], [q({ prompt: "  What does a 240%   band-A tariff rise mean for a small trader? " })]))
      .toBe(true);
  });

  it("says yes when the wording changed", () => {
    expect(sameQuiz([q()], [q({ prompt: "Something else entirely" })])).toBe(false);
  });

  it("says yes when the right answer moved", () => {
    // Same words, different answer. A pass on the old version is meaningless.
    expect(sameQuiz([q()], [q({ correctIndex: 2 })])).toBe(false);
  });

  it("says yes when the options changed", () => {
    expect(sameQuiz([q()], [q({ options: ["Nothing", "Much higher costs", "Lower costs", "It depends on the grid"] })]))
      .toBe(false);
    expect(sameQuiz([q()], [q({ options: ["Nothing", "Higher costs"] })])).toBe(false);
  });

  it("says yes when the options were reordered", () => {
    // The right answer is now behind a different letter.
    expect(sameQuiz([q()], [q({ options: ["Higher costs", "Nothing", "Lower costs", "It depends on the grid"] })]))
      .toBe(false);
  });

  it("says yes when a question was added or removed", () => {
    expect(sameQuiz([q()], [q(), q({ prompt: "A new one" })])).toBe(false);
    expect(sameQuiz([q(), q({ prompt: "A new one" })], [q()])).toBe(false);
  });

  it("says yes when the questions were reordered", () => {
    const a = q({ prompt: "First" });
    const b = q({ prompt: "Second" });
    expect(sameQuiz([a, b], [b, a])).toBe(false);
  });

  it("treats two empty quizzes as unchanged", () => {
    expect(sameQuiz([], [])).toBe(true);
  });
});
