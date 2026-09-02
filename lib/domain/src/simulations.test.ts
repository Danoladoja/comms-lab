import { describe, expect, it } from "vitest";
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  hasSecureJoinCodeFormat,
  mayAdvanceStudioRun,
  mayCompleteStudioRun,
  mayControlStudioRun,
  mayCreateStudioRun,
  mayJoinFacilitatedRun,
  MAX_ACCESS_CODES_AT_ONCE,
  MAX_RESPONSE_SECONDS,
  MIN_RESPONSE_SECONDS,
  clampResponseSeconds,
  formatClock,
  runClock,
  whatTheClockSays,
  type RunClock,
  MAX_STUDIO_TURNS,
  MIN_STUDIO_TURNS,
  nextStudioStep,
  plannedTurns,
  practiceRecord,
  type CompletedRun,
  accessCodeCount,
  mayEnterStudio,
  maySeeStudioSimulation,
  maySeeConfidentialBrief,
  normaliseJoinCode,
  operationLeaseIsActive,
  responseVersionMatches,
} from "./simulations";

describe("Studio admission", () => {
  it("lets admins enter without an invitation or code", () => {
    expect(mayEnterStudio(true, false, false)).toBe(true);
  });

  it("requires learners to have an invitation or redeemed code", () => {
    expect(mayEnterStudio(false, false, false)).toBe(false);
    expect(mayEnterStudio(false, true, false)).toBe(true);
    expect(mayEnterStudio(false, false, true)).toBe(true);
  });
});

describe("who may do what to a run", () => {
  it("lets the owner drive, in both modes", () => {
    expect(mayControlStudioRun("autonomous", 7, 7)).toBe(true);
    expect(mayControlStudioRun("facilitated", 7, 7)).toBe(true);
  });

  it("does not let a participant skip the facilitator ahead", () => {
    // The point of a room is that everybody is on the same development at the
    // same time. One impatient participant must not move the class on.
    expect(mayControlStudioRun("facilitated", 7, 9)).toBe(false);
    expect(mayControlStudioRun("autonomous", 7, 9)).toBe(false);
  });

  it("advances only an active run that somebody has answered", () => {
    expect(mayAdvanceStudioRun("active", true)).toBe(true);
    expect(mayAdvanceStudioRun("active", false)).toBe(false);
    expect(mayAdvanceStudioRun("completed", true)).toBe(false);
  });

  it("completes only an active run", () => {
    expect(mayCompleteStudioRun("active")).toBe(true);
    expect(mayCompleteStudioRun("completed")).toBe(false);
  });

  it("starts a solo run only for the person whose exercise it is", () => {
    expect(mayCreateStudioRun("autonomous", 7, 7)).toBe(true);
    expect(mayCreateStudioRun("autonomous", 7, 9)).toBe(false);
    expect(mayCreateStudioRun("facilitated", 7, 9)).toBe(true);
  });

  it("opens a room only while it is running and has a code", () => {
    expect(mayJoinFacilitatedRun("facilitated", "active", true)).toBe(true);
    expect(mayJoinFacilitatedRun("facilitated", "completed", true)).toBe(false);
    expect(mayJoinFacilitatedRun("facilitated", "active", false)).toBe(false);
    expect(mayJoinFacilitatedRun("autonomous", "active", true)).toBe(false);
  });
});

describe("confidential briefs", () => {
  it("shows a role's private brief only to the role holding it", () => {
    // If this leaks, the exercise is over: knowing what the other side is
    // privately afraid of is the whole game.
    expect(maySeeConfidentialBrief("ministry", "ministry")).toBe(true);
    expect(maySeeConfidentialBrief("ministry", "community")).toBe(false);
    expect(maySeeConfidentialBrief(null, "community")).toBe(false);
  });
});

