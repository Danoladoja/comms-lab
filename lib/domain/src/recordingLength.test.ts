import { describe, expect, it } from "vitest";
import {
  plausibleRecordingLength,
  settleRecordingLength,
  FALLBACK_MIN_RECORDING_SECONDS,
} from "./recordingLength";

const NINETY_MIN = 90;

describe("is this a believable recording length", () => {
  it("refuses the one-second answer that forged full attendance", () => {
    // The whole reason this file exists: "the recording is 1 second long and I
    // watched 1 second of it" was a complete module and a certificate.
    expect(plausibleRecordingLength(1, NINETY_MIN)).toBe(false);
    expect(plausibleRecordingLength(15, NINETY_MIN)).toBe(false);
    expect(plausibleRecordingLength(60, NINETY_MIN)).toBe(false);
  });

  it("accepts a recording of about the right length", () => {
    expect(plausibleRecordingLength(90 * 60, NINETY_MIN)).toBe(true);
    // Ended twenty minutes early.
    expect(plausibleRecordingLength(70 * 60, NINETY_MIN)).toBe(true);
    // Overran, or Meet kept rolling after everyone left.
    expect(plausibleRecordingLength(140 * 60, NINETY_MIN)).toBe(true);
  });

  it("allows a recording that started late without allowing a stub", () => {
    // A quarter of the class is the floor: late start, yes; one minute, no.
    expect(plausibleRecordingLength(23 * 60, NINETY_MIN)).toBe(true);
    expect(plausibleRecordingLength(20 * 60, NINETY_MIN)).toBe(false);
  });

  it("refuses something absurdly longer than the class", () => {
    expect(plausibleRecordingLength(8 * 60 * 60, NINETY_MIN)).toBe(false);
  });

  it("refuses nonsense of every shape", () => {
    for (const bad of [0, -1, NaN, Infinity, null, undefined]) {
      expect(plausibleRecordingLength(bad, NINETY_MIN)).toBe(false);
    }
  });

  it("falls back to a floor when the class has no scheduled length", () => {
    expect(plausibleRecordingLength(1, null)).toBe(false);
    expect(plausibleRecordingLength(FALLBACK_MIN_RECORDING_SECONDS - 1, null)).toBe(false);
    expect(plausibleRecordingLength(FALLBACK_MIN_RECORDING_SECONDS, null)).toBe(true);
    expect(plausibleRecordingLength(45 * 60, 0)).toBe(true);
  });
});

describe("settling the length for the whole cohort", () => {
  it("takes the first plausible report", () => {
    expect(settleRecordingLength({ stored: null, reported: 88 * 60, scheduledMins: NINETY_MIN }))
      .toBe(88 * 60);
  });

  it("never lets a later learner move it", () => {
    // The point of the fix: the denominator belongs to the recording, not to
    // the person watching, so nobody can shrink their own.
    expect(settleRecordingLength({ stored: 5400, reported: 1, scheduledMins: NINETY_MIN }))
      .toBe(5400);
    expect(settleRecordingLength({ stored: 5400, reported: 99999, scheduledMins: NINETY_MIN }))
      .toBe(5400);
  });

  it("leaves it unsettled rather than accepting a bad first report", () => {
    // Refusing costs nothing — the next learner's report settles it. Accepting
    // a bad one would set the denominator for the entire cohort.
    expect(settleRecordingLength({ stored: null, reported: 1, scheduledMins: NINETY_MIN }))
      .toBeNull();
    expect(settleRecordingLength({ stored: null, reported: null, scheduledMins: NINETY_MIN }))
      .toBeNull();
  });

  it("rounds a fractional report", () => {
    expect(settleRecordingLength({ stored: null, reported: 5399.6, scheduledMins: NINETY_MIN }))
      .toBe(5400);
  });
});
