/**
 * Deadlines for a module's quiz and written task.
 *
 * A due date is optional. Most modules will not have one, and a module without
 * one behaves exactly as it always has — open indefinitely.
 *
 * Two things live here, and only two, because they are the parts with a right
 * answer:
 *
 *   - whether the deadline has passed, which the server decides and the browser
 *     only mirrors. A learner whose clock is a day slow must not get an extra
 *     day, and one whose clock is fast must not lose one.
 *   - the round trip between the date box in the admin's browser and the way
 *     the moment is stored, which is where deadlines usually go wrong.
 *
 * How the date is *worded* is deliberately not here. A deadline is a wall-clock
 * moment, and only the browser knows the reader's clock, so the words are put
 * together where that is known.
 */

/** Inside this many hours of the deadline, a learner is warned rather than reassured. */
export const CLOSING_SOON_HOURS = 48;

export type DueState = "none" | "open" | "closing-soon" | "closed";

/**
 * The stored moment as a number, or null if there isn't one.
 *
 * Anything unreadable counts as no deadline at all. A corrupt date must not
 * become a wall a cohort cannot get past: the failure has to fall open.
 */
export function dueAtMs(dueAt?: string | null): number | null {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Has the deadline passed?
 *
 * The moment itself is still open — a deadline of five o'clock includes five
 * o'clock exactly, which is what anybody submitting on the last stroke expects.
 */
export function isPastDue(dueAt: string | null | undefined, now: number): boolean {
  const ms = dueAtMs(dueAt);
  return ms !== null && now > ms;
}

export function dueState(dueAt: string | null | undefined, now: number): DueState {
  const ms = dueAtMs(dueAt);
  if (ms === null) return "none";
  if (now > ms) return "closed";
  return ms - now <= CLOSING_SOON_HOURS * 60 * 60 * 1000 ? "closing-soon" : "open";
}

/** What a learner is told when they arrive after the door has shut. */
export function pastDueMessage(kind: "quiz" | "assignment"): string {
  return kind === "quiz"
    ? "The deadline for this quiz has passed, so it can no longer be submitted. Ask the team if you need it reopened."
    : "The deadline for this assignment has passed, so it can no longer be submitted. Ask the team if you need it reopened.";
}

/**
 * The value for a browser date-and-time box, in the reader's own clock.
 *
 * The box speaks in wall-clock time with no zone attached, so the conversion
 * has to happen here rather than by slicing characters off the stored text —
 * that trick shows a Lagos admin a London deadline and neither of them notices
 * until somebody misses it.
 */
export function dueDateInputValue(dueAt: string | null | undefined): string {
  const ms = dueAtMs(dueAt);
  if (ms === null) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The reverse: what the admin typed, turned into the stored form.
 *
 * An empty box means "no deadline", which is how a deadline is removed. That is
 * the only way back once one is set, so it has to be exactly this simple.
 */
export function dueDateFromInput(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const ms = new Date(text).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