describe("join codes", () => {
  it("is short enough to read out to a room", () => {
    expect(JOIN_CODE_LENGTH).toBeLessThanOrEqual(8);
  });

  it("leaves out the characters people mishear and mistype", () => {
    for (const confusable of ["O", "0", "I", "1", "L"]) {
      expect(JOIN_CODE_ALPHABET).not.toContain(confusable);
    }
  });

  it("accepts a code typed in lower case, in pairs, with a dash", () => {
    expect(normaliseJoinCode("kd7-x9m")).toBe("KD7X9M");
    expect(normaliseJoinCode(" kd7 x9m ")).toBe("KD7X9M");
  });

  it("does not quietly turn a wrong code into a right one", () => {
    // Dropping the stray O leaves five characters, which fails the format
    // check, which is the honest answer. Guessing at Q would not be.
    expect(hasSecureJoinCodeFormat(normaliseJoinCode("KD7X9O"))).toBe(false);
  });

  it("recognises a code of the right shape and rejects the old long one", () => {
    expect(hasSecureJoinCodeFormat("KD7X9M")).toBe(true);
    expect(hasSecureJoinCodeFormat("A".repeat(32))).toBe(false);
    expect(hasSecureJoinCodeFormat("kd7x9m")).toBe(false);
  });
});

describe("two people acting at once", () => {
  const lease = 2 * 60 * 1000;

  it("holds while the lease is fresh", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    expect(operationLeaseIsActive(new Date(now.getTime() - 30_000), now, lease)).toBe(true);
  });

  it("lets go once it is stale, so a crash does not freeze the run", () => {
    // Somebody has to be able to carry on if the server died mid-generation.
    const now = new Date("2026-09-01T12:00:00Z");
    expect(operationLeaseIsActive(new Date(now.getTime() - lease - 1), now, lease)).toBe(false);
    expect(operationLeaseIsActive(null, now, lease)).toBe(false);
  });

  it("refuses to save over an answer written since we looked", () => {
    expect(responseVersionMatches(4, 4)).toBe(true);
    expect(responseVersionMatches(4, 5)).toBe(false);
  });
});

describe("whose exercise is it", () => {
  const mine = { ownerId: 7, programId: null, published: false };
  const cohorts = { ownerId: 7, programId: 3, published: true };

  it("is always the author's, published or not", () => {
    expect(maySeeStudioSimulation(mine, { id: 7, isAdmin: false, enrolledProgramIds: [] })).toBe(true);
  });

  it("is not somebody else's to open", () => {
    expect(maySeeStudioSimulation(mine, { id: 9, isAdmin: false, enrolledProgramIds: [3] })).toBe(false);
  });

  it("opens to everybody on the programme once it is published", () => {
    expect(maySeeStudioSimulation(cohorts, { id: 9, isAdmin: false, enrolledProgramIds: [3] })).toBe(true);
  });

  it("stays shut to somebody on a different programme", () => {
    expect(maySeeStudioSimulation(cohorts, { id: 9, isAdmin: false, enrolledProgramIds: [4] })).toBe(false);
  });

  it("stays with its author until it is published", () => {
    // Drafting one in front of the cohort would be worse than not having it.
    const draft = { ...cohorts, published: false };
    expect(maySeeStudioSimulation(draft, { id: 9, isAdmin: false, enrolledProgramIds: [3] })).toBe(false);
  });

  it("lets an administrator see anything", () => {
    expect(maySeeStudioSimulation(mine, { id: 9, isAdmin: true, enrolledProgramIds: [] })).toBe(true);
  });
});

describe("how many codes at once", () => {
  it("makes one when nothing sensible was asked for", () => {
    for (const bad of [undefined, null, 0, -4, "", "many", Number.NaN]) {
      expect(accessCodeCount(bad)).toBe(1);
    }
  });

  it("makes what was asked for, within reason", () => {
    expect(accessCodeCount(20)).toBe(20);
    expect(accessCodeCount("12")).toBe(12);
    expect(accessCodeCount(7.8)).toBe(7);
  });

  it("will not make five hundred because somebody held a key down", () => {
    expect(accessCodeCount(500)).toBe(MAX_ACCESS_CODES_AT_ONCE);
  });
});

describe("how long a solo exercise runs", () => {
  it("takes its length from the time the person said they had", () => {
    expect(plannedTurns(24)).toBe(3);
    expect(plannedTurns(32)).toBe(4);
    expect(plannedTurns(40)).toBe(5);
  });

  it("never runs an exercise too short to be one", () => {
    // Two exchanges is an anecdote. Three is the least that can turn.
    expect(plannedTurns(5)).toBe(MIN_STUDIO_TURNS);
    expect(plannedTurns(0)).toBeGreaterThanOrEqual(MIN_STUDIO_TURNS);
  });

  it("never runs one so long that attention goes", () => {
    expect(plannedTurns(240)).toBe(MAX_STUDIO_TURNS);
  });

  it("carries on until the planned number, then finishes", () => {
    expect(nextStudioStep(1, 4)).toBe("continue");
    expect(nextStudioStep(3, 4)).toBe("continue");
    expect(nextStudioStep(4, 4)).toBe("finish");
    // A run that somehow went past its length still finishes rather than
    // continuing forever, because every turn is a paid call.
    expect(nextStudioStep(9, 4)).toBe("finish");
  });
});

