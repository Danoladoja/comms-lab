/**
 * How a piece of writing came to exist, and what the writer says about it.
 *
 * This is the Lab's answer to "was this written by a machine", and it is
 * deliberately not a detector. Detectors do not work: they disagree wildly with
 * each other, and — the part that matters here — they flag people writing in a
 * second language more often than fluent natives. A pan-African cohort writing
 * careful, formal English is precisely the group such a tool would accuse most,
 * and the accusation would arrive wearing a percentage, which people read as a
 * fact rather than a guess.
 *
 * So nothing here produces a score. Two things happen instead.
 *
 * One: the plain facts of how the draft was made — how long, across how many
 * sittings, how much arrived in a single paste — are recorded and shown as a
 * sentence. A facilitator can raise a two-minute, one-paste submission with a
 * learner because it describes what happened. Nobody can be falsely accused by
 * a timestamp.
 *
 * Two: the writer says how they used AI. That is the part that teaches. Knowing
 * how to declare your tools is a working habit in newsrooms now, and asking for
 * it is worth more than catching anybody.
 *
 * What is never recorded: keystrokes, content, screens. Counts and timings only.
 * That is a sentence the Lab can say out loud to a cohort without flinching.
 */

export type AiUse =
  | "none"
  | "research"
  | "edit"
  | "draft-then-rewrote"
  | "other";

export const AI_USE_CHOICES: { value: AiUse; label: string }[] = [
  { value: "none", label: "Not at all" },
  { value: "research", label: "To research or check facts" },
  { value: "edit", label: "To edit and tighten what I wrote" },
  { value: "draft-then-rewrote", label: "It produced a draft and I rewrote it" },
  { value: "other", label: "Something else" },
];

const VALUES = new Set<string>(AI_USE_CHOICES.map((c) => c.value));

export const MAX_AI_NOTE_CHARS = 280;

export function isAiUse(value: unknown): value is AiUse {
  return typeof value === "string" && VALUES.has(value);
}

export function aiUseLabel(value: string | null | undefined): string {
  const found = AI_USE_CHOICES.find((c) => c.value === value);
  // A submission filed before the question existed has no answer, and saying so
  // is better than implying the writer declined to answer.
  return found ? found.label : "Not declared";
}

/**
 * Is this disclosure good enough to file?
 *
 * Required, because the four seconds it costs are the whole point — and
 * "something else" without saying what is not a disclosure, it is a shrug.
 */
export function disclosureProblem(use: unknown, note: string | null | undefined): string | null {
  if (!isAiUse(use)) return "Say how you used AI on this piece before you submit it.";
  const text = (note ?? "").trim();
  if (use === "other" && text.length === 0) {
    return "You chose “something else” — say in a line what that was.";
  }
  if (text.length > MAX_AI_NOTE_CHARS) {
    return `Keep the note under ${MAX_AI_NOTE_CHARS} characters.`;
  }
  return null;
}

/** The facts gathered while somebody was writing. All counts and durations. */
export type Provenance = {
  /** Seconds the editor was actually being typed in, not seconds it sat open. */
  activeSeconds: number;
  /** Separate stretches of work, split by a long gap. */
  sittings: number;
  pasteCount: number;
  /** Characters arriving by paste, totalled. */
  pastedChars: number;
  /** The single largest paste. */
  largestPaste: number;
  /** Length of what was finally filed. */
  finalChars: number;
};

export const EMPTY_PROVENANCE: Provenance = {
  activeSeconds: 0,
  sittings: 0,
  pasteCount: 0,
  pastedChars: 0,
  largestPaste: 0,
  finalChars: 0,
};

/** A gap longer than this ends one sitting and starts another. */
export const SITTING_GAP_MINUTES = 20;

function minutes(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 1) return "under a minute";
  return `${mins} minute${mins === 1 ? "" : "s"}`;
}

function share(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

/**
 * What a facilitator reads.
 *
 * A sentence about what happened, never a verdict about who wrote it. The
 * largest paste is given as a share of the finished piece because that is the
 * number that actually means something: 180 characters inside a 4,000-character
 * essay is a quotation, and 1,850 inside 1,920 is the essay.
 */
export function describeProvenance(p: Provenance | null | undefined): string {
  if (!p || (p.activeSeconds === 0 && p.pasteCount === 0 && p.sittings === 0)) {
    // Everything filed before this existed, and anything a browser could not
    // report. Silence is more honest than a manufactured zero.
    return "No record of how this was written — it was filed before the Lab kept one.";
  }

  const sittings = Math.max(1, p.sittings);
  const opening = `Written over ${sittings} sitting${sittings === 1 ? "" : "s"}, ${minutes(p.activeSeconds)}.`;

  if (p.pasteCount === 0) return `${opening} Nothing was pasted in.`;

  const pasted = `${p.pasteCount} paste${p.pasteCount === 1 ? "" : "s"}`;
  const biggest = `largest ${p.largestPaste.toLocaleString()} characters`;
  const pct = share(p.largestPaste, p.finalChars);
  return `${opening} ${pasted}, ${biggest}${pct > 0 ? ` (${pct}% of the final piece)` : ""}.`;
}

/**
 * Is this worth a facilitator's eye?
 *
 * Not an accusation and not a score — a sorting hint, so a facilitator reading
 * twenty pieces knows which two to start with. The test is deliberately blunt:
 * almost all of the piece arrived in one paste, and almost no time was spent.
 * Both have innocent explanations, which is why this raises an eyebrow rather
 * than a flag.
 */
export function worthALook(p: Provenance | null | undefined): boolean {
  if (!p || p.finalChars === 0) return false;
  const arrivedWhole = share(p.largestPaste, p.finalChars) >= 80;
  const barelyTouched = p.activeSeconds < 5 * 60;
  return arrivedWhole && barelyTouched;
}

/**
 * A critique that probably was not read.
 *
 * Two signals a facilitator would otherwise have to find by eye across twenty
 * submissions: feedback barely over the minimum length, and feedback nearly
 * identical to something the same person wrote elsewhere. Neither proves
 * anything on its own; both are worth a look.
 */
export function thinCritique(comment: string, othersBySameReviewer: string[]): boolean {
  const text = comment.trim();
  if (text.length === 0) return false;
  if (text.length < MIN_USEFUL_CRITIQUE_CHARS) return true;
  return othersBySameReviewer.some((other) => similarity(text, other) >= NEAR_DUPLICATE);
}

/** Shorter than this and it is a compliment, not a critique. */
export const MIN_USEFUL_CRITIQUE_CHARS = 160;

/** Above this share of shared words, two critiques are the same critique. */
export const NEAR_DUPLICATE = 0.85;

/**
 * How alike two pieces of writing are, by the words they share.
 *
 * Compared word by word rather than by matching the opening, because the tell
 * for recycled feedback is one word swapped in the first line — which a
 * prefix comparison misses entirely, and which this catches.
 */
export function similarity(a: string, b: string): number {
  const wordsOf = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const mine = wordsOf(a);
  const theirs = wordsOf(b);
  if (mine.length === 0 || theirs.length === 0) return 0;

  const left = new Map<string, number>();
  for (const word of mine) left.set(word, (left.get(word) ?? 0) + 1);

  let shared = 0;
  for (const word of theirs) {
    const remaining = left.get(word) ?? 0;
    if (remaining > 0) { shared += 1; left.set(word, remaining - 1); }
  }
  return shared / Math.max(mine.length, theirs.length);
}
