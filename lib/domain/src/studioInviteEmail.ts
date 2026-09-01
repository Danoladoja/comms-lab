import { escapeHtml } from "./partnership";
import { INVITATION_CONTACT_EMAIL } from "./invitationEmail";

/**
 * The note that goes out when a cohort is given the Simulation Studio.
 *
 * These people already have accounts and are already on a programme, so this is
 * not an invitation to join anything. It is somebody being told that a room
 * they can already walk into now has something in it.
 *
 * Which is why it is short. The first email anybody got from the Lab was long
 * on purpose, because it had to explain what the Lab was. This one has one job:
 * say what the Studio is in two sentences, and get them to the door.
 *
 * Same masthead as the invitation, so it arrives looking like the Lab rather
 * than like a notification from a system.
 */

export type StudioInvite = {
  name?: string | null;
  /** The programme they are on, when the access came with one. */
  programmeTitle?: string | null;
  /** Where the Studio lives. */
  url: string;
  logoUrl?: string | null;
};

function tidy(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function greeting(name: string | null | undefined): string {
  return tidy(name).split(" ")[0] || "there";
}

export function studioInviteSubject(invite: StudioInvite): string {
  const programme = tidy(invite.programmeTitle);
  return programme
    ? `Practice scenarios are now open to your ${programme} cohort`
    : "Practice scenarios are now open to you at Ananse Comms Lab";
}

export function studioInviteParagraphs(invite: StudioInvite): string[] {
  const programme = tidy(invite.programmeTitle);
  return [
    programme
      ? `The Simulation Studio is now open to everyone on ${programme}.`
      : "The Simulation Studio is now open to you.",
    "It is a place to practise the hard part on your own, at whatever hour suits you. You say what you want to work on, a scenario is written for you, and it unfolds in response to what you actually write. A reporter with a deadline, a community that has stopped believing you, a regulator with a letter. Nothing you do there is graded, and nobody else sees it.",
    "At the end you get an honest account of how it went: what held up, what would have cost you, and what a stronger answer at the turning point would have looked like.",
    "Half an hour is enough for one. There is nothing to install and nothing to book.",
  ];
}

export function studioInviteLetter(invite: StudioInvite): { subject: string; html: string; text: string } {
  const name = escapeHtml(greeting(invite.name));
  const paragraphs = studioInviteParagraphs(invite);
  const url = invite.url;
  const safeUrl = escapeHtml(url);
  const logo = tidy(invite.logoUrl);

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
        The Simulation Studio
      </p>
    </div>

    <div style="padding: 28px; color: #07111E;">
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">Hello ${name},</p>
      ${body}

      <p style="margin: 28px 0 8px;">
        <a href="${safeUrl}"
           style="background: #F97316; color: #07111E; font-weight: bold; font-size: 15px; padding: 14px 28px; border-radius: 999px; text-decoration: none; display: inline-block;">
          Open the Studio
        </a>
      </p>

      <p style="margin: 16px 0 0; font-size: 12px; color: #5B6470; line-height: 1.6;">
        If the button does not work, copy this address into your browser:<br />
        <span style="word-break: break-all;">${safeUrl}</span>
      </p>
    </div>

    <div style="background: #F4F0E8; padding: 16px 28px; font-size: 11px; color: #5B6470;">
      Ananse Comms Lab · <a href="mailto:${INVITATION_CONTACT_EMAIL}" style="color: #5B6470;">${INVITATION_CONTACT_EMAIL}</a>
    </div>

  </div>
</div>`.trim();

  const text = [
    `Hello ${greeting(invite.name)},`,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    url,
    "",
    "Ananse Comms Lab · The Simulation Studio",
    INVITATION_CONTACT_EMAIL,
  ].join("\n");

  return { subject: studioInviteSubject(invite), html, text };
}
