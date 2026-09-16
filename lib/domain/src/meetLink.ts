/**
 * The link that takes a learner into the class.
 *
 * It is typed by a person into a box, which is the whole problem. Google offers
 * a meeting several different ways — a full https address, a bare
 * meet.google.com/abc-defg-hij with no scheme, sometimes just the code — and
 * people paste whichever one their screen was showing.
 *
 * A link without a scheme is the dangerous one, because it does not fail
 * loudly. `window.open("meet.google.com/abc-defg-hij")` is not an address, it
 * is a *relative path*: the browser resolves it against the page the learner is
 * standing on and sends them to energycommslab.africa/meet.google.com/… which
 * does not exist. They see a 404, conclude the class link is broken, and tell
 * you Google is down. Nothing in the logs looks wrong, because nothing went
 * wrong on the way out — the address was simply never an address.
 *
 * So every link is normalised on the way into the database and checked again on
 * the way out, and the browser refuses to open anything that is not plainly
 * somewhere else.
 */

/** A Google Meet code: three letters, four, then three. */
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;

/**
 * An address sitting inside other words.
 *
 * Google Calendar's own copy button hands you "Video call link:
 * https://meet.google.com/abc-defg-hij", and an invitation pasted from an
 * email brings a sentence with it. Refusing those was worse than useless:
 * the link was thrown away and the admin's meeting link silently emptied.
 *
 * Trailing punctuation is trimmed because a link at the end of a sentence
 * collects the full stop, and a link inside brackets collects the bracket.
 */
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+/i;
const HOST_IN_TEXT = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s<>"'`]+/i;

function tidyTail(url: string): string {
  return url.replace(/[.,;:!?)\]}>]+$/, "");
}

/**
 * Turn whatever was pasted into an address a browser will travel to, or null
 * when there is nothing usable in it.
 *
 * Deliberately generous: the Lab has run classes on Meet, Zoom and a university
 * system, and refusing an address because it is not Google would be a worse
 * failure than the one this fixes. Generous about *shape* too — people paste
 * what their screen was showing, which is rarely a bare URL.
 */
export function normaliseMeetUrl(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  // A bare meeting code, which is what Google shows in large type on its own
  // dashboard and therefore what people copy.
  if (MEET_CODE.test(text)) return `https://meet.google.com/${text.toLowerCase()}`;

  // A real address anywhere in what was pasted — on its own, or wrapped in the
  // words Calendar and email clients put around it.
  const found = URL_IN_TEXT.exec(text);
  if (found) return tidyTail(found[0]);

  // Anything else carrying a scheme — javascript:, data: — is refused rather
  // than handed to a browser.
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null;

  // No scheme, but it looks like a host: the relative-path trap. A leading
  // slash is the same trap wearing a different hat.
  const hostish = text.replace(/^\/+/, "");
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(hostish)) return `https://${hostish}`;

  // A host with a path, buried in words — "Video call link: meet.google.com/abc".
  const host = HOST_IN_TEXT.exec(text);
  if (host) return `https://${tidyTail(host[0])}`;

  return null;
}

/**
 * Is this safe to send somebody to?
 *
 * The last gate before `window.open`. A relative path reaching here means a
 * link escaped normalisation — an older row, or a value written before this
 * existed — and sending the learner to a 404 on our own site is worse than
 * telling them the link needs fixing.
 */
export function isOpenableMeetUrl(url: string | null | undefined): boolean {
  return /^https?:\/\//i.test((url ?? "").trim());
}

/** What an admin is told about a link as they type it, or null when it is fine. */
export function meetUrlProblem(raw: string | null | undefined): string | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const normalised = normaliseMeetUrl(text);
  if (!normalised) {
    return "That does not look like a joining link. Paste the full address, or the meeting code on its own.";
  }
  if (normalised !== text) {
    return `Saved as ${normalised} — a link without “https://” sends learners to a page that does not exist.`;
  }
  return null;
}
