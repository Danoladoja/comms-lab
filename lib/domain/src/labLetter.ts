import { escapeHtml } from "./partnership";

/**
 * Every letter the Lab sends, in one place.
 *
 * There were four different designs in the codebase and six places sending
 * mail. The invitation had the full thing: the dark masthead, the card on a
 * cream ground, the pill button, the footer. The Studio invitation had the same
 * markup again, copied. The enrolment and reminder emails had a plainer wrapper
 * with no masthead at all, and the waitlist confirmation was four bare
 * paragraphs with no styling whatsoever.
 *
 * A learner meets several of these in their first fortnight. Arriving as four
 * different-looking things from the same organisation reads either as
 * carelessness or as something forged, and the plainest of them read as the
 * latter — an unstyled message carrying a link is what a phishing attempt looks
 * like. So there is now one letter, and the only thing that differs between any
 * two emails is the words.
 *
 * The design is the invitation's, unchanged, because that is the one that was
 * already right and the one people have already received.
 *
 * Two decisions worth keeping:
 *
 * The logo is never the only thing carrying the Lab's name. Most clients block
 * images until the reader allows them, so the name is set in type as well.
 *
 * A button always prints its link in full underneath. Plenty of people read
 * mail on a phone that renders the button badly, or in a client that strips it
 * entirely, and a link nobody can open is the same as one that never arrived.
 */

export type LetterAction = {
  label: string;
  url: string;
  /**
   * Print the address under the button.
   *
   * True for anything single-use or unrepeatable — an invitation link, a
   * password reset. False for an ordinary "open my dashboard", where the
   * address is long, ugly, and reachable another way.
   */
  showUrl?: boolean;
};

export type Letter = {
  /** "Amina" or "there". Never the raw name — see labGreeting. */
  greetingName?: string | null;
  paragraphs: readonly string[];
  action?: LetterAction | null;
  /** Small print under a rule: what this is, how to ignore it. */
  footnote?: string | null;
  /** Absolute URL. Null renders the Lab's name in type instead. */
  logoUrl?: string | null;
  /**
   * The line under the masthead. Defaults to the Lab's.
   *
   * The Studio's invitation says "The Simulation Studio" here instead, which is
   * a difference in words rather than in design, and is the kind of thing this
   * template exists to allow.
   */
  tagline?: string | null;
};

/**
 * The Lab's colours, in one place.
 *
 * They were literals inside the letter's HTML, which was fine while the letter
 * was the only branded thing the Lab produced. It is not any more: the closing
 * survey is a page a learner meets in the same fortnight as four of these
 * emails, and two near-identical oranges would read as two organisations.
 *
 * Exported as values rather than written into a stylesheet because the letter
 * needs them as inline hex — every serious mail client strips a stylesheet —
 * and the survey needs the same hex to match it.
 */
export const LAB_COLOURS = {
  /** The masthead and all body text. Near-black with a blue cast. */
  ink: "#07111E",
  /** The ground a letter sits on. */
  cream: "#EFEAE0",
  /** The lighter cream of the footer and the masthead's type. */
  creamLight: "#F4F0E8",
  /** The one accent: buttons, rules under headings. */
  accent: "#F97316",
  /** Small print and anything secondary. */
  muted: "#5B6470",
  /** Hairlines. */
  rule: "#E4DFD4",
} as const;

export const LAB_CONTACT_EMAIL = "africaenergypulse@gmail.com";
export const LAB_TAGLINE = "Africa's learning hub for energy communicators";

export function tidyLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** "Amina," or "there," — never "Hello ," with a hole where a name should be. */
export function labGreeting(name: string | null | undefined): string {
  const first = tidyLine(name).split(" ")[0] ?? "";
  return first || "there";
}

/**
 * Free text an admin typed, as paragraphs.
 *
 * A blank line starts a new one, which is how people already write. Everything
 * is escaped on the way into the HTML: this text reaches fifty inboxes, and an
 * admin who pastes something containing a stray angle bracket should get a
 * stray angle bracket rather than a broken letter.
 */
