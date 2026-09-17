/**
 * A Meet transcript, on its way into a class's material box.
 *
 * Three of this cohort's classes were checked and two had transcripts sitting
 * in Google that nobody had fetched. The third had none, because somebody
 * forgot to press a button. That is the shape of the problem: not a missing
 * capability, a missing habit — and a habit is the thing a machine should be
 * holding rather than a person.
 *
 * Two rules here matter more than the parsing.
 *
 * The first is that a machine never overwrites a person. The material box is
 * where a facilitator pastes a transcript they may have cleaned up, corrected
 * names in, or cut down to the part that was actually teaching. Replacing that
 * with a raw export because it happened to arrive later would destroy work
 * silently and be noticed weeks afterwards, if at all.
 *
 * The second is that half a transcript is worse than none. An empty box says
 * plainly that there is nothing to draft from. A box holding forty words from a
 * transcript somebody started and immediately stopped looks like material, gets
 * drafted from, and produces a quiz about the first thirty seconds of a class.
 */

import { MAX_NOTES_CHARS } from "./courseworkSource";

/**
 * Google's own disclaimer, which it writes into every transcript document.
 *
 * Stripped because it is the one line guaranteed not to be teaching, and
 * because it otherwise becomes the opening of every piece of material the
 * drafting reads. Matched loosely — Google has reworded it before — and if it
 * ever stops matching, the cost is one stray sentence rather than a lost
 * transcript.
 */
const DISCLAIMER = /^.*this .{0,20}transcript was computer generated.*$/gim;

/** How little is too little to be a class. */
export const MIN_TRANSCRIPT_CHARS = 600;

/**
 * The exported document, cleaned up just enough.
 *
 * Deliberately shallow. It would be easy to parse out the attendee list, the
 * heading and the timestamps — and every one of those is a rule that breaks
 * silently the day Google changes its layout, taking real speech with it. The
 * only thing removed is the line that is certainly not speech.
 */
export function tidyTranscript(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(DISCLAIMER, "")
    // Three or more blank lines is what removing a line leaves behind.
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_NOTES_CHARS);
}

export type ImportDecision =
  | { save: true; text: string; note: string }
  | { save: false; note: string };

/**
 * Whether this transcript should go into this class's box.
 *
 * `existing` is whatever is already there. Anything at all in it means a person
 * put it there, and a person beats a machine — there is no cleverness here
 * about which is newer or longer, because every version of that cleverness ends
 * with somebody's edited transcript replaced by a raw one.
 */
export function decideImport(args: {
  raw: string;
  existing: string | null | undefined;
}): ImportDecision {
  const existing = (args.existing ?? "").trim();
  if (existing.length > 0) {
    return {
      save: false,
      note: "This class already has material, so it was left alone. Clear the box first if you want the "
        + "transcript from Google instead.",
    };
  }

  const text = tidyTranscript(args.raw);
  if (text.length < MIN_TRANSCRIPT_CHARS) {
    // Better to leave the box empty and say why. An empty box is honest about
    // having nothing; a nearly-empty one gets drafted from.
    return {
      save: false,
      note: "The transcript Google has is too short to be the class — a few seconds of one, most likely, from "
        + "a transcript that was started and stopped again. Nothing was saved.",
    };
  }

  return {
    save: true,
    text,
    note: `Transcript saved — ${approximateWords(text).toLocaleString("en-GB")} words. `
      + "The quiz and the written task can be drafted from it.",
  };
}

/** Roughly how many words, for telling somebody what just arrived. */
export function approximateWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * What the material box is labelled when a machine filled it.
 *
 * Distinct from the hand-pasted label on purpose. The label travels into the
 * record of where a draft came from, and in six months "why is this question on
 * the quiz" deserves an answer that distinguishes a transcript a facilitator
 * chose and checked from one that arrived on its own.
 */
export const GOOGLE_TRANSCRIPT_LABEL = "Transcript (from Google Meet)";
