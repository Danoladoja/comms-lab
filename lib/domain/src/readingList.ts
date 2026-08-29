/**
 * The reading list: what the facilitator points learners at beyond the class.
 *
 * Deliberately ungraded, and deliberately not part of module completion. It is a
 * shelf, not a hurdle — a report worth knowing about, a piece of writing worth
 * copying, the dataset behind a chart on slide nine. Making it count would turn
 * a generous gesture into another box, and the programme already has enough of
 * those.
 *
 * Nothing here is read by `computeProgress`, and that is the point.
 */

export const MAX_READINGS_PER_MODULE = 20;
export const MAX_READING_TITLE = 200;
export const MAX_READING_NOTE = 400;

export type ReadingItem = {
  title: string;
  url: string;
  /** One line on why it is worth the learner's time. Optional. */
  note: string;
};

/**
 * Tidy a pasted link into something that will actually open.
 *
 * People paste `www.iea.org/reports/...` without a scheme, which renders as a
 * relative link and takes the learner to a 404 inside the platform. A missing
 * scheme is assumed to be https rather than rejected — being pedantic here just
 * makes facilitators retype things.
 *
 * Returns null for anything that is not a plausible web address, and for
 * `javascript:` and `data:` links, which have no business in a reading list.
 */
export function normaliseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Anything with a scheme must be http or https.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") return null;
  }

  const withScheme = schemeMatch ? trimmed : `https://${trimmed}`;

  // host, optional port, optional path — enough to reject "not a link" without
  // trying to out-parse the browser.
  const shape = /^https?:\/\/([a-z0-9-]+\.)+[a-z]{2,}(:\d{1,5})?(\/\S*)?$/i;
  return shape.test(withScheme) ? withScheme : null;
}

/** The site a link points at, for display beside the title. */
export function displayHost(url: string): string {
  const match = /^https?:\/\/(?:www\.)?([^/:?#]+)/i.exec(url);
  return match ? match[1].toLowerCase() : "";
}

export type ReadingProblem = { index: number; message: string };

/**
 * Check a submitted list before it is saved.
 *
 * Returns the items worth keeping plus what was wrong with the rest, so the
 * facilitator sees which row failed rather than a single unhelpful refusal.
 */
export function validateReadings(raw: { title?: string; url?: string; note?: string }[]): {
  items: ReadingItem[];
  problems: ReadingProblem[];
} {
  const items: ReadingItem[] = [];
  const problems: ReadingProblem[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of raw.slice(0, MAX_READINGS_PER_MODULE).entries()) {
    const title = (entry.title ?? "").trim().slice(0, MAX_READING_TITLE);
    const note = (entry.note ?? "").trim().slice(0, MAX_READING_NOTE);
    const url = normaliseUrl(entry.url ?? "");

    // A blank row is someone who clicked "add" and changed their mind.
    if (!title && !(entry.url ?? "").trim()) continue;

    if (!url) {
      problems.push({ index, message: "That does not look like a web address" });
      continue;
    }
    if (!title) {
      problems.push({ index, message: "Give the link a title so learners know what it is" });
      continue;
    }
    if (seen.has(url)) {
      problems.push({ index, message: "Already on the list" });
      continue;
    }

    seen.add(url);
    items.push({ title, url, note });
  }

  if (raw.length > MAX_READINGS_PER_MODULE) {
    problems.push({
      index: MAX_READINGS_PER_MODULE,
      message: `Only the first ${MAX_READINGS_PER_MODULE} links were kept`,
    });
  }

  return { items, problems };
}
