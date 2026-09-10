import { LAB_TIME_ZONE } from "./courseworkPost";

/**
 * The teaching week.
 *
 * Some programmes are taught a module at a time and unlock a module at a time.
 * This one is taught a week at a time: two classes, Tuesday and Thursday, and
 * everything from that week — both classes attended or watched, both quizzes,
 * both tasks — due before the next week begins.
 *
 * That difference is not cosmetic. Under module-by-module locking, Thursday's
 * class is shut until Tuesday's is finished, and Tuesday's cannot be finished
 * until its quiz is in — which is not due until the following Monday. A cohort
 * taught this way would find the second class of every week locked against
 * them. The week, not the module, has to be the unit.
 *
 * Everything here is worked out in one fixed clock. A week is a run of days on
 * somebody's wall, and "which week is this class in" must not change depending
 * on where the server happens to be running or where the learner is sitting.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 24 * 60 * 60 * 1000;

type Parts = {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  /** 0 = Sunday, as JavaScript counts them. */
  weekday: number;
};

function partsIn(ms: number, timeZone: string): Parts {
  const bits = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ms));

  const at = (type: string) => bits.find((b) => b.type === type)?.value ?? "0";
  return {
    year: Number(at("year")),
    month: Number(at("month")),
    day: Number(at("day")),
    // Some runtimes render midnight as 24 rather than 00.
    hour: Number(at("hour")) % 24,
    minute: Number(at("minute")),
    second: Number(at("second")),
    weekday: Math.max(0, WEEKDAYS.indexOf(at("weekday"))),
  };
}

/** How far the zone is from UTC at a given instant, in milliseconds. */
function offsetAt(ms: number, timeZone: string): number {
  const p = partsIn(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
}

/**
 * The instant at which a given wall-clock time occurs in a zone.
 *
 * The offset is applied twice on purpose. The first pass uses the offset at the
 * wrong instant, which is right except across a daylight-saving boundary; the
 * second settles it. Lagos has not moved its clocks since 1980, but this rule
 * will outlive the assumption that the Lab only teaches from Lagos.
 */
function instantOfLocal(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number, ms: number,
  timeZone: string,
): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const once = naive - offsetAt(naive, timeZone);
  return naive - offsetAt(once, timeZone);
}

/** Midnight on the Monday that opens this class's week, as an instant. */
export function weekStartMs(when: Date | number, timeZone = LAB_TIME_ZONE): number {
  const ms = when instanceof Date ? when.getTime() : when;
  const p = partsIn(ms, timeZone);
  // Monday is day 0 of a teaching week; Sunday closes it.
  const sinceMonday = (p.weekday + 6) % 7;
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day) - sinceMonday * DAY_MS);
  return instantOfLocal(
    monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(),
    0, 0, 0, 0, timeZone,
  );
}

/**
 * A name for the week, which is the date of its Monday.
 *
 * Used only to tell one week from another, so it is a plain readable string
 * rather than a number nobody could check by eye in a log.
 */
export function weekKey(when: Date | number, timeZone = LAB_TIME_ZONE): string {
  const ms = when instanceof Date ? when.getTime() : when;
  const p = partsIn(ms, timeZone);
  const sinceMonday = (p.weekday + 6) % 7;
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day) - sinceMonday * DAY_MS);
  return monday.toISOString().slice(0, 10);
}

/**
 * When this class's week closes: the end of the following Monday.
 *
 * Tuesday and Thursday are taught; Friday, the weekend and Monday are for
 * finishing. The deadline is the last moment of Monday — a minute later and the
 * next Tuesday's class has begun.
 */
export function weekDeadline(when: Date | number, timeZone = LAB_TIME_ZONE): string {
  const monday = new Date(weekStartMs(when, timeZone));
  // Eight days on the calendar, then back one millisecond: the instant before
  // the following Tuesday starts. Counted in days rather than milliseconds so a
  // clock change in between cannot shift it by an hour.
  const p = partsIn(monday.getTime(), timeZone);
  const nextTuesday = new Date(Date.UTC(p.year, p.month - 1, p.day) + 8 * DAY_MS);
  const opensAt = instantOfLocal(
    nextTuesday.getUTCFullYear(), nextTuesday.getUTCMonth() + 1, nextTuesday.getUTCDate(),
    0, 0, 0, 0, timeZone,
  );
  return new Date(opensAt - 1).toISOString();
}

/**
 * Which week each class belongs to.
 *
 * A class with no date belongs to no week: it cannot be placed in the sequence,
 * so it neither waits on a week nor holds one up.
 */
export function weeksOfSessions(
  sessions: { id: number; startsAt: Date | null }[],
  timeZone = LAB_TIME_ZONE,
): Map<number, string> {
  const weeks = new Map<number, string>();
  for (const s of sessions) {
    if (s.startsAt) weeks.set(s.id, weekKey(s.startsAt, timeZone));
  }
  return weeks;
}

/** Why a class is shut when a programme runs week by week. */
export function whyWeekLocked(): string {
  return "Finish last week — both classes, both quizzes, both tasks — to open this";
}
