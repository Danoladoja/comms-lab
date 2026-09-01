import { escapeHtml } from "./partnership";
import type { Role } from "./invitations";

/**
 * The invitation the Lab sends.
 *
 * Clerk can email an invitation itself, and used to. Two things were wrong with
 * that. It arrives from Clerk's sending domain rather than ours, which is why
 * mail providers file it as suspicious — an unfamiliar sender carrying a
 * sign-up link is exactly what a phishing attempt looks like, and two test
 * invitations to real addresses simply never appeared. And the wording was
 * Clerk's generic notice about an account, sent to senior practitioners who
 * had agreed to teach, and to applicants who had waited months for a place.
 *
 * So the link comes from Clerk — only Clerk can mint it — and the letter around
 * it is ours. This module is that letter: what it says, who it says it to, and
 * nothing about how it is delivered.
 *
 * Everything interpolated is escaped. A name arrives from a spreadsheet an
 * admin pasted, and a programme title is typed by hand.
 */

export type InvitationLetter = {
  subject: string;
  html: string;
  text: string;
};

export type InvitationAudience = {
  /** What they are being invited as. */
  role: Role;
  /** Their name, if the roster had one. */
  name?: string | null;
  /** The programme they are being enrolled onto, when there is one. */
  programmeTitle?: string | null;
  /** When that programme starts, as the catalogue words it. */
  programmeStart?: string | null;
  /** The one-time link Clerk minted. */
  url: string;
  /**
   * The Lab's logo, absolute. Optional on purpose: a deployment with no public
   * address configured still sends a letter, it just leads with the name set
   * in type instead. An email that fails to render is worse than a plain one.
   */
  logoUrl?: string | null;
};

/** Where somebody can write back. Printed, because a no-reply invitation is rude. */
export const INVITATION_CONTACT_EMAIL = "africaenergypulse@gmail.com";

