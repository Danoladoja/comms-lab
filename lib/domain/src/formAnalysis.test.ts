import { describe, expect, it } from "vitest";
import { aggregate, pairUp, reportText, responsesCsv } from "./formAnalysis";
import type { FormQuestion } from "./programForm";

/**
 * The two ways a survey report lies: a number computed from too few answers,
 * and a mean standing in for a cohort that is actually split down the middle.
 * Most of these tests are about making both visible rather than preventing
 * them, because an M&E officer needs the number either way — they just need to
 * know what it is worth.
 */

const q = (over: Partial<FormQuestion> = {}): FormQuestion => ({
  id: 1, kind: "slider", prompt: "How confident?", help: "", required: true,
  config: { min: 0, max: 10, minLabel: "a", maxLabel: "b" },
  pairKey: "", sortOrder: 0, section: "",
  ...over,
});

describe("summarising one question", () => {
  it("gives the mean and the spread, because they are different findings", () => {
    // Mean 5 from a cohort that mostly said 0 or 10 is not a cohort that
    // mostly said 5, and only the spread shows that.
    const agg = aggregate(q({ id: 1 }), [
      { questionId: 1, number: 0 }, { questionId: 1, number: 0 },
      { questionId: 1, number: 10 }, { questionId: 1, number: 10 },
    ]);
    expect(agg.shape).toBe("numeric");
    if (agg.shape !== "numeric") return;
    expect(agg.mean).toBe(5);
    expect(agg.spread).toEqual([{ value: 0, count: 2 }, { value: 10, count: 2 }]);
  });

  it("says nothing rather than zero when nobody answered", () => {
    const agg = aggregate(q({ id: 1 }), []);
    if (agg.shape !== "numeric") throw new Error("wrong shape");
    expect(agg.count).toBe(0);
    expect(agg.mean).toBeNull();
  });

  it("counts a single choice as a share of the people who answered", () => {
    const question = q({ id: 2, kind: "choice", config: { options: ["Yes", "No"] } });
    const agg = aggregate(question, [
      { questionId: 2, text: "Yes" }, { questionId: 2, text: "Yes" }, { questionId: 2, text: "No" },
    ]);
    if (agg.shape !== "tally") throw new Error("wrong shape");
    expect(agg.count).toBe(3);
    expect(agg.options).toEqual([
      { option: "Yes", count: 2, pct: 67 },
      { option: "No", count: 1, pct: 33 },
    ]);
  });

  it("counts a multi-choice against people, not against picks", () => {
    // Two people, three picks. "100% said Media" is the sentence somebody
    // wants; percentages of picks would say 67% and mean nothing.
    const question = q({ id: 3, kind: "multi", config: { options: ["Media", "Policy"] } });
    const agg = aggregate(question, [
      { questionId: 3, choices: ["Media", "Policy"] },
      { questionId: 3, choices: ["Media"] },
    ]);
    if (agg.shape !== "tally") throw new Error("wrong shape");
    expect(agg.count).toBe(2);
    expect(agg.options[0]).toEqual({ option: "Media", count: 2, pct: 100 });
    expect(agg.options[1]).toEqual({ option: "Policy", count: 1, pct: 50 });
  });

  it("leaves out an answer to an option that no longer exists", () => {
    const question = q({ id: 4, kind: "choice", config: { options: ["Yes"] } });
    const agg = aggregate(question, [{ questionId: 4, text: "Maybe" }]);
    if (agg.shape !== "tally") throw new Error("wrong shape");
    expect(agg.options[0].count).toBe(0);
  });

  it("gathers written answers and says how long they typically are", () => {
    const question = q({ id: 5, kind: "long", config: {} });
    const agg = aggregate(question, [
      { questionId: 5, text: "one two three" },
      { questionId: 5, text: "   " },
      { questionId: 5, text: "one two three four five" },
    ]);
    if (agg.shape !== "written") throw new Error("wrong shape");
    expect(agg.count).toBe(2);
    expect(agg.medianWords).toBe(4);
  });
});

