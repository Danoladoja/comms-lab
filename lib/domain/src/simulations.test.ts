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
  maySeeConfidentialBrief,
  normaliseJoinCode,
  operationLeaseIsActive,
  responseVersionMatches,
} from "./simulations";

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
