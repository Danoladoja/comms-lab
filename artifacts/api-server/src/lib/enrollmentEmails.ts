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

type Learner = { email: string; name: string };
type Program = { title: string; startDate: string };

function wrap(heading: string, body: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #07111E;">
      <h2 style="color: #C2410C;">${heading}</h2>
      ${body}
      <p style="margin: 24px 0;">
        <a href="${appUrl("/dashboard")}"
           style="background: #F97316; color: #07111E; font-weight: bold; padding: 12px 24px; border-radius: 999px; text-decoration: none;">
          Open my dashboard
        </a>
      </p>
      <p style="color: #5B6470; font-size: 12px;">Ananse Comms Lab · Africa's learning hub for energy communicators</p>
    </div>`;
}

/**
 * Fire-and-forget senders: enrollment/promotion writes must succeed even when
 * the email fails, so callers do not await these. Each action triggers exactly
 * one send attempt; failures (definite or ambiguous) are logged, never retried
 * automatically — retrying an ambiguous failure could double-send.
 */
export function sendEnrollmentConfirmation(learner: Learner, program: Program): void {
  void sendEmail({
    to: { email: learner.email, name: learner.name },
    subject: `You're enrolled: ${program.title}`,
    html: wrap(
      "You're enrolled!",
      `<p>Hi ${learner.name},</p>
       <p>Your place in <strong>${program.title}</strong> is confirmed. The program starts <strong>${program.startDate}</strong>.</p>
       <p>We'll email you a reminder before each live class. Attending live is what unlocks the replay afterwards, so keep an eye on your inbox.</p>`,
    ),
  }).catch((err) => {
    logger.error(
      { err, to: learner.email, program: program.title, definite: err instanceof EmailRejectedError },
      "Enrollment confirmation email failed",
    );
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
  void sendEmail({
    to: { email: learner.email, name: learner.name },
    subject: `You have been added to ${program.title}`,
    html: wrap(
      "You have a place",
      `<p>Hi ${learner.name || "there"},</p>
       <p>The Ananse Comms Lab team has added you to <strong>${program.title}</strong>, starting
       <strong>${program.startDate}</strong>. There is nothing you need to do — your place is confirmed.</p>
       <p>Sign in with this address to see the class schedule and materials.</p>`,
    ),
  }).catch((err) => {
    logger.error(
      { err, to: learner.email, program: program.title, definite: err instanceof EmailRejectedError },
      "Admin enrollment email failed",
    );
  });
}

export function sendWaitlistConfirmation(learner: Learner, program: Program): void {
  void sendEmail({
    to: { email: learner.email, name: learner.name },
    subject: `You're on the waitlist: ${program.title}`,
    html: wrap(
      "You're on the waitlist",
      `<p>Hi ${learner.name},</p>
       <p><strong>${program.title}</strong> (starting <strong>${program.startDate}</strong>) is currently full, so you've been added to the waitlist.</p>
       <p>Places are offered in the order learners joined the waitlist. If a spot opens up, we'll enroll you automatically and email you right away.</p>`,
    ),
  }).catch((err) => {
    logger.error(
      { err, to: learner.email, program: program.title, definite: err instanceof EmailRejectedError },
      "Waitlist confirmation email failed",
    );
  });
}

export function sendWaitlistPromotion(learner: Learner, program: Program): void {
  void sendEmail({
    to: { email: learner.email, name: learner.name },
    subject: `A spot opened up — you're in: ${program.title}`,
    html: wrap(
      "You're off the waitlist!",
      `<p>Hi ${learner.name},</p>
       <p>Good news — a place opened up in <strong>${program.title}</strong> and it's yours. The program starts <strong>${program.startDate}</strong>.</p>
       <p>We'll email you a reminder before each live class so you don't miss your spot.</p>`,
    ),
  }).catch((err) => {
    logger.error(
      { err, to: learner.email, program: program.title, definite: err instanceof EmailRejectedError },
      "Waitlist promotion email failed",
    );
  });
}
