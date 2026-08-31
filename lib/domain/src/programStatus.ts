/**
 * What state a programme is in, and what that means for the people looking at it.
 *
 * Four states, and the difference between two of them is the whole point:
 *
 *   draft      Nobody outside the admin console can see it.
 *   published  On the catalogue, and open for sign-ups.
 *   closed     Still on the catalogue, but sign-ups are over. A cohort that has
 *              filled up or already started is not a secret — prospective
 *              learners should be able to read what the Lab runs and see that
 *              this one has closed, rather than find a page that no longer
 *              exists.
 *   archived   Off the site entirely. For something run once and not repeating.
 *
 * The rules live here, in one place, because the server and the browser both
 * have to agree on them. If the catalogue showed a programme the enrolment
 * endpoint then refused, the learner would meet a broken button and no
 * explanation.
 *
 * Anything unrecognised is treated as hidden and closed. A status nobody
 * planned for should fail towards showing less, never towards accepting
 * sign-ups nobody meant to accept.
 */

export const PROGRAM_STATUSES = ["draft", "published", "closed", "archived"] as const;

export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export function isProgramStatus(value: unknown): value is ProgramStatus {
  return typeof value === "string" && (PROGRAM_STATUSES as readonly string[]).includes(value);
}

/** Shown to visitors and to signed-in learners browsing the catalogue. */
export function showsInCatalogue(status: string | null | undefined): boolean {
  return status === "published" || status === "closed";
}

/** Whether somebody can still reserve a place or join the waitlist. */
export function acceptsEnrolment(status: string | null | undefined): boolean {
  return status === "published";
}

/** The word an admin sees on the console. */
export function programStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "published":
      return "Published";
    case "closed":
      return "Closed";
    case "archived":
      return "Archived";
    default:
      return "Draft";
  }
}

/** One line saying what that state actually does, for the console. */
export function programStatusNote(status: string | null | undefined): string {
  switch (status) {
    case "published":
      return "On the site and open for sign-ups.";
    case "closed":
      return "Still on the site, but nobody new can sign up.";
    case "archived":
      return "Off the site. Learners already on it keep their access.";
    default:
      return "Hidden. Only admins can see it.";
  }
}

/** What a learner is told when they reach a programme that has closed. */
export const CLOSED_TO_ENROLMENT_MESSAGE = "Sign-ups for this programme have closed.";
