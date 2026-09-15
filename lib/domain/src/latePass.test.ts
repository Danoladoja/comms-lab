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
