/**
 * Has the quiz actually changed?
 *
 * Saving a quiz used to delete every attempt every learner had ever made on
 * it — unconditionally, with no comparison. The deletion itself is right: a
 * pass on old questions must not count against new ones. What was wrong is that
 * it fired on every save, including the ones that changed no question at all.
 *
 * A facilitator opening the editor to set a due date, or to fix a typo in the
 * module's deadline, wiped the cohort's passes. Their modules un-completed, the
 * following week re-locked, and certificates already issued stopped working —
 * from an edit that touched nothing a learner had answered.
 *
 * So the rule is: erase the attempts when the questions are different, and only
 * then. What counts as different is what a learner would have had to answer
 * differently — the wording, the options, the right answer. Where a question
 * came from and what order it was stored in are not that.
 */

export type ComparableQuestion = {
  prompt: string;
  options: string[];
  correctIndex: number;
};

function normalise(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function sameQuestion(a: ComparableQuestion, b: ComparableQuestion): boolean {
  if (normalise(a.prompt) !== normalise(b.prompt)) return false;
  if (a.correctIndex !== b.correctIndex) return false;
  if (a.options.length !== b.options.length) return false;
  return a.options.every((opt, i) => normalise(opt) === normalise(b.options[i] ?? ""));
}

/**
 * True when nothing a learner would have to answer differently has changed.
 *
 * Order matters: moving the right answer from option A to option C changes the
 * question even though the same words are present, and reordering the questions
 * themselves changes which one a learner sees first.
 */
export function sameQuiz(
  before: ComparableQuestion[],
  after: ComparableQuestion[],
): boolean {
  if (before.length !== after.length) return false;
  return before.every((q, i) => sameQuestion(q, after[i]!));
}
