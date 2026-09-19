import { labLetter } from "./labLetter";

/**
 * The note that goes out when a cohort is sent an exercise.
 *
 * Not to be confused with the Studio invitation next door, which tells people
 * a room exists. This one tells them there is something waiting in it with
 * their name on it, and it exists because for a while nothing did: an admin
 * pressed Invite, fifty invitations were written, and not one of those fifty
 * people was told. An exercise nobody knows about is an exercise nobody does,
 * and once invitations could carry a deadline it was worse than that — the
 * clock ran on something they had never heard of.
 *
 * ## What it must not say
 *
 * The crisis. Every learner gets a different one, and finding out what it is
 * at the moment it lands is most of the exercise; a cohort that reads the
 * situation the night before is being tested on preparation instead. So the
 * letter names what they are practising, which comes from the programme and is
 * the same for everybody, and stops there.
 *
 * ## Why the times say UTC
 *
 * A deadline is a wall-clock moment and this is read on a phone in Lagos, in
 * Nairobi, in London. The browser can word it in the reader's own clock and
 * does, on the card; an email is written once on a server that knows only UTC.
 * Naming the zone is the honest way out. Saying "17:00" and meaning somebody
 * else's is how people miss things.
 */

export type ExerciseInvite = {
  name?: string | null;
  /** The programme it came from. */
  programmeTitle?: string | null;
  /** What they are practising, in the programme's words. */
  objective: string;
  durationMinutes: number;
  difficulty: string;
  /** ISO, when the window has ends. */
  opensAt?: string | null;
  expiresAt?: string | null;
  url: string;
  logoUrl?: string | null;
};

function tidy(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** A moment, spelled out, with the zone named so nobody guesses. */
export function letterMoment(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return null;
  const said = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(at);
  return `${said} UTC`;
}

export function exerciseInviteSubject(invite: ExerciseInvite): string {
  const programme = tidy(invite.programmeTitle);
  return programme
    ? `A practice exercise is waiting for you — ${programme}`
    : "A practice exercise is waiting for you";
}

export function exerciseInviteParagraphs(invite: ExerciseInvite): string[] {
  const programme = tidy(invite.programmeTitle);
  const objective = tidy(invite.objective);
  const opens = letterMoment(invite.opensAt);
  const closes = letterMoment(invite.expiresAt);

  const paragraphs: string[] = [
    programme
      ? `An exercise has been set for everyone on ${programme}, and one is waiting for you in the Simulation Studio.`
      : "An exercise has been set for you in the Simulation Studio.",
    `What it is for: ${objective}`,
    // Said before they press anything, because they get one attempt and the
    // clock does not care what else turns up in the meantime.
    `It runs for ${invite.durationMinutes} minutes at ${tidy(invite.difficulty) || "intermediate"} level. `
      + "Once you begin it cannot be paused, restarted or left — the clock runs whether the page is "
      + "open or not — so start it when you have that time clear.",
  ];

  if (opens && closes) {
    paragraphs.push(`It opens on ${opens} and closes on ${closes}.`);
  } else if (opens) {
    paragraphs.push(`It opens on ${opens}. There is nothing to do until then.`);
  } else if (closes) {
    paragraphs.push(`Use it by ${closes}. After that the invitation stops working.`);
  }

  paragraphs.push(
    "You will not be told the situation in advance. That is the point of it: what is being "
      + "practised is what you do when something lands and you have not had the night to think "
      + "about it. At the end you get an honest account of how it went.",
  );

  return paragraphs;
}

export function exerciseInviteLetter(invite: ExerciseInvite): { subject: string; html: string; text: string } {
  const { html, text } = labLetter({
    greetingName: invite.name,
    paragraphs: exerciseInviteParagraphs(invite),
    // Deliberately not "Begin". The letter does not start the clock; opening
    // the Studio does not either. Only the button in there does.
    action: { label: "Open the Studio", url: invite.url, showUrl: true },
    logoUrl: invite.logoUrl,
    tagline: "The Simulation Studio",
  });

  return { subject: exerciseInviteSubject(invite), html, text };
}
