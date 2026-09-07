import { labLetter } from "./labLetter";

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
  const { html, text } = labLetter({
    greetingName: invite.name,
    paragraphs: studioInviteParagraphs(invite),
    action: { label: "Open the Studio", url: invite.url, showUrl: true },
    logoUrl: invite.logoUrl,
    // Same letter, different line under the masthead: this one is announcing
    // the Studio rather than the Lab.
    tagline: "The Simulation Studio",
  });

  return { subject: studioInviteSubject(invite), html, text };
}
