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