describe("a practice record", () => {
  const run = (over: Partial<CompletedRun> = {}): CompletedRun => ({
    endedAt: "2026-09-01T10:00:00Z",
    title: "Nine days of flare",
    score: 60,
    minutes: 30,
    ratings: [{ name: "Speed", score: 70 }, { name: "Accuracy", score: 50 }],
    ...over,
  });

  it("says nothing at all before anybody has practised", () => {
    const record = practiceRecord([]);
    expect(record.runs).toBe(0);
    expect(record.latestScore).toBeNull();
    expect(record.bestScore).toBeNull();
    expect(record.strengths).toEqual([]);
  });

  it("counts what has been done", () => {
    const record = practiceRecord([run(), run({ minutes: 45 })]);
    expect(record.runs).toBe(2);
    expect(record.minutes).toBe(75);
  });

  it("takes the latest score from the most recent run, not the last in the list", () => {
    // The list arrives in whatever order the database felt like.
    const record = practiceRecord([
      run({ endedAt: "2026-09-05T10:00:00Z", score: 80 }),
      run({ endedAt: "2026-09-01T10:00:00Z", score: 40 }),
    ]);
    expect(record.latestScore).toBe(80);
    expect(record.bestScore).toBe(80);
  });

  it("averages each thing being judged across every run that judged it", () => {
    const record = practiceRecord([
      run({ ratings: [{ name: "Speed", score: 80 }] }),
      run({ ratings: [{ name: "Speed", score: 60 }] }),
    ]);
    expect(record.strengths[0]).toEqual({ name: "Speed", score: 70, runs: 2 });
  });

  it("names what is strongest and what has not moved", () => {
    const record = practiceRecord([run()]);
    expect(record.strengths[0].name).toBe("Speed");
    expect(record.toWorkOn[0].name).toBe("Accuracy");
  });

  it("gives a trend in the order it happened, oldest first", () => {
    const record = practiceRecord([
      run({ endedAt: "2026-09-05T10:00:00Z", score: 80, title: "Second" }),
      run({ endedAt: "2026-09-01T10:00:00Z", score: 40, title: "First" }),
    ]);
    expect(record.trend.map((t) => t.title)).toEqual(["First", "Second"]);
  });

  it("has no rank, no badge and nobody else in it", () => {
    // The point of practising privately is that nobody is watching.
    const record = practiceRecord([run()]);
    expect(Object.keys(record)).not.toContain("rank");
    expect(JSON.stringify(record)).not.toMatch(/badge|percentile|leaderboard/i);
  });

  it("ignores a rating with no name or a score that is not a number", () => {
    const record = practiceRecord([run({ ratings: [
      { name: "  ", score: 90 },
      { name: "Speed", score: Number.NaN },
      { name: "Clarity", score: 55 },
    ] })]);
    expect(record.strengths.map((s) => s.name)).toEqual(["Clarity"]);
  });
});

