import { describe, expect, it } from "vitest";
import {
  unlockProblem,
  unlockWarning,
  unlockNote,
  relockNote,
  openedForYouNote,
  MAX_UNLOCK_REASON,
} from "./moduleUnlock";
import { computeProgress, EMPTY_COURSEWORK, type SessionLite } from "./progress";

/**
 * An override sets the Lab's own rules aside for one person, so the two things
 * worth guarding are that it is deliberate and that it is narrow: a reason on
 * the record, and a door opened without anything being marked as done.
 */

const locked = (ids: number[]) => new Map(ids.map((id) => [id, true]));

describe("refusing an unlock that should not happen", () => {
  it("refuses with nobody chosen", () => {
    expect(unlockProblem({
      userIds: [], reason: "Recording failed", lockedNow: new Map(), alreadyOpen: new Set(),
    })).toMatch(/Nobody is selected/);
  });

  it("insists on a reason", () => {
    expect(unlockProblem({
      userIds: [1], reason: "  ", lockedNow: locked([1]), alreadyOpen: new Set(),
    })).toMatch(/Say why/);
  });

  it("refuses a reason too long to sit on the record", () => {
    const problem = unlockProblem({
      userIds: [1], reason: "x".repeat(MAX_UNLOCK_REASON + 1),
      lockedNow: locked([1]), alreadyOpen: new Set(),
    });
    expect(problem).toContain(String(MAX_UNLOCK_REASON));
  });

  it("refuses when everybody chosen is already through", () => {
    expect(unlockProblem({
      userIds: [1, 2], reason: "Recording failed",
      lockedNow: new Map([[1, false], [2, false]]), alreadyOpen: new Set(),
    })).toMatch(/already open to them/);
  });

  it("refuses when everybody chosen was already opened by hand", () => {
    expect(unlockProblem({
      userIds: [1], reason: "Recording failed",
      lockedNow: locked([1]), alreadyOpen: new Set([1]),
    })).toMatch(/already open to everybody/);
  });

  it("allows it when at least one person is genuinely stuck", () => {
    expect(unlockProblem({
      userIds: [1, 2], reason: "Attendance was never measured",
      lockedNow: new Map([[1, false], [2, true]]), alreadyOpen: new Set(),
    })).toBeNull();
  });
});

describe("what people are told", () => {
  it("says plainly that nothing is completed", () => {
    const said = unlockWarning({ count: 3, moduleTitle: "Module 5" });
    expect(said).toContain("3 learners");
    // The misreading this exists to prevent.
    expect(said).toMatch(/does not complete/i);
    expect(said).toMatch(/certificate/i);
  });

  it("counts the ones left alone rather than claiming them", () => {
    expect(unlockNote({ opened: 2, skipped: 1, moduleTitle: "Module 5" }))
      .toMatch(/1 was already through/);
  });

  it("says nothing else changed when nobody was skipped", () => {
    expect(unlockNote({ opened: 1, skipped: 0, moduleTitle: "Module 5" }))
      .toMatch(/Nothing else about their record has changed/);
  });

  it("is honest when removing an override changes nothing", () => {
    expect(relockNote({ moduleTitle: "Module 5", nowLocked: false }))
      .toMatch(/still open to them/);
  });

  it("tells the learner the work is still theirs to finish", () => {
    expect(openedForYouNote("Module 5")).toMatch(/still yours to finish/);
  });
});

/* ------------------------------------------------------------------ *
 * The rule itself, through computeProgress rather than asserted.
 * ------------------------------------------------------------------ */

const NOW = Date.parse("2026-09-22T12:00:00Z");

const SESSIONS: SessionLite[] = [
  { id: 1, programId: 7, startsAt: new Date("2026-09-01T14:00:00Z"), durationMins: 60, sortOrder: 1, title: "Module four" },
  { id: 2, programId: 7, startsAt: new Date("2026-09-08T14:00:00Z"), durationMins: 60, sortOrder: 2, title: "Module five" },
];

/** Module four unfinished, so module five is shut behind it. */
function stuck(openedByStaff?: Set<number>) {
  return computeProgress(
    SESSIONS,
    new Map(),
    new Map([[7, new Date("2026-08-01T00:00:00Z")]]),
    new Map([
      [1, { ...EMPTY_COURSEWORK, hasAssignment: true, assignmentSubmitted: false }],
      [2, { ...EMPTY_COURSEWORK }],
    ]),
    new Map(),
    NOW,
    openedByStaff ? { openedByStaff } : {},
  );
}

describe("opening a module for somebody", () => {
  it("is shut without an override", () => {
    const five = stuck().find((e) => e.sessionId === 2)!;
    expect(five.locked).toBe(true);
    expect(five.lockedReason).toBeTruthy();
    expect(five.openedByStaff).toBe(false);
  });

  it("opens exactly the module it was given", () => {
    const five = stuck(new Set([2])).find((e) => e.sessionId === 2)!;
    expect(five.locked).toBe(false);
    expect(five.lockedReason).toBeNull();
    expect(five.openedByStaff).toBe(true);
  });

  it("does not complete the module it opens", () => {
    // The distinction the whole feature rests on: a door, not a grade.
    const five = stuck(new Set([2])).find((e) => e.sessionId === 2)!;
    expect(five.completed).toBe(false);
  });

  it("does not touch the module the learner is actually behind on", () => {
    const four = stuck(new Set([2])).find((e) => e.sessionId === 1)!;
    expect(four.completed).toBe(false);
    expect(four.openedByStaff).toBe(false);
  });

  it("opens nothing when the override names a module that is not there", () => {
    const five = stuck(new Set([999])).find((e) => e.sessionId === 2)!;
    expect(five.locked).toBe(true);
  });
});
