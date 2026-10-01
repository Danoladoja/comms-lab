import { describe, expect, it } from "vitest";
import {
  questionProblem,
  formProblem,
  answerProblem,
  formFaults,
  faultSummary,
  answeredCount,
  certificateHold,
  sliderSummary,
  pairedChange,
  changeNote,
  filedTally,
  MAX_WORDS_CEILING,
  standardQuestions,
  type FormQuestion,
} from "./programForm";

/**
 * This form is compulsory and it withholds a certificate, which makes every
 * refusal in it consequential. A learner who cannot file the form does not get
 * what they earned — so the tests that matter most are the ones about saying
 * precisely what is wrong, and about never refusing something that should be
 * accepted.
 */

let nextId = 1;
function q(over: Partial<FormQuestion> = {}): FormQuestion {
  return {
    id: nextId++,
    kind: "short",
    prompt: "What stayed with you?",
    help: "",
    required: true,
    config: {},
    pairKey: "",
    sortOrder: 0,
    ...over,
  };
}

describe("building a question", () => {
  it("refuses a question with nothing in it", () => {
    expect(questionProblem({ kind: "short", prompt: "   ", config: {} })).toMatch(/needs something to ask/);
  });

  it("refuses a choice with only one thing to choose", () => {
    expect(questionProblem({ kind: "choice", prompt: "Pick", config: { options: ["Only this"] } }))
      .toMatch(/at least two/);
  });

  it("refuses two options that say the same thing", () => {
    const problem = questionProblem({
      kind: "choice", prompt: "Pick", config: { options: ["Useful", "useful"] },
    });
    expect(problem).toMatch(/the same/);
  });

  it("refuses a slider whose ends are the wrong way round", () => {
    expect(questionProblem({
      kind: "slider", prompt: "Confidence", config: { min: 10, max: 2, minLabel: "a", maxLabel: "b" },
    })).toMatch(/past the near end/);
  });

  it("insists a slider says what its ends mean", () => {
    // A 7 out of 10 of what, in which direction? Unreadable a year later.
    expect(questionProblem({
      kind: "slider", prompt: "Confidence", config: { min: 0, max: 10 },
    })).toMatch(/what each end of the line means/);
  });

  it("accepts a properly labelled slider", () => {
    expect(questionProblem({
      kind: "slider",
      prompt: "How confident are you handling a hostile interview?",
      config: { min: 0, max: 10, minLabel: "Not at all", maxLabel: "Completely" },
    })).toBeNull();
  });

  it("refuses a word limit nobody will read", () => {
    expect(questionProblem({
      kind: "long", prompt: "Tell us", config: { wordsAtMost: MAX_WORDS_CEILING + 1 },
    })).toContain(String(MAX_WORDS_CEILING));
  });

  it("refuses a floor above its own ceiling", () => {
    expect(questionProblem({
      kind: "long", prompt: "Tell us", config: { wordsAtLeast: 200, wordsAtMost: 100 },
    })).toMatch(/longer than the longest/);
  });
});

describe("publishing a form", () => {
  it("refuses a form with no questions", () => {
    expect(formProblem({ questions: [], title: "Closing survey" })).toMatch(/no questions/);
  });

  it("refuses a form nothing on which has to be answered", () => {
    // Otherwise it can be filed empty, and a compulsory form that collects
    // nothing is worse than no form at all: it looks like evidence.
    expect(formProblem({
      questions: [q({ required: false })], title: "Closing survey",
    })).toMatch(/can be filed empty/);
  });

  it("names the question that is wrong rather than just refusing", () => {
    const problem = formProblem({
      questions: [q({ kind: "choice", prompt: "Which parts were useful?", config: { options: ["One"] } })],
      title: "Closing survey",
    });
    expect(problem).toContain("Which parts were useful?");
    expect(problem).toMatch(/at least two/);
  });

  it("accepts a sound form", () => {
    expect(formProblem({
      questions: [q({ config: { wordsAtMost: 80 } })], title: "Closing survey",
    })).toBeNull();
  });
});

