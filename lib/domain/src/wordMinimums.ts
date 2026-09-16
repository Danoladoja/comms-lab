/**
 * How much has to be written: a floor under the task and under each critique.
 *
 * The critiques were the problem. Anyone can score a piece out of ten in
 * fifteen seconds and type "good work, maybe tighten the intro", and enough
 * people did that the critique — which is the part of the week where the
 * learning actually happens — had quietly become a formality. The old floor was
 * 120 characters, about twenty words, which is exactly long enough to write
 * nothing at length.
 *
 * So: 500 words for the written task, 250 for each critique. With two critiques
 * owed per module that is a thousand words a week, and the split is deliberate —
 * half the writing goes into other people's work. Reading someone else's piece
 * closely enough to say 250 useful words about it is the exercise.
 *
 * A word count is a blunt instrument and everybody knows it: it cannot tell a
 * close reading from 250 words of throat-clearing. It is not meant to. It is
 * meant to make the fifteen-second critique impossible, so that the person who
 * was going to write one has to sit with the piece instead — and to make the
 * standard visible, which is most of what a standard does.
 */

/** The written task. */
export const MIN_TASK_WORDS = 500;

/** Each critique of a peer's piece. */
export const MIN_CRITIQUE_WORDS = 250;

/**
 * When the floors came in.
 *
 * A module whose written-task deadline had already passed by this moment keeps
 * the rules it was set under — including for critiques still being written
 * against it. Changing the deal on somebody midway through work they have
 * already started is the thing to avoid: the learners it would land on are the
 * ones who are doing the work, not the ones who are not.
 *
 * For the cohort teaching now that exempts the first module and nothing else.
 * Every module after it, and every module of every programme that follows,
 * comes in under the floors — so this is a line drawn once, not a setting for
 * anyone to keep in step.
 */
export const WORD_MINIMUMS_LIVE_FROM = "2026-09-16T00:00:00.000Z";

export type WordPiece = "task" | "critique";

/**
 * How many words are in this.
 *
 * A token has to carry a letter or a digit to count, so a line of full stops is
 * not 40 words. That is the only cleverness here and it is not much: anybody
 * determined to pad can type real words. The count is a floor, not a detector.
 */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  return text
    .trim()
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
    .length;
}

/**
 * The floor in force for one piece of work on one module, or 0 for none.
 *
 * `dueAt` is the module's written-task deadline, which is what decides whether
 * the module predates the rule. A module with no deadline at all is a module
 * set after this came in, so the floor applies — falling the other way would
 * exempt every future module that never gets a date.
 */
export function wordsRequired(
  piece: WordPiece,
  dueAt: string | null | undefined,
  liveFrom: string = WORD_MINIMUMS_LIVE_FROM,
): number {
  const due = dueAt ? new Date(dueAt).getTime() : NaN;
  const from = new Date(liveFrom).getTime();
  // An unreadable date is treated as no deadline, as everywhere else in the
  // app: a corrupt value must never become a rule nobody can explain.
  if (Number.isFinite(due) && Number.isFinite(from) && due < from) return 0;
  return piece === "task" ? MIN_TASK_WORDS : MIN_CRITIQUE_WORDS;
}

/** Has this met the floor? True whenever there is no floor to meet. */
export function meetsWordMinimum(count: number, required: number): boolean {
  return required <= 0 || count >= required;
}

/**
 * Why this is being refused, or null when it is long enough.
 *
 * The server asks this, not the browser. A greyed-out button is a courtesy; it
 * stops nobody who reloads the page, and it stops nobody at all who has the
 * address of the endpoint.
 */
export function wordCountProblem(
  text: string | null | undefined,
  required: number,
  piece: WordPiece,
): string | null {
  const count = countWords(text);
  if (meetsWordMinimum(count, required)) return null;
  const short = required - count;
  const what = piece === "task" ? "This task needs" : "A critique needs";
  return `${what} at least ${required} words. You have ${count} — about ${short} to go.`;
}

/**
 * The line under the box, while they write.
 *
 * Shown from the first keystroke rather than sprung at the end, because a floor
 * discovered on pressing Submit is a floor that reads as a punishment for
 * having finished.
 */
export function wordCountNotice(count: number, required: number): string {
  if (required <= 0) return count === 1 ? "1 word" : `${count} words`;
  if (count >= required) return `${count} words — over the ${required} needed.`;
  return `${count} of ${required} words.`;
}

/**
 * What a module's written work adds up to, for saying so out loud.
 *
 * Five hundred words of your own and two hundred and fifty on each of two
 * peers' — a thousand words a week, half of it spent on somebody else's piece.
 */
export function writtenWeekTotal(reviewsRequired: number): number {
  return MIN_TASK_WORDS + Math.max(0, reviewsRequired) * MIN_CRITIQUE_WORDS;
}
