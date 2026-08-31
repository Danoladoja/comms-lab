import { describe, expect, it } from "vitest";
import {
  MIN_SESSION_MINUTES,
  sessionDateTimeFromInput,
  sessionDateTimeInput,
  sessionMinutes,
} from "./sessionTime";

describe("sessionDateTimeInput", () => {
  it("shows the time in the reader's own clock", () => {
    // Built from local parts and read back as local parts, so this holds in
    // Lagos, London or anywhere else the Lab is being administered from.
    const at = new Date(2026, 10, 5, 18, 30);
    expect(sessionDateTimeInput(at.toISOString())).toBe("2026-11-05T18:30");
  });

  it("pads single digits, which the input requires", () => {
    const at = new Date(2026, 0, 9, 9, 5);
    expect(sessionDateTimeInput(at.toISOString())).toBe("2026-01-09T09:05");
  });

  it.each([null, undefined, "", "not a date"])("gives an empty box for %s", (value) => {
    expect(sessionDateTimeInput(value as string)).toBe("");
  });
});

describe("sessionDateTimeFromInput", () => {
  it("reads the box back as the same instant", () => {
    const at = new Date(2026, 10, 5, 18, 30);
    expect(sessionDateTimeFromInput("2026-11-05T18:30")).toBe(at.toISOString());
  });

  it.each([null, undefined, "", "   "])("treats %s as nothing scheduled", (value) => {
    expect(sessionDateTimeFromInput(value as string)).toBeNull();
  });

  it("refuses nonsense rather than inventing a date", () => {
    expect(sessionDateTimeFromInput("tomorrow-ish")).toBeNull();
  });
});

describe("the round trip", () => {
  it("does not move a class by an hour when the form is saved untouched", () => {
    // The bug this module exists to prevent. Opening the editor and pressing
    // Save must leave the time exactly where the admin put it.
    for (const at of [
      new Date(2026, 0, 15, 8, 0),    // winter
      new Date(2026, 6, 15, 20, 45),  // summer, on the far side of any DST shift
      new Date(2026, 2, 29, 1, 30),   // the small hours near a clock change
    ]) {
      const iso = at.toISOString();
      expect(sessionDateTimeFromInput(sessionDateTimeInput(iso))).toBe(iso);
    }
  });

  it("survives being opened and saved ten times over", () => {
    let iso = new Date(2026, 10, 5, 18, 30).toISOString();
    const first = iso;
    for (let i = 0; i < 10; i++) iso = sessionDateTimeFromInput(sessionDateTimeInput(iso)) ?? "";
    expect(iso).toBe(first);
  });
});

describe("sessionMinutes", () => {
  it("keeps a sensible number", () => {
    expect(sessionMinutes("90")).toBe(90);
    expect(sessionMinutes(45)).toBe(45);
  });

  it("never returns a class shorter than the API will accept", () => {
    expect(sessionMinutes("1")).toBe(MIN_SESSION_MINUTES);
    expect(sessionMinutes(-30)).toBe(MIN_SESSION_MINUTES);
    expect(sessionMinutes("0")).toBe(MIN_SESSION_MINUTES);
  });

  it("falls back when the box is empty or nonsense", () => {
    expect(sessionMinutes("")).toBe(90);
    expect(sessionMinutes("abc")).toBe(90);
    expect(sessionMinutes(null, 60)).toBe(60);
  });

  it("rounds rather than passing a fraction to the API", () => {
    expect(sessionMinutes("90.6")).toBe(91);
  });
});
