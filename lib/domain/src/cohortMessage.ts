import { paragraphsFrom, tidyLine } from "./labLetter";

/**
 * Writing to a cohort.
 *
 * Everything the Lab sent until now was automatic: an invitation, a reminder, a
 * confirmation. There was no way for an admin to simply tell a cohort
 * something — the class has moved, the reading is up, the deadline is Friday —
 * which meant either doing it outside the Lab from a personal inbox, or not
 * doing it.
 *
 * The rules that matter are about the irreversibility. Fifty emails cannot be
 * recalled, so the work here is done before anything is sent: who exactly will
 * receive it, what it will say, and whether it is finished enough to send.
 */

/** Long enough for a real notice, short enough that nobody pastes a newsletter. */
export const MAX_MESSAGE_CHARS = 4000;
export const MAX_SUBJECT_CHARS = 140;

/**
 * Short enough to be a mistake rather than a message.
 *
 * Somebody testing the box with "hi" and pressing send has not written to their
 * cohort, they have wasted fifty people's attention.
 */
export const MIN_MESSAGE_CHARS = 20;

/** Above this, it is a mailing list, and this is not one. */
export const MAX_RECIPIENTS_AT_ONCE = 500;

export type MessageAudience = "active" | "everyone";

export type CohortMessageDraft = {
  subject: string;
  body: string;
  audience: MessageAudience;
  /** Optional button. Both parts or neither. */
  actionLabel?: string | null;
  actionUrl?: string | null;
};

export type MessageProblem = string;

/**
 * Who gets it.
 *
 * "active" is the people currently doing the programme. "everyone" adds those
 * who finished it, which is right for an alumni notice and wrong for "the
 * class has moved to Thursday".
 *
 * Neither includes a cancelled enrolment. Somebody removed from a cohort should
 * not keep receiving its post, and somebody removed for cause certainly should
 * not.
 */
export function statusesFor(audience: MessageAudience): string[] {
  return audience === "everyone" ? ["enrolled", "completed"] : ["enrolled"];
}

export function describeAudience(audience: MessageAudience, count: number): string {
  const people = `${count} ${count === 1 ? "person" : "people"}`;
  return audience === "everyone"
    ? `${people}: everyone on the programme, including those who have finished it.`
    : `${people}: everyone currently on the programme. Those who have finished it are not included.`;
}

/**
 * Is this ready to send?
 *
 * Checked here rather than at the button so the server can hold the same line.
 * An admin who works out that the button unlocks with a longer subject has not
 * found a loophole worth having.
 */
export function validateCohortMessage(draft: {
  subject?: string;
  body?: string;
  audience?: string;
  actionLabel?: string | null;
  actionUrl?: string | null;
}): { message: CohortMessageDraft | null; problems: MessageProblem[] } {
  const problems: MessageProblem[] = [];

  const subject = tidyLine(draft.subject);
  const body = (draft.body ?? "").trim();
  const audience: MessageAudience = draft.audience === "everyone" ? "everyone" : "active";

  if (!subject) {
    problems.push("Give the message a subject. It is the only thing most people read.");
  } else if (subject.length > MAX_SUBJECT_CHARS) {
    problems.push(`The subject is too long. Keep it under ${MAX_SUBJECT_CHARS} characters.`);
  }

  if (!body) {
    problems.push("Write the message.");
  } else if (body.length < MIN_MESSAGE_CHARS) {
    problems.push("That is too short to send to a cohort. Say what you mean.");
  } else if (body.length > MAX_MESSAGE_CHARS) {
    problems.push(`That is longer than an email should be. Keep it under ${MAX_MESSAGE_CHARS} characters, or link to the detail.`);
  }

  const label = tidyLine(draft.actionLabel);
  const url = tidyLine(draft.actionUrl);

  // Half a button is worse than none: a label with no link renders as dead
  // orange, and a link with no label renders as nothing at all.
  if (label && !url) problems.push("The button has a label but no link. Add the link, or clear the label.");
  if (url && !label) problems.push("The button has a link but no label. Add the label, or clear the link.");
  if (url && !isSafeLinkUrl(url)) {
    problems.push("The button link must be a web address starting with https://");
  }

  if (problems.length > 0) return { message: null, problems };

  return {
    message: {
      subject,
      body,
      audience,
      actionLabel: label || null,
      actionUrl: url || null,
    },
    problems: [],
  };
}

/**
 * Only ordinary web links.
 *
 * `javascript:` in an href is inert in every mail client worth naming, but this
 * text is also shown back in the browser as a preview, and a scheme allowlist
 * is one line. `http:` is refused as well: a Lab that sends people to an
 * unencrypted page is teaching the wrong habit to exactly the audience that
 * cannot afford it.
 */
export function isSafeLinkUrl(url: string): boolean {
  const value = tidyLine(url);
  if (!value || /\s/.test(value)) return false;
  // A pattern rather than a URL parser, so this rule holds the same in the
  // browser, on the server and in a test, with no dependency on which globals
  // happen to exist. Deliberately strict: a host with a real suffix, then an
  // optional path. Anything else is a typo or an attempt.
  return /^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:[:/?#][^\s]*)?$/.test(value);
}

/** What the letter will actually say, so a preview and the send cannot differ. */
export function messageParagraphs(body: string): string[] {
  return paragraphsFrom(body);
}

export type SendOutcome = {
  email: string;
  name: string;
  status: "sent" | "failed";
  detail: string;
};

/** The line an admin reads afterwards. Names the failures rather than counting them. */
export function describeSendResult(outcomes: readonly SendOutcome[]): string {
  const sent = outcomes.filter((o) => o.status === "sent").length;
  const failed = outcomes.length - sent;
  if (outcomes.length === 0) return "There was nobody to send it to.";
  if (failed === 0) return `Sent to ${sent} ${sent === 1 ? "person" : "people"}.`;
  if (sent === 0) return `None of the ${failed} could be sent. Nothing reached anybody.`;
  return `Sent to ${sent}. ${failed} could not be sent, and ${failed === 1 ? "is" : "are"} listed below.`;
}