function tidy(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** "Amina," or "there," — never "Hi ," with a hole where a name should be. */
export function invitationGreeting(name: string | null | undefined): string {
  const first = tidy(name).split(" ")[0] ?? "";
  return first || "there";
}

export function invitationSubject(audience: InvitationAudience): string {
  const programme = tidy(audience.programmeTitle);
  if (audience.role === "instructor") return "An invitation to facilitate at Ananse Comms Lab";
  if (audience.role === "admin") return "An invitation to help run Ananse Comms Lab";
  return programme
    ? `Welcome to ${programme}: your place is confirmed`
    : "Welcome to Ananse Comms Lab: your place is confirmed";
}

/**
 * The body, as paragraphs.
 *
 * Longer than it was, deliberately. This is the first thing most people ever
 * receive from the Lab, and a single line about an account told them nothing
 * about what they had joined or what happens next. It says, in order: you are
 * in, here is what this is, here is what to do, here is what you will find
 * when you get there.
 */
export function invitationParagraphs(audience: InvitationAudience): string[] {
  const programme = tidy(audience.programmeTitle);
  const starts = tidy(audience.programmeStart);

  if (audience.role === "instructor") {
    return [
      "Thank you for agreeing to teach with us. This note sets up your place as a facilitator at the Ananse Comms Lab.",
      "The Lab is a practitioner-led programme for Africa's energy communicators: journalists, policy advocates and campaigners who are covering the continent's energy transition and want to do it better. Cohorts are small and deliberately practical, and every module produces something a participant can actually use.",
      "Opening the link below sets up your account. There is no password to invent, and one click is all it takes. Any classes already assigned to you will be waiting on your dashboard, with the schedule, your learners, and somewhere to put your slides and coursework.",
      "If a class has not been assigned yet, it will appear as soon as the team schedules it. Nothing else is needed from you today.",
    ];
  }

  if (audience.role === "admin") {
    return [
      "You have been invited to help run the Ananse Comms Lab as an admin.",
      "The Lab is a practitioner-led programme for Africa's energy communicators. As an admin you can create and publish programmes, build their modules, invite learners and facilitators, and follow how each cohort is getting on.",
      "Opening the link below sets up your account. There is no password to invent, and one click is all it takes. The admin console will be waiting.",
    ];
  }

  const opening = programme && starts
    ? `Congratulations. You have a place on ${programme}, starting ${starts}, and we are glad you are joining us.`
    : programme
      ? `Congratulations. You have a place on ${programme}, and we are glad you are joining us.`
      : "Congratulations. You have a place at the Ananse Comms Lab, and we are glad you are joining us.";

  return [
    opening,
    "The Lab is a practitioner-led programme for Africa's energy communicators: journalists, policy advocates and campaigners covering the continent's energy transition. Cohorts are small and the work is practical. Every module is built around something you can use in your own reporting or advocacy, rather than a lecture to sit through.",
    "Opening the link below sets up your account and confirms your place. There is no password to invent, and one click is all it takes.",
    "Once you are there you will find the programme's modules, the schedule of live classes, the materials for each one, and the recordings afterwards if you cannot make a class live. We will email you before each class, so it is worth adding this address to your contacts.",
    `If anything is unclear, or the timing turns out not to work for you, write to us at ${INVITATION_CONTACT_EMAIL}. A real person reads it.`,
  ];
}

/** The line above the button. */
export function invitationCallToAction(role: Role): string {
  return role === "learner" ? "Set up my account" : "Set up my account";
}

/**
 * The whole letter.
 *
 * The link is printed in full underneath the button as well. Plenty of people
 * read mail on a phone that renders the button badly, or in a client that
 * strips it entirely, and an invitation nobody can open is the same as one that
 * never arrived. For the same reason the logo is never the only thing carrying
 * the Lab's name: most clients block images until the reader allows them, so
 * the name is set in type underneath it.
 */
export function invitationLetter(audience: InvitationAudience): InvitationLetter {
  const greeting = escapeHtml(invitationGreeting(audience.name));
  const paragraphs = invitationParagraphs(audience);
  const url = audience.url;
  const safeUrl = escapeHtml(url);
  const logo = tidy(audience.logoUrl);

  const masthead = logo
    ? `<img src="${escapeHtml(logo)}" alt="Ananse Comms Lab" width="180"
             style="display: block; width: 180px; max-width: 60%; height: auto; border: 0;" />`
    : `<span style="color: #F4F0E8; font-size: 20px; font-weight: bold; letter-spacing: 0.02em;">Ananse Comms Lab</span>`;

  const body = paragraphs
    .map((p) => `<p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">${escapeHtml(p)}</p>`)
    .join("\n      ");

  const html = `
<div style="background: #EFEAE0; padding: 24px 12px; font-family: Arial, Helvetica, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; background: #FFFFFF; border-radius: 14px; overflow: hidden;">

    <div style="background: #07111E; padding: 24px 28px;">
      ${masthead}
      <p style="margin: 12px 0 0; color: #F4F0E8; opacity: 0.75; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;">
        Africa's learning hub for energy communicators
      </p>
    </div>

    <div style="padding: 28px; color: #07111E;">
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">Hello ${greeting},</p>
      ${body}

      <p style="margin: 28px 0 8px;">
        <a href="${safeUrl}"
           style="background: #F97316; color: #07111E; font-weight: bold; font-size: 15px; padding: 14px 28px; border-radius: 999px; text-decoration: none; display: inline-block;">
          ${escapeHtml(invitationCallToAction(audience.role))}
        </a>
      </p>

      <p style="margin: 16px 0 0; font-size: 12px; color: #5B6470; line-height: 1.6;">
        If the button does not work, copy this address into your browser:<br />
        <span style="word-break: break-all;">${safeUrl}</span>
      </p>

      <p style="margin: 20px 0 0; padding-top: 16px; border-top: 1px solid #E4DFD4; font-size: 12px; color: #5B6470; line-height: 1.6;">
        This link is for you alone and can only be used once. If you were not expecting it, you can ignore
        this message and nothing will happen.
      </p>
    </div>

    <div style="background: #F4F0E8; padding: 16px 28px; font-size: 11px; color: #5B6470;">
      Ananse Comms Lab · <a href="mailto:${INVITATION_CONTACT_EMAIL}" style="color: #5B6470;">${INVITATION_CONTACT_EMAIL}</a>
    </div>

  </div>
</div>`.trim();

  const text = [
    `Hello ${invitationGreeting(audience.name)},`,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    url,
    "",
    "This link is for you alone and can only be used once. If you were not expecting it, you can ignore this message.",
    "",
    "Ananse Comms Lab · Africa's learning hub for energy communicators",
    INVITATION_CONTACT_EMAIL,
  ].join("\n");

  return { subject: invitationSubject(audience), html, text };
}
