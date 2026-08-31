/**
 * Moving a session's date and time between the database and a date box.
 *
 * The database keeps an instant in time (UTC). A browser's date-and-time box
 * speaks the reader's own clock, with no zone attached at all. Converting
 * between them is where an hour goes missing.
 *
 * The tempting one-liner — `new Date(iso).toISOString().slice(0, 16)` — is
 * wrong everywhere except London in winter. In Lagos it shows a class that
 * starts at 18:00 as 17:00, and if an admin then saves the form without
 * touching it, the class really does move an hour earlier. Do that twice and
 * fifty learners arrive to an empty room.
 *
 * So both directions go through the local-time getters, which are the only
 * ones that agree with what the box is showing.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * A stored instant as the value a `datetime-local` input expects, in the
 * reader's own time zone. Empty string for nothing scheduled, and for anything
 * unreadable — an empty box is honest, a wrong date is not.
 */
export function sessionDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  );
}

/**
 * What the box holds, back to a stored instant. Null when the admin cleared it,
 * which is a real state: a session whose date is still to be announced.
 */
export function sessionDateTimeFromInput(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) return null;
  return at.toISOString();
}

/** The shortest sensible class, in minutes. Matches the API's own floor. */
export const MIN_SESSION_MINUTES = 5;

/** A duration a person typed, made safe without silently inventing a number. */
export function sessionMinutes(value: string | number | null | undefined, fallback = 90): number {
  if (typeof value !== "number") {
    // An empty box means "I have not said", not "five minutes" — and `Number("")`
    // is 0, which would otherwise clamp to the shortest class we allow. Caught
    // by its own test; an admin clearing the field would have shrunk the class.
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(MIN_SESSION_MINUTES, Math.round(parsed));
  }
  if (!Number.isFinite(value)) return fallback;
  return Math.max(MIN_SESSION_MINUTES, Math.round(value));
}
