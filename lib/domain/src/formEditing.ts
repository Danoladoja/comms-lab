import type { FormQuestion, QuestionConfig } from "./programForm";

/**
 * Changing a form after people have started answering it.
 *
 * The whole point of this file is one idea: a stored answer means whatever the
 * question meant at the moment it was given, and an edit that changes what the
 * question meant turns somebody's answer into a different answer without
 * anybody deciding to.
 *
 * Rename an option from "Media" to "Media or journalism" and every row that
 * said "Media" now reads as something nobody chose. Shorten a rating from five
 * steps to three and the fours and fives become out-of-range values that an
 * average will quietly keep counting. Change a slider to a rating and the
 * numbers survive while their meaning does not. None of these fail loudly. They
 * produce a report that is wrong in a way nobody can see.
 *
 * So the rule is narrow and applies only once somebody has actually answered:
 * anything that could change what an existing answer means is refused, and
 * everything else — wording, help text, order, section, tightening a word limit
 * that only affects people who have not written yet — goes through.
 *
 * Before anybody has answered, a question is just a draft and nothing here
 * applies.
 */

export const EDITABLE_KINDS = ["slider", "rating", "choice", "multi", "short", "long"] as const;

export type ProposedEdit = {
  kind: string;
  prompt: string;
  help: string;
  required: boolean;
  config: QuestionConfig;
  section: string;
};

/**
 * Why this edit cannot be made, or null when it can.
 *
 * `answered` is how many people have already given an answer to this question —
 * not how many have filed the form. Somebody who skipped an optional question
 * has nothing that an edit to it could invalidate.
 */
export function editProblem(args: {
  before: FormQuestion;
  after: ProposedEdit;
  answered: number;
}): string | null {
  const { before, after, answered } = args;

  if (!EDITABLE_KINDS.includes(after.kind as typeof EDITABLE_KINDS[number])) {
    return "That is not a kind of question this form knows how to ask.";
  }

  // A draft nobody has answered can be changed into anything at all.
  if (answered === 0) return null;

  const people = answered === 1 ? "1 person has" : `${answered} people have`;

  if (after.kind !== before.kind) {
    return `${people} already answered this question, so it cannot be changed from one kind of `
      + "question to another — their answers would survive and stop meaning what they meant. "
      + "Add a new question instead, and make this one optional if you no longer want it asked.";
  }

  if (before.kind === "choice" || before.kind === "multi") {
    const was = before.config.options ?? [];
    const now = after.config.options ?? [];
    const gone = was.filter((o) => !now.includes(o));
    if (gone.length > 0) {
      return `${people} already answered this, and "${gone[0]}" would no longer be one of the `
        + "answers. Their choice would read as something nobody offered. You can add options, "
        + "and you can reword the question, but an option somebody may have picked has to stay.";
    }
  }

  if (before.kind === "rating") {
    const was = before.config.scale ?? 5;
    const now = after.config.scale ?? 5;
    if (now < was) {
      return `${people} already answered this on a ${was}-point scale. Shortening it to ${now} `
        + "would leave answers above the top of the scale, and an average would go on counting "
        + "them as though they fitted.";
    }
  }

  if (before.kind === "slider") {
    const wasMin = before.config.min ?? 0;
    const wasMax = before.config.max ?? 10;
    const nowMin = after.config.min ?? 0;
    const nowMax = after.config.max ?? 10;
    if (nowMin > wasMin || nowMax < wasMax) {
      return `${people} already answered this on a ${wasMin} to ${wasMax} line. Narrowing it `
        + "would leave answers outside the scale they are supposed to sit on.";
    }
  }

  return null;
}

/**
 * Why this question cannot be deleted, or null.
 *
 * Refused outright once anybody has answered, rather than deleting their
 * answers along with it. This is the evidence an impact report stands on, and
 * the person pressing the button is usually tidying up a form rather than
 * deciding to destroy data — which is exactly when a quiet cascade does its
 * damage.
 */
export function deleteProblem(args: { answered: number; prompt: string }): string | null {
  if (args.answered === 0) return null;
  const people = args.answered === 1 ? "1 person has" : `${args.answered} people have`;
  return `${people} answered this question, and deleting it would delete what they said with it. `
    + "If you no longer want it asked, make it optional and reword it — nothing is lost that way.";
}

/**
 * What an admin is warned about before editing a question people have answered.
 *
 * Shown even where the edit is allowed. Rewording a question is permitted and
 * is usually a typo fix, but it still means the people who answered first were
 * answering a slightly different question, and whoever reads the results in
 * six months should be told rather than left to assume.
 */
export function editWarning(args: { answered: number; rewording: boolean }): string {
  if (args.answered === 0) return "";
  const people = args.answered === 1 ? "1 person has" : `${args.answered} people have`;
  if (!args.rewording) return "";
  return `${people} already answered this. Rewording it is allowed, but their answers were given `
    + "to the old wording — worth remembering when you read the results.";
}

/** Where a question can move to, given how many there are. */
export function canMove(index: number, total: number): { up: boolean; down: boolean } {
  return { up: index > 0, down: index < total - 1 };
}

/**
 * A new order for the questions, as a list of ids.
 *
 * Returned rather than applied, so the caller writes one `sortOrder` per
 * question and the rule about what order means stays in one place.
 */
export function moved(ids: readonly number[], id: number, direction: "up" | "down"): number[] {
  const list = [...ids];
  const at = list.indexOf(id);
  if (at === -1) return list;
  const to = direction === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= list.length) return list;
  [list[at], list[to]] = [list[to], list[at]];
  return list;
}

/** Why a reordering cannot be applied, or null. */
export function reorderProblem(args: {
  given: readonly number[];
  known: readonly number[];
}): string | null {
  if (args.given.length !== args.known.length) {
    return "That ordering does not cover every question on the form.";
  }
  const knownSet = new Set(args.known);
  if (args.given.some((id) => !knownSet.has(id))) {
    return "That ordering names a question that is not on this form.";
  }
  if (new Set(args.given).size !== args.given.length) {
    return "That ordering names the same question twice.";
  }
  return null;
}
