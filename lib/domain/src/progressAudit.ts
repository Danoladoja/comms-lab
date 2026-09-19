/**
 * Reading a learner's record against what the Lab says about it.
 *
 * Every number on a learner's dashboard is worked out from stored rows at the
 * moment it is asked for. That is the right design — there is one answer and it
 * cannot go stale — but it means a fault in the working shows up as a wrong
 * verdict with no trace of how it got there, and the only honest answer to "is
 * my progress being counted?" was "it should be".
 *
 * So this puts the two side by side: what is recorded against somebody, and
 * what the Lab concluded from it, with a flag wherever those two cannot both be
 * right. It changes nothing and fixes nothing. It is for finding out.
 */

export type AuditFacts = {
  /** A recording exists for this module. */
  hasRecording: boolean;
  /** The length the whole cohort is measured against, in seconds. */
  moduleRecordingSeconds: number | null;
  /** The copy stored on this learner's own row, in seconds. */
  learnerRecordingSeconds: number | null;
  /** Distinct seconds of the recording this learner has covered. */
  watchedSeconds: number;
  /** What the Lab concluded about attendance. */
  presenceMet: boolean;
  liveSeconds: number;

  /** A task was published for this module. */
  hasAssignment: boolean;
  /** This learner filed one. Read from the submission itself, not from the verdict. */
  hasSubmission: boolean;
  /**
   * Staff hid it. The text is untouched — this is the one kind of missing work
   * that is missing on purpose and comes back whole.
   */
  withdrawn: boolean;
  /** The day it was withdrawn, already worded, or null. */
  withdrawnOn: string | null;
  /**
   * How long the filed piece is, in characters.
   *
   * A submission replaces the one before it in place and keeps no history, so
   * a learner who saved over their own work with a blank or half-loaded editor
   * leaves a very short row behind and no trace of what was there. Length is
   * the only evidence of that there is.
   */
  bodyLength: number;

  critiquesGiven: number;
  reviewsRequired: number;
  /** What was written down when they satisfied it, or null. */
  reviewsCleared: number | null;

  hasQuiz: boolean;
  quizBestScore: number | null;
  quizPassed: boolean;

  completed: boolean;
};

export type AuditFlag = {
  code:
    | "watched-nothing-counted"
    | "recording-length-disagrees"
    | "watched-beyond-length"
    | "no-recording-length"
    | "withdrawn"
    | "very-short-submission"
    | "filed-but-not-asked"
    | "critiques-not-counted"
    | "owes-critiques";
  /** What it means, in the words the admin should read. */
  note: string;
};

const MINUTE = 60;

/**
 * Everything about this learner and this module that cannot be right.
 *
 * Deliberately says what was observed rather than what to do about it. Half of
 * these have innocent explanations — a task taken down on purpose, a recording
 * genuinely replaced — and an audit that guesses at intent is one nobody trusts
 * the second time.
 */
export function auditFlags(f: AuditFacts): AuditFlag[] {
  const flags: AuditFlag[] = [];

  if (f.hasRecording && f.moduleRecordingSeconds === null) {
    flags.push({
      code: "no-recording-length",
      note: "This module has a recording but no agreed length, so nobody's watching can count "
        + "towards anything until somebody opens it and a length is settled.",
    });
  }

  if (f.watchedSeconds > 0 && f.moduleRecordingSeconds === null) {
    flags.push({
      code: "watched-nothing-counted",
      note: `${Math.round(f.watchedSeconds / MINUTE)} minutes watched, counting for nothing, `
        + "because the recording has no agreed length to measure it against.",
    });
  }

  if (
    f.moduleRecordingSeconds !== null
    && f.learnerRecordingSeconds !== null
    && f.moduleRecordingSeconds !== f.learnerRecordingSeconds
  ) {
    flags.push({
      code: "recording-length-disagrees",
      note: `The module says this recording is ${Math.round(f.moduleRecordingSeconds / MINUTE)} `
        + `minutes long and this learner's own record says ${Math.round(f.learnerRecordingSeconds / MINUTE)}. `
        + "The length was cleared and settled again at some point while they were watching.",
    });
  }

  if (f.moduleRecordingSeconds !== null && f.watchedSeconds > f.moduleRecordingSeconds) {
    flags.push({
      code: "watched-beyond-length",
      note: `Covered ${Math.round(f.watchedSeconds / MINUTE)} minutes of a recording the module `
        + `says is ${Math.round(f.moduleRecordingSeconds / MINUTE)} minutes. The agreed length was `
        + "settled short after they watched, so it is the length that is wrong, not the watching.",
    });
  }

  if (f.withdrawn) {
    flags.push({
      code: "withdrawn",
      note: `Their work was withdrawn by staff${f.withdrawnOn ? ` on ${f.withdrawnOn}` : ""}, `
        + `and all ${f.bodyLength} characters of it are still stored. Nothing has been lost — `
        + "it is hidden, and putting it back is one action.",
    });
  }

  // 200 characters is about forty words: shorter than any real answer to any
  // task, and long enough not to catch somebody who writes tightly.
  if (f.hasSubmission && !f.withdrawn && f.hasAssignment && f.bodyLength < 200) {
    flags.push({
      code: "very-short-submission",
      note: `Their filed work is ${f.bodyLength} characters — too short to be a finished answer. `
        + "A submission replaces the one before it and keeps no history, so this is what a save "
        + "over a blank or half-loaded editor leaves behind. Worth asking them whether they still "
        + "have their own copy.",
    });
  }

  if (f.hasSubmission && !f.hasAssignment) {
    flags.push({
      code: "filed-but-not-asked",
      note: "They filed work for this module, but no task is published on it — so their submission "
        + "counts towards nothing and nobody can critique it. Usually a task taken back to draft.",
    });
  }

  if (f.critiquesGiven > 0 && !f.hasAssignment) {
    flags.push({
      code: "critiques-not-counted",
      note: `${f.critiquesGiven} critique${f.critiquesGiven === 1 ? "" : "s"} written on a module `
        + "with no published task, so none of them count towards anything.",
    });
  }

  if (f.hasAssignment && f.critiquesGiven < f.reviewsRequired && f.reviewsCleared !== null) {
    flags.push({
      code: "owes-critiques",
      note: `Recorded as having satisfied ${f.reviewsCleared}, but ${f.reviewsRequired} `
        + "is now being asked. This learner was caught by the fault where the requirement rose "
        + "after they had finished.",
    });
  }

  return flags;
}

/** One line about a whole cohort's audit, for the top of the page. */
export function auditNote(rows: readonly { flags: readonly AuditFlag[] }[], learners: number): string {
  const flagged = rows.filter((r) => r.flags.length > 0).length;
  if (learners === 0) return "Nobody is enrolled on this programme.";
  if (flagged === 0) {
    return `Nothing to answer for. Every record for all ${learners} matches what the Lab says about it.`;
  }
  return `${flagged} record${flagged === 1 ? "" : "s"} across ${learners} learner`
    + `${learners === 1 ? "" : "s"} where what is stored and what the Lab says cannot both be right.`;
}
