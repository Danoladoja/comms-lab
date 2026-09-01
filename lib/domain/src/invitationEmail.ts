import { escapeHtml } from "./partnership";
import type { Role } from "./invitations";

/**
 * The invitation the Lab sends.
 *
 * Clerk can email an invitation itself, and used to. Two things were wrong with
 * that. It arrives from Clerk's sending domain rather than ours, which is why
 * mail providers file it as suspicious — an unfamiliar sender carrying a
 * sign-up link is exactly what a phishing attempt looks like, and two test
 * invitations to real addresses simply never appeared. And the wording is
 * Clerk's, so somebody invited to teach a cohort of African energy journalists
 * received a generic notice about an account.
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
};

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
  if (audience.role === "instructor") return "You are invited to facilitate at Ananse Comms Lab";
  if (audience.role === "admin") return "You are invited to help run Ananse Comms Lab";
  return programme
    ? `Your place on ${programme} — Ananse Comms Lab`
    : "Your invitation to Ananse Comms Lab";
}

/** The sentence that says what this is, before anybody looks at the button. */
export function invitationPurpose(audience: InvitationAudience): string {
  const programme = tidy(audience.programmeTitle);
  const starts = tidy(audience.programmeStart);

  if (audience.role === "instructor") {
    return "You have been invited to facilitate at the Ananse Comms Lab. Opening the link below sets up your account and puts any classes assigned to you on your dashboard.";
  }
  if (audience.role === "admin") {
    return "You have been invited to help run the Ananse Comms Lab as an admin. Opening the link below sets up your account.";
  }
  if (programme && starts) {
    return `You have a place on ${programme}, starting ${starts}. Opening the link below sets up your account and confirms your place.`;
  }
  if (programme) {
    return `You have a place on ${programme}. Opening the link below sets up your account and confirms your place.`;
  }
  return "You have been invited to join the Ananse Comms Lab. Opening the link below sets up your account.";
}

/**
 * The whole letter.
 *
 * The link is printed in full underneath the button as well. Plenty of people
 * read mail on a phone that renders the button badly, or in a client that
 * strips it entirely, and an invitation nobody can open is the same as one that
 * never arrived.
 */
export function invitationLetter(audience: InvitationAudience): InvitationLetter {
  const greeting = escapeHtml(invitationGreeting(audience.name));
  const purpose = escapeHtml(invitationPurpose(audience));
  const url = audience.url;
  const safeUrl = escapeHtml(url);

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #07111E;">
      <h2 style="color: #C2410C; margin-bottom: 8px;">Ananse Comms Lab</h2>
      <p>Hello ${greeting},</p>
      <p>${purpose}</p>
      <p style="margin: 28px 0;">
        <a href="${safeUrl}"
           style="background: #F97316; color: #07111E; font-weight: bold; padding: 12px 24px; border-radius: 999px; text-decoration: none; display: inline-block;">
          Set up my account
        </a>
      </p>
      <p style="font-size: 12px; color: #5B6470;">
        If the button does not work, copy this address into your browser:<br />
        <span style="word-break: break-all;">${safeUrl}</span>
      </p>
      <p style="font-size: 12px; color: #5B6470;">
        This link is for you alone and can only be used once. If you were not expecting it, you can ignore
        this message and nothing will happen.
      </p>
      <p style="color: #5B6470; font-size: 12px;">Ananse Comms Lab · Africa's learning hub for energy communicators</p>
    </div>`.trim();

  const text = [
    `Hello ${invitationGreeting(audience.name)},`,
    "",
    invitationPurpose(audience),
    "",
    url,
    "",
    "This link is for you alone and can only be used once. If you were not expecting it, you can ignore this message.",
    "",
    "Ananse Comms Lab",
  ].join("\n");

  return { subject: invitationSubject(audience), html, text };
}
