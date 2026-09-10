import { describe, expect, it } from "vitest";
import {
  weekKey,
  weekStartMs,
  weekDeadline,
  weeksOfSessions,
  whyWeekLocked,
} from "./teachingWeek";

/**
 * The programme these rules were written for teaches on Tuesday and Thursday.
 * These are real dates from its calendar:
 *
 *   Mon  7 Sep 2026  — the week opens
 *   Tue  8 Sep 2026  — first class
 *   Thu 10 Sep 2026  — second class
 *   Mon 14 Sep 2026  — everything from that week is due by the end of today
 *   Tue 15 Sep 2026  — the next week's first class
 */
const TUESDAY = new Date("2026-09-08T15:00:00Z");   // 4pm in Lagos
const THURSDAY = new Date("2026-09-10T15:00:00Z");
const NEXT_TUESDAY = new Date("2026-09-15T15:00:00Z");

describe("which week a class is in", () => {
  it("puts Tuesday's class and Thursday's class in the same week", () => {
    // The whole reason this file exists.
    expect(weekKey(TUESDAY)).toBe(weekKey(THURSDAY));
    expect(weekKey(TUESDAY)).toBe("2026-09-07");
  });

  it("puts the following Tuesday in the next week", () => {
    expect(weekKey(NEXT_TUESDAY)).toBe("2026-09-14");
  });

  it("keeps Sunday night in the week that is ending, not the one beginning", () => {
    // A learner finishing at eleven on Sunday is finishing last week's work.
    const sundayNight = new Date("2026-09-13T22:00:00Z");
    expect(weekKey(sundayNight)).toBe("2026-09-07");
  });

  it("starts the week at midnight on Monday in the Lab's clock", () => {
    // Midnight in Lagos is 23:00 UTC the night before, and the week must start
    // on the Lab's clock rather than the server's.
    expect(new Date(weekStartMs(TUESDAY)).toISOString()).toBe("2026-09-06T23:00:00.000Z");
  });

  it("reads the same wherever the reader is, because the zone is fixed", () => {
    // Late Sunday night in Lagos is already Monday morning in Auckland — a
    // different week by one reader's calendar and not the other's. Which week a
    // class belongs to must not depend on who is asking, so the Lab's clock
    // settles it for everybody.
    const sundayNight = new Date("2026-09-13T22:30:00Z"); // 11:30pm Sunday in Lagos
    expect(weekKey(sundayNight)).toBe("2026-09-07");
    expect(weekKey(sundayNight, "Pacific/Auckland")).toBe("2026-09-14");
  });
});

describe("when the week's work is due", () => {
  it("closes at the last moment of the following Monday", () => {
    // Monday 14 September, 23:59:59.999 in Lagos — one millisecond before
    // Tuesday's class day begins.
    expect(weekDeadline(TUESDAY)).toBe("2026-09-14T22:59:59.999Z");
  });

  it("gives both classes of a week the same deadline", () => {
    expect(weekDeadline(THURSDAY)).toBe(weekDeadline(TUESDAY));
  });

  it("falls before the next week's first class, never after it", () => {
    // If these ever crossed, a learner would sit next week's class before this
    // week's work was even due, and the gate would be meaningless.
    expect(new Date(weekDeadline(TUESDAY)).getTime()).toBeLessThan(NEXT_TUESDAY.getTime());
    expect(new Date(weekDeadline(TUESDAY)).getTime())
      .toBeLessThan(weekStartMs(NEXT_TUESDAY) + 24 * 60 * 60 * 1000);
  });

  it("holds across a clock change in a zone that has one", () => {
    // Lagos does not move its clocks. Somewhere that does must still get a
    // deadline at the end of Monday rather than an hour either side of it.
    const beforeTheClocksGoBack = new Date("2026-10-20T15:00:00Z"); // a Tuesday
    const due = weekDeadline(beforeTheClocksGoBack, "Europe/London");
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(due));
    expect(local).toContain("Mon");
    expect(local).toContain("23:59");
  });
});

describe("weeksOfSessions", () => {
  it("groups a term's classes into their weeks", () => {
    const weeks = weeksOfSessions([
      { id: 1, startsAt: TUESDAY },
      { id: 2, startsAt: THURSDAY },
      { id: 3, startsAt: NEXT_TUESDAY },
    ]);
    expect(weeks.get(1)).toBe(weeks.get(2));
    expect(weeks.get(3)).not.toBe(weeks.get(1));
  });

  it("leaves an unscheduled class out of every week", () => {
    // It cannot be placed in the sequence, so it must neither wait on a week
    // nor hold one up.
    const weeks = weeksOfSessions([{ id: 9, startsAt: null }]);
    expect(weeks.has(9)).toBe(false);
  });
});

describe("whyWeekLocked", () => {
  it("says what is actually being asked for", () => {
    expect(whyWeekLocked()).toMatch(/both classes/i);
    expect(whyWeekLocked()).toMatch(/last week/i);
  });
});