export function paragraphsFrom(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean).join(" "))
    .filter(Boolean);
}

export function labLetterHtml(letter: Letter): string {
  const greeting = escapeHtml(labGreeting(letter.greetingName));
  const logo = tidyLine(letter.logoUrl);

  const masthead = logo
    ? `<img src="${escapeHtml(logo)}" alt="Ananse Comms Lab" width="180"
             style="display: block; width: 180px; max-width: 60%; height: auto; border: 0;" />`
    : `<span style="color: ${LAB_COLOURS.creamLight}; font-size: 20px; font-weight: bold; letter-spacing: 0.02em;">Ananse Comms Lab</span>`;

  const body = letter.paragraphs
    .map((p) => `<p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">${escapeHtml(p)}</p>`)
    .join("\n      ");

  const action = letter.action
    ? `
      <p style="margin: 28px 0 8px;">
        <a href="${escapeHtml(letter.action.url)}"
           style="background: ${LAB_COLOURS.accent}; color: ${LAB_COLOURS.ink}; font-weight: bold; font-size: 15px; padding: 14px 28px; border-radius: 999px; text-decoration: none; display: inline-block;">
          ${escapeHtml(letter.action.label)}
        </a>
      </p>`
    : "";

  const printedUrl = letter.action?.showUrl
    ? `
      <p style="margin: 16px 0 0; font-size: 12px; color: ${LAB_COLOURS.muted}; line-height: 1.6;">
        If the button does not work, copy this address into your browser:<br />
        <span style="word-break: break-all;">${escapeHtml(letter.action.url)}</span>
      </p>`
    : "";

  const footnote = tidyLine(letter.footnote)
    ? `
      <p style="margin: 20px 0 0; padding-top: 16px; border-top: 1px solid ${LAB_COLOURS.rule}; font-size: 12px; color: ${LAB_COLOURS.muted}; line-height: 1.6;">
        ${escapeHtml(tidyLine(letter.footnote))}
      </p>`
    : "";

  return `
<div style="background: ${LAB_COLOURS.cream}; padding: 24px 12px; font-family: Arial, Helvetica, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; background: #FFFFFF; border-radius: 14px; overflow: hidden;">

    <div style="background: ${LAB_COLOURS.ink}; padding: 24px 28px;">
      ${masthead}
      <p style="margin: 12px 0 0; color: ${LAB_COLOURS.creamLight}; opacity: 0.75; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;">
        ${tidyLine(letter.tagline) ? escapeHtml(tidyLine(letter.tagline)) : LAB_TAGLINE}
      </p>
    </div>

    <div style="padding: 28px; color: ${LAB_COLOURS.ink};">
      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6;">Hello ${greeting},</p>
      ${body}${action}${printedUrl}${footnote}
    </div>

    <div style="background: ${LAB_COLOURS.creamLight}; padding: 16px 28px; font-size: 11px; color: ${LAB_COLOURS.muted};">
      Ananse Comms Lab · <a href="mailto:${LAB_CONTACT_EMAIL}" style="color: ${LAB_COLOURS.muted};">${LAB_CONTACT_EMAIL}</a>
    </div>

  </div>
</div>`.trim();
}

/**
 * The plain-text version, which is not an afterthought.
 *
 * Some clients show it instead of the HTML, and spam filters treat a message
 * with no text alternative as more suspicious than one with it.
 */
export function labLetterText(letter: Letter): string {
  const lines = [`Hello ${labGreeting(letter.greetingName)},`, ""];
  for (const paragraph of letter.paragraphs) lines.push(paragraph, "");
  if (letter.action) lines.push(letter.action.label, letter.action.url, "");
  if (tidyLine(letter.footnote)) lines.push(tidyLine(letter.footnote), "");
  lines.push(`Ananse Comms Lab · ${tidyLine(letter.tagline) || LAB_TAGLINE}`, LAB_CONTACT_EMAIL);
  return lines.join("\n");
}

export function labLetter(letter: Letter): { html: string; text: string } {
  return { html: labLetterHtml(letter), text: labLetterText(letter) };
}
