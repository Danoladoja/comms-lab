import { labLetter } from "@workspace/domain";
import { sendEmail, EmailRejectedError } from "./email";
import { logger } from "./logger";

/**
 * Where the Lab actually lives.
 *
 * APP_BASE_URL is what the running deployment is set to, and it is the same
 * value invitation links already use. It is read first because the two settings
 * below are Replit's, and on Railway neither exists — which left every link in
 * every enrolment email as a bare path that opens nothing from an inbox.
 */
function appUrl(path: string): string {
  const configured = process.env.APP_BASE_URL?.replace(/\/$/, "");
  if (configured) return `${configured}${path}`;

  const domain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  const basePath = (process.env.BASE_PATH ?? "/").replace(/\/$/, "");
  return domain ? `https://${domain}${basePath}${path}` : `${basePath}${path}`;
}

/** The white logo, absolute, for the dark band. Null where no address is set. */
export function labLogoUrl(): string | null {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  return base ? `${base}/logo-white.png` : null;
}

type Learner = { email: string; name: string };
type Program = { title: string; startDate: string };

/**
 * These used to have their own plainer wrapper: no masthead, no card, an orange
 * heading on a white page. A learner meets this within minutes of meeting the
 * invitation, and the two arriving as different-looking things from the same
 * organisation reads as carelessness at best. They now use the same letter as
 * everything else; only the words differ.
 */
function letter(args: {
  learner: Learner;
  paragraphs: string[];
  action?: { label: string; url: string };
}) {
  return labLetter({
    greetingName: args.learner.name,
    paragraphs: args.paragraphs,
    action: args.action ?? { label: "Open my dashboard", url: appUrl("/dashboard") },
    logoUrl: labLogoUrl(),
  });
}

/**
 * Fire-and-forget senders: enrollment/promotion writes must succeed even when
 * the email fails, so callers do not await these. Each action triggers exactly
 * one send attempt; failures (definite or ambiguous) are logged, never retried
 * automatically — retrying an ambiguous failure could double-send.
 */
function send(args: { learner: Learner; program: Program; subject: string; paragraphs: string[]; what: string }): void {
  const { html, text } = letter({ learner: args.learner, paragraphs: args.paragraphs });
  void sendEmail({
    to: { email: args.learner.email, name: args.learner.name || args.learner.email },
    subject: args.subject,
    html,
    text,
  }).catch((err) => {
    logger.error(
      { err, to: args.learner.email, program: args.program.title, definite: err instanceof EmailRejectedError },
      `${args.what} email failed`,
    );
  });
}

export function sendEnrollmentConfirmation(learner: Learner, program: Program): void {
  send({
    learner, program,
    what: "Enrolment confirmation",
    subject: `You are enrolled: ${program.title}`,
    paragraphs: [
      `Your place on ${program.title} is confirmed, and the programme starts ${program.startDate}.`,
      "We will email you a reminder before each live class. Attending live is what unlocks the replay afterwards, so it is worth keeping an eye on your inbox.",
    ],
  });
}

/**
 * Somebody an admin added to a programme, who already had an account.
 *
 * They were never invited — an invitation is for people with no account — so
 * without this they are enrolled in silence and find out by chance. An admin
 * testing the roster tool with their own address met exactly that and
 * reasonably concluded the feature was broken.
 */
export function sendAdminEnrollment(learner: Learner, program: Program): void {
  send({
    learner, program,
    what: "Admin enrolment",
    subject: `You have been added to ${program.title}`,
    paragraphs: [
      `The Ananse Comms Lab team has added you to ${program.title}, starting ${program.startDate}. There is nothing you need to do: your place is confirmed.`,
      "Sign in with this address to see the schedule of classes and the materials for each one.",
    ],
  });
}

export function sendWaitlistConfirmation(learner: Learner, program: Program): void {
  send({
    learner, program,
    what: "Waitlist confirmation",
    subject: `You are on the waitlist: ${program.title}`,
    paragraphs: [
      `${program.title}, starting ${program.startDate}, is full at the moment, so you have been added to the waitlist.`,
      "Places are offered in the order people joined the list. If one opens up we will enrol you and email you straight away. Nothing is needed from you in the meantime.",
    ],
  });
}

export function sendWaitlistPromotion(learner: Learner, program: Program): void {
  send({
    learner, program,
    what: "Waitlist promotion",
    subject: `A place has opened up: ${program.title}`,
    paragraphs: [
      `Good news. A place has opened up on ${program.title} and it is yours. The programme starts ${program.startDate}.`,
      "We will email you a reminder before each live class.",
    ],
  });
}
