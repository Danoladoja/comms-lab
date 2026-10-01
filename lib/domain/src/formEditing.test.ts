import { describe, expect, it } from "vitest";
import {
  editProblem, deleteProblem, editWarning, canMove, moved, reorderProblem,
} from "./formEditing";
import type { FormQuestion } from "./programForm";

/**
 * Every test here is about one thing: an answer already given must not be
 * turned into a different answer by somebody tidying up a form. The failures
 * this prevents are all silent — they produce a report that is wrong in a way
 * nobody can see from the report.
 */

const question = (over: Partial<FormQuestion> = {}): FormQuestion => ({
  id: 1, kind: "choice", prompt: "Which?", help: "", required: true,
  config: { options: ["Media", "Government", "NGO"] },
  pairKey: "", sortOrder: 0, section: "A",
  ...over,
});

const edit = (over: Record<string, unknown> = {}) => ({
  kind: "choice", prompt: "Which?", help: "", required: true,
  config: { options: ["Media", "Government", "NGO"] }, section: "A",
  ...over,
}) as Parameters<typeof editProblem>[0]["after"];

describe("editing a question nobody has answered", () => {
  it("allows anything at all", () => {
    expect(editProblem({
      before: question(),
      after: edit({ kind: "long", config: { wordsAtMost: 100 } }),
      answered: 0,
    })).toBeNull();
  });
});

describe("editing a question people have answered", () => {
  it("refuses a change of kind", () => {
    // The numbers would survive and stop meaning what they meant.
    const problem = editProblem({
      before: question({ kind: "slider", config: { min: 0, max: 10 } }),
      after: edit({ kind: "rating", config: { scale: 5 } }),
      answered: 12,
    });
    expect(problem).toMatch(/12 people have/);
    expect(problem).toMatch(/one kind of question to another/);
  });

  it("refuses removing an option somebody may have picked, and names it", () => {
    const problem = editProblem({
      before: question(),
      after: edit({ config: { options: ["Media", "Government"] } }),
      answered: 3,
    });
    expect(problem).toContain('"NGO"');
    expect(problem).toMatch(/nobody offered/);
  });

  it("allows adding an option", () => {
    expect(editProblem({
      before: question(),
      after: edit({ config: { options: ["Media", "Government", "NGO", "Research"] } }),
      answered: 3,
    })).toBeNull();
  });

  it("allows rewording", () => {
    expect(editProblem({
      before: question(),
      after: edit({ prompt: "Which best describes your organisation?" }),
      answered: 9,
    })).toBeNull();
  });

  it("refuses shortening a rating scale", () => {
    const problem = editProblem({
      before: question({ kind: "rating", config: { scale: 5 } }),
      after: edit({ kind: "rating", config: { scale: 3 } }),
      answered: 20,
    });
    expect(problem).toMatch(/above the top of the scale/);
  });

  it("allows lengthening a rating scale", () => {
    expect(editProblem({
      before: question({ kind: "rating", config: { scale: 5 } }),
      after: edit({ kind: "rating", config: { scale: 7 } }),
      answered: 20,
    })).toBeNull();
  });

  it("refuses narrowing a slider", () => {
    const problem = editProblem({
      before: question({ kind: "slider", config: { min: 0, max: 10 } }),
      after: edit({ kind: "slider", config: { min: 0, max: 5 } }),
      answered: 8,
    });
    expect(problem).toMatch(/outside the scale/);
  });

  it("allows widening a slider", () => {
    expect(editProblem({
      before: question({ kind: "slider", config: { min: 0, max: 10 } }),
      after: edit({ kind: "slider", config: { min: 0, max: 12 } }),
      answered: 8,
    })).toBeNull();
  });

  it("refuses a kind the form cannot ask at all", () => {
    expect(editProblem({ before: question(), after: edit({ kind: "essay" }), answered: 0 }))
      .toMatch(/not a kind of question/);
  });
});

describe("deleting a question", () => {
  it("allows it while nobody has answered", () => {
    expect(deleteProblem({ answered: 0, prompt: "Which?" })).toBeNull();
  });

  it("refuses once somebody has, and says what to do instead", () => {
    const problem = deleteProblem({ answered: 4, prompt: "Which?" });
    expect(problem).toMatch(/4 people have/);
    expect(problem).toMatch(/make it optional/);
  });
});

describe("warning before an allowed edit", () => {
  it("says nothing when nobody has answered", () => {
    expect(editWarning({ answered: 0, rewording: true })).toBe("");
  });

  it("says nothing when the wording is unchanged", () => {
    expect(editWarning({ answered: 10, rewording: false })).toBe("");
  });

  it("warns that earlier answers were given to the old wording", () => {
    expect(editWarning({ answered: 10, rewording: true })).toMatch(/old wording/);
  });
});

describe("moving questions around", () => {
  it("knows where a question can go", () => {
    expect(canMove(0, 3)).toEqual({ up: false, down: true });
    expect(canMove(2, 3)).toEqual({ up: true, down: false });
    expect(canMove(1, 3)).toEqual({ up: true, down: true });
  });

  it("swaps with its neighbour", () => {
    expect(moved([1, 2, 3], 2, "up")).toEqual([2, 1, 3]);
    expect(moved([1, 2, 3], 2, "down")).toEqual([1, 3, 2]);
  });

  it("does nothing at the ends", () => {
    expect(moved([1, 2, 3], 1, "up")).toEqual([1, 2, 3]);
    expect(moved([1, 2, 3], 3, "down")).toEqual([1, 2, 3]);
  });

  it("does nothing for a question that is not there", () => {
    expect(moved([1, 2, 3], 9, "up")).toEqual([1, 2, 3]);
  });

  it("refuses an ordering that does not cover the form", () => {
    expect(reorderProblem({ given: [1, 2], known: [1, 2, 3] })).toMatch(/every question/);
    expect(reorderProblem({ given: [1, 2, 9], known: [1, 2, 3] })).toMatch(/not on this form/);
    expect(reorderProblem({ given: [1, 2, 2], known: [1, 2, 3] })).toMatch(/same question twice/);
    expect(reorderProblem({ given: [3, 1, 2], known: [1, 2, 3] })).toBeNull();
  });
});
