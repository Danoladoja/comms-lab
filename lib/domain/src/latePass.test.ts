import { describe, expect, it } from "vitest";
import {
  latePassState,
  canClaimLatePass,
  lateSubmissionProblem,
  latePassWindowEnd,
  withinLatePassWindow,
  passesLeft,
  latePassBalance,
  latePassOffer,
  canClaimForModule,
  latePassCovers,
  LATE_PASSES_PER_PROGRAMME,
  LATE_PASS_HOURS,
  type LatePassFacts,
} from "./latePass";

const DUE = "2026-09-14T23:59:00.000Z";
const at = (iso: string) => new Date(iso).getTime();

const facts = (over: Partial<LatePassFacts> = {}): LatePassFacts => ({
  dueAt: DUE,
  now: at("2026-09-14T12:00:00.000Z"),
  used: 0,
  claimedHere: false,
  ...over,
});

describe("the extra time a pass buys", () => {
  it("runs 48 hours from the deadline", () => {
    expect(latePassWindowEnd(DUE)).toBe("2026-09-16T23:59:00.000Z");
  });

  it("is nothing at all when there was no deadline", () => {
    expect(latePassWindowEnd(null)).toBeNull();
    expect(latePassWindowEnd("not a date")).toBeNull();
  });

  it("starts after the deadline and ends on the dot", () => {
    // The deadline moment itself is still on time, matching isPastDue.
    expect(withinLatePassWindow(DUE, at(DUE))).toBe(false);
    expect(withinLatePassWindow(DUE, at(DUE) + 1)).toBe(true);
    expect(withinLatePassWindow(DUE, at("2026-09-16T23:59:00.000Z"))).toBe(true);
    expect(withinLatePassWindow(DUE, at("2026-09-16T23:59:00.001Z"))).toBe(false);
  });
});

describe("when a pass is offered", () => {
  it("is not offered while the task is still open", () => {
    expect(latePassState(facts())).toBe("not-needed");
    expect(canClaimLatePass(facts())).toBe(false);
    // And an on-time submission is never refused.
    expect(lateSubmissionProblem(facts())).toBeNull();
  });

  it("is offered once the deadline has gone", () => {
    const late = facts({ now: at("2026-09-15T09:00:00.000Z") });
    expect(latePassState(late)).toBe("available");
    expect(canClaimLatePass(late)).toBe(true);
    // Offered, but the door is still shut until they actually spend one.
    expect(lateSubmissionProblem(late)).toMatch(/use one of your late passes/i);
  });

  it("opens the door once one is spent here", () => {
    const claimed = facts({ now: at("2026-09-15T09:00:00.000Z"), used: 1, claimedHere: true });
    expect(latePassState(claimed)).toBe("in-use");
    expect(lateSubmissionProblem(claimed)).toBeNull();
    // And cannot be spent twice on the same task.
    expect(canClaimLatePass(claimed)).toBe(false);
  });

  it("stops offering once both are gone", () => {
    const spent = facts({ now: at("2026-09-15T09:00:00.000Z"), used: LATE_PASSES_PER_PROGRAMME });
    expect(latePassState(spent)).toBe("none-left");
    expect(canClaimLatePass(spent)).toBe(false);
    expect(lateSubmissionProblem(spent)).toMatch(/used both/i);
  });

  it("shuts for good once the extra time has run out", () => {
    const over = facts({ now: at("2026-09-17T00:00:00.000Z") });
    expect(latePassState(over)).toBe("too-late");
    expect(canClaimLatePass(over)).toBe(false);
    expect(lateSubmissionProblem(over)).toMatch(/run out/i);
  });

  it("shuts for good even for somebody already inside their extra time", () => {
    // A pass buys 48 hours, not an open door.
    const over = facts({ now: at("2026-09-17T00:00:00.000Z"), used: 1, claimedHere: true });
    expect(latePassState(over)).toBe("too-late");
    expect(lateSubmissionProblem(over)).toMatch(/run out/i);
  });

  it("leaves a task with no deadline completely alone", () => {
    // Most modules have no deadline and must behave exactly as they always have.
    for (const dueAt of [null, undefined, "", "nonsense"]) {
      const none = facts({ dueAt, now: at("2030-01-01T00:00:00.000Z") });
      expect(latePassState(none)).toBe("no-deadline");
      expect(lateSubmissionProblem(none)).toBeNull();
      expect(canClaimLatePass(none)).toBe(false);
    }
  });
});

describe("what the learner is told", () => {
  it("counts what is left", () => {
    expect(passesLeft(0)).toBe(2);
    expect(passesLeft(1)).toBe(1);
    expect(passesLeft(2)).toBe(0);
    // However the counting went, it never goes below nothing.
    expect(passesLeft(9)).toBe(0);
    expect(latePassBalance(0)).toBe("2 late passes left.");
    expect(latePassBalance(1)).toBe("1 late pass left.");
    expect(latePassBalance(2)).toMatch(/no late passes left/i);
  });

  it("says the price before they spend it", () => {
    const first = latePassOffer(0);
    expect(first).toContain(`${LATE_PASS_HOURS} more hours`);
    expect(first).toContain("one left");
    // Including the cost nobody thinks of: a late piece may go uncritiqued.
    expect(first).toMatch(/less feedback/i);
    expect(latePassOffer(1)).toContain("none left");
  });
});

