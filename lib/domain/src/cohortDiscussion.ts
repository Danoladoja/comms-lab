/**
 * The cohort's conversation about a module's written work.
 *
 * Critique at the Lab is blind in both directions, and that is right while the
 * critique is being written — people are braver unsigned, and a reviewer who
 * knows whose work it is marks the person rather than the page. But blindness
 * has a cost: a learner finishes their two critiques and never sees what the
 * other twenty-two people made of the same brief. The most useful hour in a
 * workshop is the one where everyone reads everyone.
 *
 * So the discussion opens after the blind work is done, on exactly the rule the
 * Lab already uses to unseal a learner's own feedback: file your piece, write
 * the critiques you owe. One rule to explain, not two.
 *
 * Inside it, pieces carry their authors' names — you cannot discuss writing
 * with someone whose name you do not know — while the critiques stay unsigned,
 * because those were written under a promise and that promise does not expire.
 */

export type DiscussionGate = {
  /** Has this learner filed their own piece for the module? */
  submitted: boolean;
  reviewsRequired: number;
  reviewsGiven: number;
};

/** Staff are in from the start; they are not doing the exercise. */
export function discussionOpen(gate: DiscussionGate, isStaff = false): boolean {
  if (isStaff) return true;
  if (!gate.submitted) return false;
  return gate.reviewsGiven >= gate.reviewsRequired;
}

/**
 * Why the door is shut, in the words the learner needs — which is to say, what
 * to go and do, not which rule they fell foul of.
 */
export function whyDiscussionLocked(gate: DiscussionGate, isStaff = false): string | null {
  if (discussionOpen(gate, isStaff)) return null;
  if (!gate.submitted) {
    return "Submit your own piece first — the discussion opens once you have written yours.";
  }
  const owed = Math.max(0, gate.reviewsRequired - gate.reviewsGiven);
  return owed === 1
    ? "One more critique to write, then the whole cohort's work opens up."
    : `${owed} more critiques to write, then the whole cohort's work opens up.`;
}

/** Long enough to be a contribution, short enough that nobody writes an essay. */
export const MIN_COMMENT_CHARS = 12;
export const MAX_COMMENT_CHARS = 4000;

export function commentProblem(body: string | null | undefined): string | null {
  const text = (body ?? "").trim();
  if (text.length < MIN_COMMENT_CHARS) return "Say a little more than that.";
  if (text.length > MAX_COMMENT_CHARS) {
    return `Keep it under ${MAX_COMMENT_CHARS.toLocaleString()} characters.`;
  }
  return null;
}
