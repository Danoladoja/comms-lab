import { MAX_SLIDE_CHARS, slideTextQuality, type SlideTextQuality } from "./slideText";

/**
 * What the coursework drafter reads.
 *
 * Slides are the obvious source, but they are often the weakest one. A deck is
 * headings and a chart; the class is where someone explains why the tariff
 * reform stalled. So a facilitator can also paste material in — most usefully a
 * transcript of the class, which they can copy out of YouTube once the recording
 * is up.
 *
 * Either source alone is enough. A facilitator who teaches from a script and
 * never made slides can still draft coursework; so can one whose deck is all
 * photographs.
 */

/** A pasted transcript of a 90-minute class runs to roughly 90,000 characters. */
export const MAX_NOTES_CHARS = 150_000;

/**
 * The most text sent to the drafter in one go. Generous, but not unbounded: a
 * whole term of transcripts pasted into one box would cost real money per click
 * and produce worse questions, not better ones.
 */
export const MAX_COMBINED_SOURCE_CHARS = 90_000;

/**
 * When both sources are present, the deck is capped at a third of the budget and
 * the pasted material gets the rest.
 *
 * This looks unfair to the slides until you look at real material: a class deck
 * is three to eight thousand characters, so it never comes near the cap, while a
 * transcript routinely fills whatever it is given. A deck big enough to be
 * trimmed here is an appendix, and trimming an appendix is the right call.
 */
export const SLIDE_SHARE_OF_BUDGET = 1 / 3;

export const NOTES_LABELS = [
  "Transcript",
  "Speaker notes",
  "Session outline",
  "Other material",
] as const;
export type NotesLabel = (typeof NOTES_LABELS)[number];
export const DEFAULT_NOTES_LABEL: NotesLabel = "Transcript";

export type MaterialKind = "slides" | "notes";

export type CombinedSource = {
  /** What the model reads, with each source announced. */
  text: string;
  kinds: MaterialKind[];
  chars: number;
  /** True when something had to be cut to fit the budget. */
  truncated: boolean;
};

function trimTo(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  // Cut at a line break so the model is not handed half a sentence.
  const cut = text.slice(0, limit);
  const lastBreak = cut.lastIndexOf("\n");
  return { text: lastBreak > limit * 0.8 ? cut.slice(0, lastBreak) : cut, truncated: true };
}

/**
 * Assemble whatever material exists into one block for the drafter.
 *
 * Each source is announced by name so the model can say "the slides claim X but
 * in the class you said Y" rather than silently averaging the two.
 */
export function combineSources(input: {
  slideText?: string | null;
  notesText?: string | null;
  notesLabel?: string | null;
}): CombinedSource {
  const slides = (input.slideText ?? "").trim();
  const notes = (input.notesText ?? "").trim().slice(0, MAX_NOTES_CHARS);
  const label = (input.notesLabel ?? DEFAULT_NOTES_LABEL).trim() || DEFAULT_NOTES_LABEL;

  const kinds: MaterialKind[] = [];
  const parts: string[] = [];
  let truncated = false;

  const bothPresent = !!slides && !!notes;
  const slideBudget = bothPresent
    ? Math.min(MAX_SLIDE_CHARS, Math.floor(MAX_COMBINED_SOURCE_CHARS * SLIDE_SHARE_OF_BUDGET))
    : Math.min(MAX_SLIDE_CHARS, MAX_COMBINED_SOURCE_CHARS);

  if (slides) {
    const fitted = trimTo(slides, slideBudget);
    truncated = truncated || fitted.truncated;
    kinds.push("slides");
    parts.push(`=== SLIDES ===\n\n${fitted.text}`);
  }

  if (notes) {
    const used = parts.reduce((n, p) => n + p.length, 0);
    const fitted = trimTo(notes, Math.max(0, MAX_COMBINED_SOURCE_CHARS - used));
    if (fitted.text) {
      truncated = truncated || fitted.truncated;
      kinds.push("notes");
      parts.push(`=== ${label.toUpperCase()} ===\n\n${fitted.text}`);
    }
  }

  const text = parts.join("\n\n");
  return { text, kinds, chars: text.length, truncated };
}

/** Is there enough here to draft from? Same bar as a deck on its own. */
export function sourceQuality(source: CombinedSource): SlideTextQuality {
  return slideTextQuality(source.text);
}

/**
 * How the material reads in a sentence: "the slides and the transcript".
 * Used in the facilitator's record of where a draft came from.
 */
export function describeSource(kinds: MaterialKind[], notesLabel?: string | null): string {
  const label = (notesLabel ?? DEFAULT_NOTES_LABEL).trim().toLowerCase() || "notes";
  const names = kinds.map((k) => (k === "slides" ? "the slides" : `the ${label}`));
  if (names.length === 0) return "nothing";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