describe("answering", () => {
  it("asks for an answer to a required question and lets an optional one pass", () => {
    expect(answerProblem(q({ required: true }), undefined)).toMatch(/needs an answer/);
    expect(answerProblem(q({ required: false }), undefined)).toBeNull();
  });

  it("enforces the word ceiling and says by how much", () => {
    const question = q({ kind: "long", config: { wordsAtMost: 10 } });
    const problem = answerProblem(question, { questionId: question.id, text: "word ".repeat(15) });
    expect(problem).toMatch(/5 words over/);
    expect(problem).toContain("10");
  });

  it("says how many more words are needed, not that the answer is invalid", () => {
    const question = q({ kind: "long", config: { wordsAtLeast: 20, wordsAtMost: 200 } });
    const problem = answerProblem(question, { questionId: question.id, text: "word ".repeat(12) });
    expect(problem).toMatch(/8 more words needed/);
  });

  it("does not hold an optional written answer to its floor", () => {
    // They chose to say something short rather than nothing. That is not a
    // fault, and refusing it teaches people to write padding.
    const question = q({ kind: "long", required: false, config: { wordsAtLeast: 50, wordsAtMost: 200 } });
    expect(answerProblem(question, { questionId: question.id, text: "It was good." })).toBeNull();
  });

  it("keeps a slider inside its line", () => {
    const question = q({ kind: "slider", config: { min: 0, max: 10, minLabel: "a", maxLabel: "b" } });
    expect(answerProblem(question, { questionId: question.id, number: 11 })).toMatch(/between 0 and 10/);
    expect(answerProblem(question, { questionId: question.id, number: 0 })).toBeNull();
  });

  it("accepts the bottom of a slider as an answer rather than as silence", () => {
    // Zero is a real answer and a meaningful one — often the most important in
    // the whole form. Treating it as unanswered would quietly drop every
    // learner who felt least confident.
    const question = q({ kind: "slider", required: true, config: { min: 0, max: 10, minLabel: "a", maxLabel: "b" } });
    expect(answerProblem(question, { questionId: question.id, number: 0 })).toBeNull();
  });

  it("refuses an answer that was never offered", () => {
    const question = q({ kind: "choice", config: { options: ["Yes", "No"] } });
    expect(answerProblem(question, { questionId: question.id, text: "Maybe" }))
      .toMatch(/not one of the answers offered/);
  });

  it("holds a multi-choice to how many it asked for", () => {
    const question = q({
      kind: "multi",
      config: { options: ["A", "B", "C", "D"], pickAtLeast: 2, pickAtMost: 3 },
    });
    expect(answerProblem(question, { questionId: question.id, choices: ["A"] })).toMatch(/at least 2/);
    expect(answerProblem(question, { questionId: question.id, choices: ["A", "B", "C", "D"] }))
      .toMatch(/no more than 3/);
    expect(answerProblem(question, { questionId: question.id, choices: ["A", "B"] })).toBeNull();
  });
});

describe("filing the whole form", () => {
  it("reports every fault at once, not the first", () => {
    const one = q({ id: 101, kind: "short", prompt: "A", config: { wordsAtMost: 5 } });
    const two = q({ id: 102, kind: "slider", prompt: "B", config: { min: 0, max: 10, minLabel: "a", maxLabel: "b" } });
    const faults = formFaults([one, two], [{ questionId: 101, text: "word ".repeat(9) }]);

    expect(faults).toHaveLength(2);
    expect(faults.map((f) => f.questionId)).toEqual([101, 102]);
  });

  it("is silent when everything is in order", () => {
    const question = q({ id: 7, kind: "short", config: { wordsAtMost: 50 } });
    expect(formFaults([question], [{ questionId: 7, text: "It changed how I brief a minister." }]))
      .toEqual([]);
    expect(faultSummary([])).toBe("");
  });

  it("counts progress against the required questions only", () => {
    const required = q({ id: 1, kind: "short", required: true, config: { wordsAtMost: 50 } });
    const optional = q({ id: 2, kind: "short", required: false, config: { wordsAtMost: 50 } });
    expect(answeredCount([required, optional], [{ questionId: 1, text: "Done" }]))
      .toEqual({ answered: 1, required: 1 });
  });
});

