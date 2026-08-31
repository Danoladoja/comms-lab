/**
 * Who is running a class.
 *
 * Two different things wear the same word. A facilitator with an account can
 * be given the session: they see it on their own dashboard, mark attendance,
 * open the room, and read their learners' work. A guest — the regulator who
 * joins for one evening, the visiting editor — is a name on a page and nothing
 * more, because handing out an account to somebody who appears once would be
 * giving away access to fifty learners' submissions.
 *
 * So the box takes either. Type a name that belongs to somebody with an
 * account and the class is theirs; type anything else and it is written up as
 * a guest. This module decides which of the two happened, and it is the only
 * place that decision is made, so the browser and the server cannot disagree
 * about who is teaching.
 */

/** Longer than any real name, short enough that the field cannot be abused. */
export const MAX_FACILITATOR_NAME = 120;

export type FacilitatorPerson = { id: number; name: string; email: string };

export type FacilitatorChoice =
  /** Somebody with an account: the session becomes theirs to run. */
  | { kind: "account"; instructorId: number; name: string }
  /** A name with no account behind it. Shown to learners, grants nothing. */
  | { kind: "guest"; name: string }
  /** The box was left empty. */
  | { kind: "none" }
  /** Two people answer to that name; only they can say which. */
  | { kind: "ambiguous"; name: string; candidates: FacilitatorPerson[] };

function tidy(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function same(a: string, b: string): boolean {
  return a.length > 0 && a.toLowerCase() === b.toLowerCase();
}

/**
 * Read what an admin typed against the people who have accounts.
 *
 * An email always wins, because it is the one thing that is unique. A name is
 * only accepted when exactly one person answers to it — two facilitators called
 * Amina must not become a coin toss over who can see the coursework.
 */
export function matchFacilitator(
  input: string | null | undefined,
  people: readonly FacilitatorPerson[],
): FacilitatorChoice {
  const typed = tidy(input);
  if (!typed) return { kind: "none" };

  const byEmail = people.find((p) => same(tidy(p.email), typed));
  if (byEmail) {
    return { kind: "account", instructorId: byEmail.id, name: tidy(byEmail.name) || tidy(byEmail.email) };
  }

  const byName = people.filter((p) => same(tidy(p.name), typed));
  if (byName.length === 1) {
    return { kind: "account", instructorId: byName[0].id, name: tidy(byName[0].name) };
  }
  if (byName.length > 1) {
    return { kind: "ambiguous", name: typed, candidates: [...byName] };
  }

  return { kind: "guest", name: typed.slice(0, MAX_FACILITATOR_NAME) };
}

/**
 * The two fields the API stores. Exactly one of them is ever set: a session
 * whose facilitator has an account must not also carry a stale typed name, or
 * the page would have to choose between two answers.
 */
export function facilitatorFields(
  choice: FacilitatorChoice,
): { instructorId: number | null; guestFacilitator: string | null } {
  switch (choice.kind) {
    case "account":
      return { instructorId: choice.instructorId, guestFacilitator: null };
    case "guest":
      return { instructorId: null, guestFacilitator: choice.name };
    default:
      // Ambiguous never reaches here from the UI, but if it did, changing
      // nothing beats guessing which Amina was meant.
      return { instructorId: null, guestFacilitator: null };
  }
}

/** What to show in the box when the editor opens. */
export function facilitatorInputValue(session: {
  instructorName?: string | null;
  guestFacilitator?: string | null;
}): string {
  return tidy(session.instructorName) || tidy(session.guestFacilitator) || "";
}

/** The one line under the box saying what the typed text will do. */
export function describeFacilitatorChoice(choice: FacilitatorChoice): string {
  switch (choice.kind) {
    case "account":
      return `${choice.name} runs this class and can open the room, mark attendance and read submissions.`;
    case "guest":
      return `${choice.name} will be shown as the facilitator. Guests have no account, so they cannot open the room or see learners' work.`;
    case "ambiguous":
      return `More than one facilitator is called ${choice.name}. Type their email address instead.`;
    default:
      return "No facilitator yet.";
  }
}
