/**
 * Naming a crash without handing over its insides.
 *
 * A route that throws answers "Something went wrong. Please try again.", which
 * is honest and useless: it is the same sentence for a null that should not
 * have been null, a column that is too short for what was written to it, and a
 * reply from the AI in a shape nobody expected. The detail goes to the log,
 * where it belongs — but the person who presses the button is often the only
 * person who will ever read either, and asking them to go and find a log is how
 * a fault survives a week.
 *
 * So: two facts, both of which are safe to say out loud.
 *
 * The **kind** of error — `TypeError`, `ZodError` — which is a class name from
 * this codebase's own vocabulary and contains nothing of anybody's.
 *
 * And, where Postgres refused, its **SQLSTATE code** — `23502`, `22001`. Five
 * characters that name the rule that was broken and carry no values with them.
 * Postgres's own message is deliberately left out: Drizzle hangs the failing
 * query off it, and a query carries whatever was being written, which on this
 * platform means somebody's work.
 *
 * Between them they turn "it crashed" into "a not-null was violated while
 * saving the draft", which is a thing to go and look at rather than a thing to
 * try again.
 */

/** Postgres class codes worth a word, so the note reads as a sentence. */
const SQLSTATE_SAYS: Record<string, string> = {
  "23502": "a required value was missing",
  "23503": "something it pointed at was not there",
  "23505": "something like it already existed",
  "22001": "a value was too long for its column",
  "22P02": "a value was the wrong type",
  "42703": "a column the code expects is not in the database",
  "42P01": "a table the code expects is not in the database",
  "40001": "two writes collided",
  "57014": "it took too long and was cut off",
};

function sqlState(err: unknown): string | null {
  // Drizzle wraps the driver's error and keeps the real one on `cause`, so the
  // code can be on either. Checked in the same order as schemaBehindCode, for
  // the same reason.
  const own = (err as { code?: unknown } | null)?.code;
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  const found = typeof own === "string" ? own : typeof cause === "string" ? cause : null;
  // SQLSTATE is five characters. Node's own error codes ("ENOTFOUND",
  // "ECONNRESET") share the field and are worth saying too, but they are not
  // SQLSTATE and must not be looked up as one.
  return found && /^[0-9A-Z]{5}$/.test(found) ? found : null;
}

function nodeCode(err: unknown): string | null {
  const own = (err as { code?: unknown } | null)?.code;
  return typeof own === "string" && /^E[A-Z_]+$/.test(own) ? own : null;
}

/**
 * A short, safe name for whatever just went wrong.
 *
 * Never the error's message, and never its stack. Both can quote the request,
 * and on this platform a request can be a learner's coursework.
 */
export function whatBroke(err: unknown): string {
  const state = sqlState(err);
  if (state) {
    const says = SQLSTATE_SAYS[state];
    return says ? `the database refused it — ${says} (${state})` : `the database refused it (${state})`;
  }

  const network = nodeCode(err);
  if (network) return `it could not reach something it needed (${network})`;

  const name = (err as { name?: unknown } | null)?.name;
  if (typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name)) return `a ${name} in the Lab's own code`;

  return "something the Lab has no name for";
}
