import { describe, expect, it } from "vitest";
import {
  countWords,
  wordsRequired,
  meetsWordMinimum,
  wordCountProblem,
  wordCountNotice,
  writtenWeekTotal,
  MIN_TASK_WORDS,
  MIN_CRITIQUE_WORDS,
  WORD_MINIMUMS_LIVE_FROM,
} from "./wordMinimums";

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("counting", () => {
  it("counts words the way a person would", () => {
    expect(countWords("The tariff is the story.")).toBe(5);
    // Line breaks, double spaces and tabs are all just gaps.
    expect(countWords("one\n\ntwo   three\tfour")).toBe(4);
    expect(countWords("  padded  ")).toBe(1);
  });

  it("counts nothing as nothing", () => {
    for (const empty of ["", "   ", "\n\n", null, undefined]) {
      expect(countWords(empty)).toBe(0);
    }
  });

  it("does not count a line of full stops as writing", () => {
    // The only cleverness in here, and not much: a token has to carry a letter
    // or a digit. Anybody determined to pad can still type real words — this is
    // a floor, not a detector.
    expect(countWords(". . . . . . . . . .")).toBe(0);
    expect(countWords("- — · ... !!!")).toBe(0);
    // Real writing with punctuation attached is unaffected.
    expect(countWords("Who pays? The consumer — mostly.")).toBe(5);
    // And numbers count: "12%" is a word in a sentence about tariffs.
    expect(countWords("Tariffs rose 12% in 2025")).toBe(5);
  });

  it("counts writing that is not in English", () => {
    // The Lab's cohort writes in its second language, and some of them will
    // quote in their first. A counter that reads only ASCII would tell them
    // they had written nothing.
    expect(countWords("Ìmọ̀ràn tí ó dára ni")).toBe(5);
    expect(countWords("عن الطاقة")).toBe(2);
  });
});

describe("which modules the floors apply to", () => {
  const BEFORE = "2026-09-07T22:59:00.000Z";
  const AFTER = "2026-09-21T22:59:00.000Z";

  it("leaves a module whose deadline had already passed exactly as it was", () => {
    // The first module of the cohort teaching now. Its critiques are being
    // written this week, under the rules they were set under.
    expect(wordsRequired("task", BEFORE)).toBe(0);
    expect(wordsRequired("critique", BEFORE)).toBe(0);
  });

  it("applies to every module set after it", () => {
    expect(wordsRequired("task", AFTER)).toBe(MIN_TASK_WORDS);
    expect(wordsRequired("critique", AFTER)).toBe(MIN_CRITIQUE_WORDS);
  });

  it("applies to a module with no deadline at all", () => {
    // Falling the other way would exempt every future module that never gets a
    // date, which is most of them.
    for (const none of [null, undefined, "", "nonsense"]) {
      expect(wordsRequired("task", none)).toBe(MIN_TASK_WORDS);
      expect(wordsRequired("critique", none)).toBe(MIN_CRITIQUE_WORDS);
    }
  });

  it("puts the line exactly where the constant says", () => {
    const from = "2026-09-16T00:00:00.000Z";
    expect(wordsRequired("task", "2026-09-15T23:59:59.999Z", from)).toBe(0);
    // The moment itself is not before itself, so it is in.
    expect(wordsRequired("task", from, from)).toBe(MIN_TASK_WORDS);
    expect(wordsRequired("task", "2026-09-16T00:00:00.001Z", from)).toBe(MIN_TASK_WORDS);
  });

  it("has a live-from date that is a real moment", () => {
    expect(Number.isFinite(new Date(WORD_MINIMUMS_LIVE_FROM).getTime())).toBe(true);
  });
});

describe("refusing something too short", () => {
  const LONG = words(MIN_CRITIQUE_WORDS);

  it("says how far off they are rather than just no", () => {
    const said = wordCountProblem(words(163), MIN_CRITIQUE_WORDS, "critique");
    expect(said).toContain("250 words");
    expect(said).toContain("163");
    expect(said).toContain("87");
  });

  it("names the piece in front of them", () => {
    expect(wordCountProblem("short", MIN_TASK_WORDS, "task")).toMatch(/this task needs/i);
    expect(wordCountProblem("short", MIN_CRITIQUE_WORDS, "critique")).toMatch(/a critique needs/i);
  });

  it("takes something long enough, and anything at all where there is no floor", () => {
    expect(wordCountProblem(LONG, MIN_CRITIQUE_WORDS, "critique")).toBeNull();
    expect(wordCountProblem(words(MIN_CRITIQUE_WORDS + 400), MIN_CRITIQUE_WORDS, "critique")).toBeNull();
    // An exempt module: three words is as acceptable as it was last week.
    expect(wordCountProblem("Good, tighten it", 0, "critique")).toBeNull();
    expect(meetsWordMinimum(0, 0)).toBe(true);
  });

  it("refuses an empty box", () => {
    expect(wordCountProblem("", MIN_TASK_WORDS, "task")).toBeTruthy();
    expect(wordCountProblem(null, MIN_TASK_WORDS, "task")).toBeTruthy();
  });
});

describe("the line under the box", () => {
  it("counts up rather than springing the floor at the end", () => {
    expect(wordCountNotice(163, 250)).toBe("163 of 250 words.");
    expect(wordCountNotice(0, 250)).toBe("0 of 250 words.");
  });

  it("stops nagging once they are over it", () => {
    expect(wordCountNotice(250, 250)).toMatch(/over the 250 needed/);
    expect(wordCountNotice(900, 250)).toMatch(/over the 250 needed/);
  });

  it("just counts where there is no floor", () => {
    expect(wordCountNotice(40, 0)).toBe("40 words");
    expect(wordCountNotice(1, 0)).toBe("1 word");
  });
});

describe("what a week adds up to", () => {
  it("is a thousand words, half of them on somebody else's piece", () => {
    expect(writtenWeekTotal(2)).toBe(1000);
    expect(MIN_TASK_WORDS + 2 * MIN_CRITIQUE_WORDS).toBe(1000);
  });

  it("follows the module's own number of critiques", () => {
    // A make that is not peer-reviewed is 500 words and no more.
    expect(writtenWeekTotal(0)).toBe(MIN_TASK_WORDS);
    expect(writtenWeekTotal(3)).toBe(1250);
    expect(writtenWeekTotal(-1)).toBe(MIN_TASK_WORDS);
  });
});