/**
 * A pass belongs to the module, not to one piece of it.
 *
 * It was written for the written task alone, because a quiz is auto-marked and
 * retakeable and so looked like it had nothing to rescue. What that missed is
 * that a shut quiz leaves the module incomplete and the next week locked — the
 * same loss, by a different road.
 */
describe("one pass, both doors", () => {
  const QUIZ_DUE = "2026-09-14T23:59:00.000Z";
  const WORK_DUE = "2026-09-14T23:59:00.000Z";

  const pieces = (now: number, used = 0, claimedHere = false): LatePassFacts[] => [
    { dueAt: QUIZ_DUE, now, used, claimedHere },
    { dueAt: WORK_DUE, now, used, claimedHere },
  ];

  it("opens the quiz for somebody who spent the pass on the writing", () => {
    // `claimedHere` is true of the module, so it is true of both pieces. This
    // is the whole omission, in one assertion.
    const inside = at("2026-09-15T09:00:00.000Z");
    const [quiz] = pieces(inside, 1, true);
    expect(latePassState(quiz)).toBe("in-use");
    expect(lateSubmissionProblem(quiz, "quiz")).toBeNull();
  });

  it("can be spent when only one of the two deadlines has gone", () => {
    // The quiz shut last night; the writing is not due until Friday. That is
    // still a module a pass can open.
    const now = at("2026-09-15T09:00:00.000Z");
    const split: LatePassFacts[] = [
      { dueAt: QUIZ_DUE, now, used: 0, claimedHere: false },
      { dueAt: "2026-09-18T23:59:00.000Z", now, used: 0, claimedHere: false },
    ];
    expect(canClaimForModule(split)).toBe(true);
    // Asked about the writing alone, the answer would have been no — which is
    // why the question is asked of the module.
    expect(canClaimLatePass(split[1])).toBe(false);
  });

  it("is not offered while both are still open", () => {
    expect(canClaimForModule(pieces(at("2026-09-14T12:00:00.000Z")))).toBe(false);
  });

  it("is not offered once both windows have run out", () => {
    expect(canClaimForModule(pieces(at("2026-09-17T12:00:00.000Z")))).toBe(false);
  });

  it("is not offered to somebody who has spent both", () => {
    expect(canClaimForModule(pieces(at("2026-09-15T09:00:00.000Z"), 2))).toBe(false);
  });

  it("each piece keeps its own 48 hours", () => {
    // One pass, but two doors that shut at their own times. A pass spent on a
    // Monday quiz does not hold a Friday assignment open until Sunday.
    const now = at("2026-09-17T09:00:00.000Z");
    const quiz: LatePassFacts = { dueAt: QUIZ_DUE, now, used: 1, claimedHere: true };
    const work: LatePassFacts = { dueAt: "2026-09-18T23:59:00.000Z", now, used: 1, claimedHere: true };
    expect(latePassState(quiz)).toBe("too-late");
    expect(latePassState(work)).toBe("not-needed");
  });
});

describe("what a pass says it opens", () => {
  it("names both when the module has both", () => {
    expect(latePassCovers("2026-09-14T23:59:00.000Z", "2026-09-14T23:59:00.000Z", "quiz")).toBe("both");
    const offer = latePassOffer(0, "both");
    expect(offer).toMatch(/both the quiz and the written task/i);
    expect(offer).toMatch(/less feedback/i);
  });

  it("names only the piece that has a deadline", () => {
    expect(latePassCovers("2026-09-14T23:59:00.000Z", null, "assignment")).toBe("quiz");
    expect(latePassCovers(null, "2026-09-14T23:59:00.000Z", "quiz")).toBe("assignment");
    // Nothing due anywhere: describe whatever the learner is looking at.
    expect(latePassCovers(null, null, "quiz")).toBe("quiz");
  });

  it("does not warn a quiz-only module about critiques it will never get", () => {
    // There is no piece to critique, so the sentence would be nonsense.
    const offer = latePassOffer(0, "quiz");
    expect(offer).toContain("on this quiz");
    expect(offer).not.toMatch(/feedback/i);
  });

  it("words a refusal for the thing in front of the learner", () => {
    const shut: LatePassFacts = {
      dueAt: "2026-09-14T23:59:00.000Z",
      now: at("2026-09-15T09:00:00.000Z"),
      used: 0,
      claimedHere: false,
    };
    expect(lateSubmissionProblem(shut, "quiz")).toMatch(/reopen this quiz/i);
    expect(lateSubmissionProblem(shut, "assignment")).toMatch(/reopen this task/i);
    // The old single-argument call sites keep the wording they had.
    expect(lateSubmissionProblem(shut)).toMatch(/reopen this task/i);
  });
});