describe("before against after", () => {
  const before = q({ id: 10, pairKey: "confidence", prompt: "How confident are you?" });
  const after = q({ id: 20, pairKey: "confidence", prompt: "How confident are you now?" });

  it("matches on the key, not the wording", () => {
    // The two are deliberately worded differently, which is why matching on
    // text would drop exactly the pairs worth having.
    const pairs = pairUp({
      beforeQuestions: [before], afterQuestions: [after],
      beforeAnswers: Array.from({ length: 6 }, () => ({ questionId: 10, number: 3 })),
      afterAnswers: Array.from({ length: 6 }, () => ({ questionId: 20, number: 7 })),
    });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].prompt).toBe("How confident are you now?");
    expect(pairs[0].movement?.change).toBe(4);
    expect(pairs[0].note).toContain("up 4");
    expect(pairs[0].note).toContain("6 and 6 answers");
  });

  it("warns on its face when there are too few answers to lean on", () => {
    // The caveat goes on the figure rather than in a footnote, because the
    // figure is what gets copied into a report.
    const pairs = pairUp({
      beforeQuestions: [before], afterQuestions: [after],
      beforeAnswers: [{ questionId: 10, number: 2 }],
      afterAnswers: [{ questionId: 20, number: 9 }],
    });
    expect(pairs[0].note).toMatch(/too few to lean on/);
  });

  it("reports a fall as plainly as a rise", () => {
    const pairs = pairUp({
      beforeQuestions: [before], afterQuestions: [after],
      beforeAnswers: Array.from({ length: 6 }, () => ({ questionId: 10, number: 8 })),
      afterAnswers: Array.from({ length: 6 }, () => ({ questionId: 20, number: 6 })),
    });
    expect(pairs[0].note).toContain("down 2");
  });

  it("says there is nothing to compare when one side is empty", () => {
    const pairs = pairUp({
      beforeQuestions: [before], afterQuestions: [after],
      beforeAnswers: [], afterAnswers: [{ questionId: 20, number: 7 }],
    });
    expect(pairs[0].movement).toBeNull();
    expect(pairs[0].note).toMatch(/one side has no answers/);
  });

  it("ignores questions asked at only one end", () => {
    const lonely = q({ id: 30, pairKey: "", prompt: "Anything else?" });
    const pairs = pairUp({
      beforeQuestions: [before], afterQuestions: [after, lonely],
      beforeAnswers: [], afterAnswers: [],
    });
    expect(pairs).toHaveLength(1);
  });

  it("pairs a choice question without pretending to average it", () => {
    const b = q({ id: 40, kind: "choice", pairKey: "freq", config: { options: ["Never", "Weekly"] } });
    const a = q({ id: 41, kind: "choice", pairKey: "freq", config: { options: ["Never", "Weekly"] } });
    const pairs = pairUp({
      beforeQuestions: [b], afterQuestions: [a],
      beforeAnswers: [{ questionId: 40, text: "Never" }],
      afterAnswers: [{ questionId: 41, text: "Weekly" }],
    });
    expect(pairs[0].movement).toBeNull();
    expect(pairs[0].note).toMatch(/Compare the two breakdowns/);
  });
});

describe("getting it out", () => {
  it("writes a report that carries its own caveat", () => {
    const before = q({ id: 10, pairKey: "c", prompt: "How confident?" });
    const after = q({ id: 20, pairKey: "c", prompt: "How confident now?" });
    const pairs = pairUp({
      beforeQuestions: [before], afterQuestions: [after],
      beforeAnswers: Array.from({ length: 8 }, () => ({ questionId: 10, number: 3 })),
      afterAnswers: Array.from({ length: 8 }, () => ({ questionId: 20, number: 7 })),
    });
    const text = reportText({
      programmeTitle: "AfriEnergy Comms Lab", enrolled: 45,
      beforeFiled: 40, afterFiled: 38, pairs, generatedAt: "1 October 2026",
    });
    expect(text).toContain("AFRIENERGY COMMS LAB");
    expect(text).toContain("45 enrolled");
    expect(text).toContain("How confident now?");
    expect(text).toMatch(/fewer than five people/);
  });

  it("says plainly when there is nothing paired to report", () => {
    expect(reportText({
      programmeTitle: "x", enrolled: 1, beforeFiled: 0, afterFiled: 0,
      pairs: [], generatedAt: "today",
    })).toMatch(/no change to report/);
  });

  it("writes a spreadsheet that survives a comma in an answer", () => {
    const question = q({ id: 1, kind: "long", prompt: "What changed?" });
    const csv = responsesCsv({
      questions: [question],
      rows: [{ who: "Ama", submittedAt: "2026-10-01", answers: [{ questionId: 1, text: 'He said "go", then left' }] }],
    });
    expect(csv.split("\n")[0]).toBe('"Filed at","Who","What changed?"');
    expect(csv).toContain('"He said ""go"", then left"');
  });

  it("leaves the name blank rather than inventing a person called Anonymous", () => {
    const question = q({ id: 1, kind: "short", prompt: "Anything else?" });
    const csv = responsesCsv({
      questions: [question],
      rows: [{ who: null, submittedAt: "2026-10-01", answers: [{ questionId: 1, text: "No" }] }],
    });
    expect(csv).toContain('"2026-10-01","",');
  });

  it("joins multiple choices so a spreadsheet can read them", () => {
    const question = q({ id: 1, kind: "multi", prompt: "Which?", config: { options: ["A", "B"] } });
    const csv = responsesCsv({
      questions: [question],
      rows: [{ who: null, submittedAt: "x", answers: [{ questionId: 1, choices: ["A", "B"] }] }],
    });
    expect(csv).toContain('"A; B"');
  });
});