describe("what the form holds up", () => {
  it("holds nothing when no form is published", () => {
    expect(certificateHold({ formPublished: false, filed: false, workComplete: true }).held).toBe(false);
  });

  it("holds nothing once it is filed", () => {
    expect(certificateHold({ formPublished: true, filed: true, workComplete: true }).held).toBe(false);
  });

  it("holds the certificate when the work is done and the form is not", () => {
    const hold = certificateHold({
      formPublished: true, filed: false, workComplete: true, formTitle: "How did we do?",
    });
    expect(hold.held).toBe(true);
    expect(hold.note).toContain("How did we do?");
    expect(hold.note).toMatch(/certificate/);
  });

  it("warns before it bites, without withholding anything yet", () => {
    // Said from the day it is published rather than discovered at the end.
    // A requirement nobody mentioned until it bit is this codebase's most
    // repeated apology.
    const hold = certificateHold({ formPublished: true, filed: false, workComplete: false });
    expect(hold.held).toBe(false);
    expect(hold.note).toMatch(/last step before your certificate/);
  });
});

describe("reading it back", () => {
  it("averages a slider to one decimal place", () => {
    expect(sliderSummary([3, 4, 4])).toEqual({ count: 3, mean: 3.7, lowest: 3, highest: 4 });
  });

  it("says nothing rather than zero when nobody answered", () => {
    expect(sliderSummary([])).toEqual({ count: 0, mean: null, lowest: null, highest: null });
  });

  it("reports a movement with the counts behind it", () => {
    const change = pairedChange({ before: [3, 3, 4], after: [7, 8, 6] });
    expect(change).toEqual({ before: 3.3, after: 7, change: 3.7, beforeCount: 3, afterCount: 3 });
    expect(changeNote({ prompt: "Confidence", change })).toContain("up 3.7");
    expect(changeNote({ prompt: "Confidence", change })).toContain("3 and 3 answers");
  });

  it("refuses to report a movement with nothing on one side", () => {
    // An impressive number computed from one side is how a programme claims an
    // outcome it cannot support.
    expect(pairedChange({ before: [], after: [8, 9] })).toBeNull();
    expect(changeNote({ prompt: "x", change: null })).toMatch(/Not enough answers/);
  });

  it("reports a fall as plainly as a rise", () => {
    const change = pairedChange({ before: [8, 8], after: [5, 5] });
    expect(changeNote({ prompt: "x", change })).toContain("down 3");
  });

  it("counts who has filed", () => {
    expect(filedTally({ enrolled: 45, filed: 45 })).toMatch(/All 45/);
    expect(filedTally({ enrolled: 45, filed: 44 })).toMatch(/1 is still to come/);
    expect(filedTally({ enrolled: 0, filed: 0 })).toMatch(/Nobody is enrolled/);
  });
});

describe("the standard forms", () => {
  it("offers both stages and they are publishable as they stand", () => {
    for (const stage of ["before", "after"] as const) {
      const questions = standardQuestions(stage).map((qn, i) => ({ ...qn, id: i + 1 }));
      expect(formProblem({ questions, title: "Standard" })).toBeNull();
    }
  });

  it("asks the same sliders on both sides, so there is something to compare", () => {
    // Without shared pair keys the closing survey is a satisfaction score and
    // the impact report has nothing to stand on.
    const before = new Set(standardQuestions("before").filter(x => x.pairKey).map(x => x.pairKey));
    const after = new Set(standardQuestions("after").filter(x => x.pairKey).map(x => x.pairKey));
    const shared = [...before].filter(k => after.has(k));
    expect(shared.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps the compulsory writing down to what people will actually do", () => {
    const writing = standardQuestions("after")
      .filter(x => (x.kind === "long" || x.kind === "short") && x.required);
    expect(writing.length).toBeLessThanOrEqual(2);
  });

  it("names both ends of every slider", () => {
    for (const stage of ["before", "after"] as const) {
      for (const qn of standardQuestions(stage).filter(x => x.kind === "slider")) {
        expect(questionProblem(qn)).toBeNull();
      }
    }
  });
});