describe("the clock", () => {
  const START = "2026-09-02T10:00:00Z";
  const at = (mins: number) => new Date(Date.parse(START) + mins * 60_000);

  it("counts the exercise down from when it started", () => {
    const clock = runClock({ startedAt: START, durationMinutes: 30, responseDueAt: null, status: "active", now: at(10) });
    // Twenty minutes left, plus the minute of grace.
    expect(clock.sessionSecondsLeft).toBe(21 * 60);
    expect(clock.sessionExpired).toBe(false);
  });

  it("does not cut somebody off mid sentence on the last turn", () => {
    // A minute of grace, deliberately, so the clock reaching zero is not the
    // same instant as the last full minute they were promised.
    const clock = runClock({ startedAt: START, durationMinutes: 30, responseDueAt: null, status: "active", now: at(30) });
    expect(clock.sessionExpired).toBe(false);
    expect(clock.sessionSecondsLeft).toBe(60);
  });

  it("expires once the time really is up", () => {
    const clock = runClock({ startedAt: START, durationMinutes: 30, responseDueAt: null, status: "active", now: at(32) });
    expect(clock.sessionSecondsLeft).toBe(0);
    expect(clock.sessionExpired).toBe(true);
  });

  it("counts the answer down to its own deadline", () => {
    const clock = runClock({
      startedAt: START, durationMinutes: 30, status: "active",
      responseDueAt: at(12), now: at(10),
    });
    expect(clock.responseSecondsLeft).toBe(120);
    expect(clock.responseExpired).toBe(false);
  });

  it("says the answer is late once its deadline passes", () => {
    const clock = runClock({ startedAt: START, durationMinutes: 30, status: "active", responseDueAt: at(9), now: at(10) });
    expect(clock.responseSecondsLeft).toBe(0);
    expect(clock.responseExpired).toBe(true);
  });

  it("has no deadline on a development that was given none", () => {
    const clock = runClock({ startedAt: START, durationMinutes: 30, status: "active", responseDueAt: null, now: at(10) });
    expect(clock.responseSecondsLeft).toBeNull();
    expect(clock.responseExpired).toBe(false);
  });

  it("stops entirely once the exercise is over", () => {
    // A finished run showing a running clock would look unfinished and would
    // keep the debrief out of the way.
    const clock = runClock({ startedAt: START, durationMinutes: 30, status: "completed", responseDueAt: at(9), now: at(40) });
    expect(clock.sessionExpired).toBe(false);
    expect(clock.responseExpired).toBe(false);
    expect(clock.responseSecondsLeft).toBeNull();
  });

  it("copes with a run that never started", () => {
    const clock = runClock({ startedAt: null, durationMinutes: 30, responseDueAt: null, status: "active" });
    expect(clock.sessionExpired).toBe(false);
    expect(clock.sessionSecondsLeft).toBe(0);
  });
});

describe("what the clock makes happen", () => {
  const clock = (over: Partial<RunClock>): RunClock => ({
    sessionSecondsLeft: 300, responseSecondsLeft: 60, sessionExpired: false, responseExpired: false, ...over,
  });

  it("ends the exercise when its time is up, in either mode", () => {
    expect(whatTheClockSays(clock({ sessionExpired: true }), "autonomous")).toBe("finish");
    expect(whatTheClockSays(clock({ sessionExpired: true }), "facilitated")).toBe("finish");
  });

  it("moves a solo exercise on when an answer is late", () => {
    // The reporter files at six whether or not you called back.
    expect(whatTheClockSays(clock({ responseExpired: true }), "autonomous")).toBe("moveOn");
  });

  it("leaves a room alone, because the facilitator is its clock", () => {
    expect(whatTheClockSays(clock({ responseExpired: true }), "facilitated")).toBe("nothing");
  });

  it("ending beats moving on when both have run out", () => {
    expect(whatTheClockSays(clock({ sessionExpired: true, responseExpired: true }), "autonomous")).toBe("finish");
  });

  it("does nothing while there is still time", () => {
    expect(whatTheClockSays(clock({}), "autonomous")).toBe("nothing");
  });
});

describe("response deadlines", () => {
  it("never sets one nobody could meet", () => {
    expect(clampResponseSeconds(5)).toBe(MIN_RESPONSE_SECONDS);
    expect(clampResponseSeconds(-30)).toBe(4 * 60);
  });

  it("never sets one so long there is no pressure", () => {
    expect(clampResponseSeconds(60 * 60)).toBe(MAX_RESPONSE_SECONDS);
  });

  it("falls back to four minutes when nothing sensible was given", () => {
    for (const bad of [undefined, null, "soon", Number.NaN]) expect(clampResponseSeconds(bad)).toBe(4 * 60);
  });
});

describe("formatClock", () => {
  it("reads like a clock", () => {
    expect(formatClock(245)).toBe("4:05");
    expect(formatClock(12)).toBe("0:12");
    expect(formatClock(0)).toBe("0:00");
  });

  it("shows nothing rather than a lie when there is no deadline", () => {
    expect(formatClock(null)).toBe("--:--");
  });
});
