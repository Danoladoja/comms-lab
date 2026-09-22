import { describe, expect, it } from "vitest";
import {
  unlockProblem,
  unlockWarning,
  unlockNote,
  relockNote,
  openedForYouNote,
  MAX_UNLOCK_REASON,
  outstandingKeys,
  clearingList,
  clearProblem,
  clearWarning,
  clearedNote,
} from "./moduleUnlock";
import { computeProgress, EMPTY_COURSEWORK, type SessionLite } from "./progress";
import { EMPTY_PRESENCE } from "./presence";

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

/* ------------------------------------------------------------------ *
 * Clearing a module, which is the other half
 * ------------------------------------------------------------------ */

/** Module four unfinished, with staff counting it as done. */
function cleared(clearedByStaff?: ReadonlyMap<number, readonly string[]>) {
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
    clearedByStaff ? { clearedByStaff } : {},
  );
}

describe("counting a module as done", () => {
  it("completes the module it was given", () => {
    const four = cleared(new Map([[1, ["assignment"]]])).find((e) => e.sessionId === 1)!;
    expect(four.completed).toBe(true);
    expect(four.clearedByStaff).toBe(true);
    expect(four.progressPct).toBe(100);
  });

  it("opens the module after it, with no second override", () => {
    // The reason clearing exists as well as opening. An admin fixing the Lab's
    // own mistake should not have to also unstick every module behind it.
    const five = cleared(new Map([[1, ["assignment"]]])).find((e) => e.sessionId === 2)!;
    expect(five.locked).toBe(false);
    expect(five.openedByStaff).toBe(false);
  });

  it("counts towards a certificate, which an open door does not", () => {
    /*
      A certificate needs every module complete, and that is the whole
      difference between the two remedies.

      Both learners below attended both classes and owe nothing on Module five.
      The only thing standing between them and a certificate is Module four's
      unfiled task. Clearing it settles that; opening Module five leaves it
      sitting there, so the door-only learner walks the entire programme and is
      refused at the very end.

      This test first asserted that clearing alone made the whole programme
      complete, and it failed — correctly. Module five had no attendance in it,
      so it was unfinished for a reason that had nothing to do with either
      override. The fault was in the test, not the rules.
    */
    const attended = new Map([
      [1, { ...EMPTY_PRESENCE, liveSeconds: 3600, sessionSeconds: 3600 }],
      [2, { ...EMPTY_PRESENCE, liveSeconds: 3600, sessionSeconds: 3600 }],
    ]);
    const coursework = new Map([
      [1, { ...EMPTY_COURSEWORK, hasAssignment: true, assignmentSubmitted: false }],
      [2, { ...EMPTY_COURSEWORK }],
    ]);
    const run = (options: Parameters<typeof computeProgress>[6]) => computeProgress(
      SESSIONS,
      new Map(),
      new Map([[7, new Date("2026-08-01T00:00:00Z")]]),
      coursework,
      attended,
      NOW,
      options,
    );

    expect(run({ clearedByStaff: new Map([[1, ["assignment"]]]) }).every((e) => e.completed))
      .toBe(true);
    expect(run({ openedByStaff: new Set([2]) }).every((e) => e.completed))
      .toBe(false);
  });

  it("does not invent the work it sets aside", () => {
    // Clearing changes the verdict, never the evidence. An audit read
    // afterwards must still show that no task was filed.
    const four = cleared(new Map([[1, ["assignment"]]])).find((e) => e.sessionId === 1)!;
    expect(four.assignmentSubmitted).toBe(false);
    expect(four.hasAssignment).toBe(true);
  });

  it("records what was set aside", () => {
    const four = cleared(new Map([[1, ["assignment", "reviews"]]])).find((e) => e.sessionId === 1)!;
    expect(four.clearedItems).toEqual(["assignment", "reviews"]);
  });

  it("leaves every other module exactly as it was", () => {
    const five = cleared(new Map([[1, ["assignment"]]])).find((e) => e.sessionId === 2)!;
    expect(five.clearedByStaff).toBe(false);
    expect(five.clearedItems).toEqual([]);
  });

  it("says nothing was cleared when nothing was", () => {
    const four = cleared().find((e) => e.sessionId === 1)!;
    expect(four.clearedByStaff).toBe(false);
    expect(four.completed).toBe(false);
  });
});

describe("naming what is outstanding", () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    kind: "class",
    presence: { met: true },
    hasAssignment: true,
    assignmentSubmitted: true,
    reviewsGiven: 2,
    reviewsRequired: 2,
    hasQuiz: true,
    quizPassed: true,
    hasSimulation: false,
    simulationDone: false,
    ...over,
  });

  it("names nothing when everything is met", () => {
    expect(outstandingKeys(entry())).toEqual([]);
  });

  it("names the class, the task, the critiques and the quiz", () => {
    expect(outstandingKeys(entry({
      presence: { met: false },
      assignmentSubmitted: false,
      reviewsGiven: 0,
      quizPassed: false,
    }))).toEqual(["presence", "assignment", "reviews", "quiz"]);
  });

  it("never asks a simulation module for a class", () => {
    expect(outstandingKeys(entry({
      kind: "simulation",
      presence: { met: false },
      hasAssignment: false,
      hasQuiz: false,
      hasSimulation: true,
      simulationDone: false,
    }))).toEqual(["simulation"]);
  });

  it("puts the keys into the Lab's own words", () => {
    expect(clearingList(["presence", "assignment"])).toBe("the class and the written task");
    expect(clearingList(["quiz"])).toBe("the quiz");
    expect(clearingList([])).toMatch(/met every requirement/);
  });
});

describe("refusing a clearance that should not happen", () => {
  const req = (over: Partial<Parameters<typeof clearProblem>[0]> = {}) => ({
    userIds: [1],
    reason: "Their Module 4 task was lost when the page dropped the request",
    outstanding: new Map([[1, ["assignment"]]]),
    alreadyCleared: new Set<number>(),
    ...over,
  });

  it("allows the ordinary case", () => {
    expect(clearProblem(req())).toBeNull();
  });

  it("insists on a reason, because a cleared module needs explaining later", () => {
    expect(clearProblem(req({ reason: "ok" }))).toMatch(/Say why/);
  });

  it("refuses when nobody is chosen", () => {
    expect(clearProblem(req({ userIds: [] }))).toMatch(/Nobody is selected/);
  });

  it("refuses when there is nothing outstanding to set aside", () => {
    expect(clearProblem(req({ outstanding: new Map([[1, []]]) }))).toMatch(/anything outstanding/);
  });

  it("refuses when it is already counted as done", () => {
    expect(clearProblem(req({ alreadyCleared: new Set([1]) }))).toMatch(/already counted as done/);
  });
});

describe("what an admin is told before pressing it", () => {
  it("names the requirements rather than only the count", () => {
    const said = clearWarning({ count: 3, moduleTitle: "Module four", keys: ["assignment", "quiz"] });
    expect(said).toContain("the written task and the quiz");
    // The two things people get wrong about this button.
    expect(said).toContain("certificate");
    expect(said).toContain("not altered");
  });

  it("says afterwards that the next module is open", () => {
    const said = clearedNote({ cleared: 1, skipped: 0, moduleTitle: "Module four" });
    expect(said).toContain("counts as done for 1 learner");
    expect(said).toContain("module after it opens");
  });
});
