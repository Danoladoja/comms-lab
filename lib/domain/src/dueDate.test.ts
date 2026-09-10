import { describe, expect, it } from "vitest";
import {
  dueAtMs,
  dueDateFromInput,
  dueDateInputValue,
  dueState,
  isPastDue,
  pastDueMessage,
  CLOSING_SOON_HOURS,
} from "./dueDate";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-10T12:00:00Z").getTime();
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe("isPastDue", () => {
  it("is open with no deadline at all", () => {
    // Most modules will never have one, and those must not change behaviour.
    expect(isPastDue(null, NOW)).toBe(false);
    expect(isPastDue(undefined, NOW)).toBe(false);
    expect(isPastDue("", NOW)).toBe(false);
  });

  it("is open before the deadline and shut after it", () => {
    expect(isPastDue(iso(HOUR), NOW)).toBe(false);
    expect(isPastDue(iso(-HOUR), NOW)).toBe(true);
  });

  it("counts the deadline moment itself as still open", () => {
    // Somebody submitting on the last stroke of five has made five o'clock.
    expect(isPastDue(iso(0), NOW)).toBe(false);
    expect(isPastDue(iso(-1), NOW)).toBe(true);
  });

  it("falls open on a date it cannot read", () => {
    // The alternative is a wall a whole cohort cannot get past because one
    // field holds nonsense. A broken deadline is no deadline.
    for (const bad of ["not a date", "2026-13-45T99:99:99Z", "  "]) {
      expect(isPastDue(bad, NOW)).toBe(false);
      expect(dueAtMs(bad)).toBeNull();
    }
  });
});

describe("dueState", () => {
  it("says which of the four situations this is", () => {
    expect(dueState(null, NOW)).toBe("none");
    expect(dueState(iso(10 * 24 * HOUR), NOW)).toBe("open");
    expect(dueState(iso(3 * HOUR), NOW)).toBe("closing-soon");
    expect(dueState(iso(-HOUR), NOW)).toBe("closed");
  });

  it("starts warning exactly at the warning line, not after it", () => {
    expect(dueState(iso(CLOSING_SOON_HOURS * HOUR), NOW)).toBe("closing-soon");
    expect(dueState(iso(CLOSING_SOON_HOURS * HOUR + 1), NOW)).toBe("open");
  });
});

describe("the date box round trip", () => {
  it("survives a trip out to the box and back unchanged", () => {
    // This is the whole risk with deadlines: the box speaks local wall-clock
    // time with no zone attached, so a careless conversion quietly moves the
    // deadline by the reader's offset. Whatever clock these tests run on, a
    // moment must come back as the same moment.
    const stored = new Date("2026-09-12T17:30:00Z").toISOString();
    const backAgain = dueDateFromInput(dueDateInputValue(stored));
    expect(backAgain).toBe(stored);
  });

  it("keeps the minute the admin actually typed", () => {
    const typed = "2026-12-01T09:05";
    expect(dueDateInputValue(dueDateFromInput(typed))).toBe(typed);
  });

  it("treats an empty box as no deadline", () => {
    // The only way to lift a deadline once set, so it must be this plain.
    expect(dueDateFromInput("")).toBeNull();
    expect(dueDateFromInput("   ")).toBeNull();
    expect(dueDateFromInput(null)).toBeNull();
    expect(dueDateInputValue(null)).toBe("");
  });

  it("refuses to invent a date from something unreadable", () => {
    expect(dueDateFromInput("sometime next week")).toBeNull();
  });
});

describe("pastDueMessage", () => {
  it("tells the learner what happened and who can undo it", () => {
    for (const kind of ["quiz", "assignment"] as const) {
      const message = pastDueMessage(kind);
      expect(message).toContain(kind);
      expect(message).toMatch(/reopen/i);
    }
  });
});
