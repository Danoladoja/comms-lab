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
