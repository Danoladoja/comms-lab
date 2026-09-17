/**
 * A deadline moved for one learner, by an admin.
 *
 * The late pass is the learner's own remedy and it is deliberately narrow: two
 * per programme, forty-eight hours each, spent without having to ask. It covers
 * the dead grid and the sick child. It cannot cover somebody added to a cohort
 * three weeks in, somebody whose two passes are already gone, or any reason
 * that does not fit inside forty-eight hours — and for all of those the app
 * said "talk to the team", while the team had nothing to act with but the
 * database.
 *
 * The design decision that makes this small: an extension does not add a new
 * exception to every gate. It replaces the date those gates already read. The
 * quiz door, the submission door, the late-pass arithmetic and the dashboard
 * all keep working exactly as they did, on a different number.
 *
 * What it must NOT move is the rules the module was taught under. `wordsRequired`
 * is anchored to a module's own deadline precisely so that a module whose
 * deadline had already passed when the word floors arrived keeps the rules its
 * cohort actually worked to. Dragging that forward with an extension would ask a
 * late learner for five hundred words nobody else on that module was asked for —
 * a punishment disguised as a favour. Hence `taughtUnder` below, which exists to
 * be passed where the original date is what matters.
 */

/**
 * The deadline a learner is actually held to.
 *
 * The later of the two, always. An extension earlier than the real deadline
 * would be a shortening, and shortening one learner's deadline is not a thing
 * this tool is for; it would also make "grant an extension" capable of doing
 * harm by a typo. Taking the later date means the worst a mistyped extension
 * can do is nothing.
 */
export function effectiveDueAt(
  moduleDueAt: string | null | undefined,
  extendedTo: string | null | undefined,
): string | null {
  const base = moduleDueAt ?? null;
  const extended = extendedTo ?? null;
  if (!extended) return base;
  // No deadline at all beats any extension: a module nobody has dated is open,
  // and giving it a date here would shut a door that was never there.
  if (!base) return null;

  const baseMs = new Date(base).getTime();
  const extMs = new Date(extended).getTime();
  if (!Number.isFinite(extMs)) return base;
  if (!Number.isFinite(baseMs)) return extended;
  return extMs > baseMs ? extended : base;
}

/**
 * The date the module's rules were set under.
 *
 * Always the module's own deadline, never the extension. Named rather than
 * inlined because the distinction is the whole reason this file is careful, and
 * a bare `assignment.dueAt` at a call site three hundred lines away does not
 * announce that using the other one would be a bug.
 */
export function taughtUnder(moduleDueAt: string | null | undefined): string | null {
  return moduleDueAt ?? null;
}

/**
 * Why this extension cannot be granted, if it cannot.
 *
 * Every one of these is a mistake an admin makes at speed while a learner waits,
 * so each says the number it read as well as the rule it broke.
 */
export function extensionProblem(facts: {
  /** What the admin typed, as an ISO string. */
  newDueAt: string | null | undefined;
  /** The module's own deadline. */
  moduleDueAt: string | null | undefined;
  nowMs: number;
  /** How far ahead an extension may reach, in days. */
  maxDaysAhead?: number;
}): string | null {
  const maxDays = facts.maxDaysAhead ?? MAX_EXTENSION_DAYS;
  if (!facts.newDueAt) return "Choose the new date and time first.";

  const ms = new Date(facts.newDueAt).getTime();
  if (!Number.isFinite(ms)) return "That date could not be read. Pick it from the calendar.";

  if (ms <= facts.nowMs) {
    return "That is in the past, so it would not reopen anything. Pick a date and time still to come.";
  }

  if (!facts.moduleDueAt) {
    return "This module has no deadline, so there is nothing to extend — the work is already open.";
  }

  const baseMs = new Date(facts.moduleDueAt).getTime();
  if (Number.isFinite(baseMs) && ms <= baseMs) {
    return "That is earlier than the module's own deadline, so it would change nothing. "
      + "Pick a date after it.";
  }

  if (ms > facts.nowMs + maxDays * 24 * 60 * 60 * 1000) {
    return `That is more than ${maxDays} days away. If somebody needs longer than that, `
      + "the question is probably which cohort they are on rather than one deadline.";
  }

  return null;
}

/**
 * A ceiling, so a slipped keystroke cannot open a door for a decade.
 *
 * Ninety days is past the end of any cohort the Lab has run, so it refuses
 * nothing real while still catching the year typed as 2027.
 */
export const MAX_EXTENSION_DAYS = 90;

/** How the extension reads back to the admin who granted it. */
export function extensionNote(facts: {
  learnerName: string;
  moduleTitle: string;
  extendedTo: string;
  /** Whether the module's own deadline has already gone. */
  moduleAlreadyClosed: boolean;
}): string {
  const who = facts.learnerName.trim() || "This learner";
  const when = describeWhen(facts.extendedTo);
  return facts.moduleAlreadyClosed
    ? `${who} can now file ${facts.moduleTitle} — quiz and written task — until ${when}. It was shut.`
    : `${who} has until ${when} for ${facts.moduleTitle}, rather than the cohort's deadline.`;
}

/**
 * The same thing said about a group.
 *
 * Kept separate from the one-learner version rather than made to serve both.
 * "Kwame Mensah can now file Energy Fundamentals" and "23 learners can now file
 * Energy Fundamentals" are different sentences, and the generic one that covers
 * both reads like neither.
 */
export function manyExtensionsNote(facts: {
  count: number;
  moduleTitle: string;
  extendedTo: string;
  moduleAlreadyClosed: boolean;
}): string {
  const when = describeWhen(facts.extendedTo);
  const who = `${facts.count} learners`;
  return facts.moduleAlreadyClosed
    ? `${who} can now file ${facts.moduleTitle} — quiz and written task — until ${when}. It was shut.`
    : `${who} have until ${when} for ${facts.moduleTitle}, rather than the cohort's deadline.`;
}

/**
 * A date a person can read, without a formatting library.
 *
 * Deliberately plain: this appears in an email and in an admin panel, and the
 * one thing it must never be is ambiguous about which day it means.
 */
export function describeWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  }).format(d);
}
