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

  /*
    A difference worth telling somebody about.

    This compared the two lengths in seconds and printed them in minutes, so a
    recording stored as 3420 seconds on the module and 3421 on a learner's row
    produced "the module says 57 minutes and their record says 57" — a
    contradiction in terms, printed six times, against a cohort where nothing
    was wrong at all. A player reports a fractional duration and it is rounded
    differently on two paths; that is not a fault, it is arithmetic.

    A minute apart is the smallest gap that could move anybody's percentage
    past a bar, and it is also the smallest gap a person can see in a sentence
    written in minutes.
  */
  const RECORDING_TOLERANCE_SECONDS = 60;
  if (
    f.moduleRecordingSeconds !== null
    && f.learnerRecordingSeconds !== null
    && Math.abs(f.moduleRecordingSeconds - f.learnerRecordingSeconds) > RECORDING_TOLERANCE_SECONDS
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

/* ------------------------------------------------------------------ *
 * Getting the audit out of the screen
 * ------------------------------------------------------------------ */

export type AuditReportRow = {
  moduleTitle: string;
  liveMinutes: number;
  watchedMinutes: number;
  learnerRecordingMinutes: number | null;
  hasSubmission: boolean;
  withdrawn: boolean;
  critiquesGiven: number;
  critiquesReceived: number;
  reviewsRequired: number;
  completed: boolean;
  locked: boolean;
  progressPct: number;
  /*
    Loosely typed on purpose. The flags arriving here have been through the
    API, which types the code as a plain string, and a report that refused to
    print a flag it did not recognise would hide exactly the thing somebody
    added last.
  */
  flags: readonly { code: string; note: string }[];
};

export type AuditReport = {
  programmeTitle: string;
  note: string;
  /** Accounts sharing an email where one holds the record and another does not. */
  duplicates?: readonly { note: string }[];
  learners: readonly {
    name: string;
    flagged: number;
    rows: readonly AuditReportRow[];
  }[];
};

/**
 * The audit as plain text, for pasting to somebody who can read it.
 *
 * The screen was built to be read and then, obviously, to be passed on — and
 * had no way to get anything off it. A person looking at forty learners and a
 * page of findings cannot retype them, and a screenshot of a scrolling list is
 * half a screenshot.
 *
 * Only the records with something wrong. A clean cohort produces four lines
 * saying so, which is the right length for that answer.
 *
 * No email addresses and not a word of anybody's writing. This is meant to be
 * pasted somewhere, and what goes in it should be only what the question
 * needs: a name to act on, a number to judge by, and the sentence explaining
 * what cannot be right.
 */
export function auditReportText(report: AuditReport): string {
  const lines: string[] = [
    "ANANSE COMMS LAB — PROGRESS AUDIT",
    `Programme: ${report.programmeTitle}`,
    report.note,
  ];

  /*
    First, because it is the only thing here about a record that has gone
    missing rather than been miscounted — and because nothing has been lost in
    it, which is the most useful sentence on the page.
  */
  const duplicates = report.duplicates ?? [];
  if (duplicates.length > 0) {
    lines.push("", "ACCOUNTS HOLDING A RECORD THE LAB IS NOT ASKING:");
    for (const d of duplicates) lines.push(`  ${d.note}`);
  }

  const troubled = report.learners.filter((l) => l.flagged > 0);
  if (troubled.length === 0) {
    lines.push("", "No records contradict themselves.");
    return lines.join("\n");
  }

  lines.push("", `${troubled.length} of ${report.learners.length} learners have something to look at.`, "");

  for (const learner of troubled) {
    lines.push(`${learner.name}`);
    for (const row of learner.rows) {
      if (row.flags.length === 0) continue;
      const stored = [
        `${row.liveMinutes} min in class`,
        row.learnerRecordingMinutes === null
          ? `${row.watchedMinutes} min watched`
          : `${row.watchedMinutes} of ${row.learnerRecordingMinutes} min watched`,
        `task ${row.withdrawn ? "withdrawn" : row.hasSubmission ? "in" : "not in"}`,
        `${row.critiquesGiven}/${row.reviewsRequired} critiques written`,
        `${row.critiquesReceived} received`,
      ].join(" · ");
      const verdict = row.locked ? "LOCKED" : row.completed ? "complete" : `${row.progressPct}%`;
      lines.push(`  ${row.moduleTitle} — ${verdict}`);
      lines.push(`    stored: ${stored}`);
      for (const flag of row.flags) lines.push(`    [${flag.code}] ${flag.note}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/* ------------------------------------------------------------------ *
 * A record that looks wiped
 * ------------------------------------------------------------------ */

/**
 * Two accounts, one person.
 *
 * The audit above compares what is stored against what the Lab concludes from
 * it. That cannot see a record that has gone: there is nothing left to
 * disagree with, and a learner whose history has vanished looks exactly like a
 * learner who never did anything.
 *
 * But the commonest way a record "disappears" does not delete anything. The
 * Lab finds a signed-in person by their Clerk id and nothing else, and two
 * user rows may share an email address — nothing forbids it. So a learner
 * whose sign-in identity changes for any reason, most often a change to how
 * signing in works, arrives as somebody the Lab has never seen: a new row, an
 * empty record, and every minute they ever watched still sitting on the row
 * they used to be.
 *
 * Nothing is lost in that case. It is filed under a name the app has stopped
 * asking about.
 */
export type AccountFacts = {
  userId: number;
  /** When the row was made, already worded. */
  createdOn: string;
  enrolledOnProgrammes: number;
  classesAttended: number;
  recordingsWatched: number;
  tasksFiled: number;
  critiquesWritten: number;
};

export function historyOn(account: AccountFacts): number {
  return account.classesAttended + account.recordingsWatched
    + account.tasksFiled + account.critiquesWritten;
}

/**
 * Is this pair worth showing somebody? Only when one account carries a record
 * and another carries little or none — which is what a wipe looks like from
 * the outside, and what a duplicate that has never been used does not.
 */
export function looksWiped(accounts: readonly AccountFacts[]): boolean {
  if (accounts.length < 2) return false;
  const carrying = accounts.filter((a) => historyOn(a) > 0);
  return carrying.length >= 1 && carrying.length < accounts.length;
}

export function duplicateNote(email: string, accounts: readonly AccountFacts[]): string {
  const sorted = [...accounts].sort((a, b) => historyOn(b) - historyOn(a));
  const holder = sorted[0];
  const empty = sorted.slice(1);
  const parts = [
    `${holder.classesAttended} class${holder.classesAttended === 1 ? "" : "es"} attended`,
    `${holder.recordingsWatched} recording${holder.recordingsWatched === 1 ? "" : "s"} watched`,
    `${holder.tasksFiled} task${holder.tasksFiled === 1 ? "" : "s"} filed`,
    `${holder.critiquesWritten} critique${holder.critiquesWritten === 1 ? "" : "s"} written`,
  ];
  return `${email} has ${accounts.length} accounts in the Lab. The older one `
    + `(made ${holder.createdOn}) holds ${parts.join(", ")}. `
    + `The one they are signing in with now (made ${empty[0]?.createdOn ?? "later"}) holds `
    + "nothing. Their record is not lost — the Lab is asking the wrong account for it.";
}

/* ------------------------------------------------------------------ *
 * One learner, looked up by name
 * ------------------------------------------------------------------ */

/**
 * Where one person's record actually is.
 *
 * The cohort audit answers "is what is stored being counted correctly". This
 * answers the different question somebody asks when a learner says their work
 * has gone: is it there at all, and if so, under what.
 *
 * It makes no assumption about the shape of the trouble. Two accounts, one
 * empty account, an account with a record but no enrolment — each of those
 * looks identical to the learner and needs a different answer, and guessing
 * which it is before looking is how the last three attempts at this went
 * wrong.
 */
export type LearnerAccount = AccountFacts & {
  name: string;
  role: string;
  /** When the row was made, to the minute, in the Lab's own clock. */
  createdAt: string;
  minutesWatched: number;
  minutesInClass: number;
  critiquesReceived: number;
  withdrawnTasks: number;
};

export type RecordVerdict =
  /** Two or more accounts; one holds the record, the one in use does not. */
  | "filed-under-another-account"
  /** One account, and it holds a record. Nothing is missing. */
  | "all-present"
  /** One account, made recently, holding nothing. The old row is gone. */
  | "nothing-here"
  /** A record exists but the learner is on no programme, so nothing counts it. */
  | "not-enrolled"
  | "no-such-learner";

export function readRecord(accounts: readonly LearnerAccount[]): {
  verdict: RecordVerdict;
  note: string;
} {
  if (accounts.length === 0) {
    return {
      verdict: "no-such-learner",
      note: "No account in the Lab uses that address. Check the spelling, and check whether they "
        + "signed up with a different one.",
    };
  }

  const carrying = accounts.filter((a) => historyOn(a) > 0);

  if (accounts.length > 1 && carrying.length > 0 && carrying.length < accounts.length) {
    const holder = carrying[0];
    return {
      verdict: "filed-under-another-account",
      note: `Their record is safe. It is on the account made ${holder.createdAt}, which holds `
        + `${holder.minutesInClass} minutes in class, ${holder.minutesWatched} minutes of recordings, `
        + `${holder.tasksFiled} task${holder.tasksFiled === 1 ? "" : "s"} and `
        + `${holder.critiquesWritten} critique${holder.critiquesWritten === 1 ? "" : "s"}. `
        + "The account they are signing in with now is a different row with the same address, and it "
        + "holds nothing. Nothing was deleted — the Lab is asking the wrong account.",
    };
  }

  if (carrying.length === 0) {
    const newest = [...accounts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return {
      verdict: "nothing-here",
      note: `There is no record under that address anywhere in the Lab — not on the account they `
        + `use now (made ${newest.createdAt}) and not on any other. Nothing is filed in the wrong `
        + "place; the rows are not in the live database at all. The only remaining copy would be in "
        + "a backup taken before they went.",
    };
  }

  const holder = carrying[0];
  if (holder.enrolledOnProgrammes === 0) {
    return {
      verdict: "not-enrolled",
      note: `The record is there — ${holder.minutesInClass} minutes in class, `
        + `${holder.minutesWatched} minutes of recordings, ${holder.tasksFiled} task`
        + `${holder.tasksFiled === 1 ? "" : "s"} — but this account is enrolled on no programme, so `
        + "nothing counts it and their dashboard has nothing to show. Enrolling them again puts it "
        + "all back.",
    };
  }

  return {
    verdict: "all-present",
    note: `Everything is where it should be: ${holder.minutesInClass} minutes in class, `
      + `${holder.minutesWatched} minutes of recordings, ${holder.tasksFiled} task`
      + `${holder.tasksFiled === 1 ? "" : "s"} filed and ${holder.critiquesWritten} critique`
      + `${holder.critiquesWritten === 1 ? "" : "s"} written, on an account enrolled on `
      + `${holder.enrolledOnProgrammes} programme${holder.enrolledOnProgrammes === 1 ? "" : "s"}. `
      + "If they cannot see it, the fault is in what they are looking at, not in what is stored.",
  };
}

/* ------------------------------------------------------------------ *
 * Why one learner cannot hand work in
 * ------------------------------------------------------------------ */

/**
 * Every gate between a learner and filing a piece of work, in the order the
 * server actually asks them.
 *
 * Written because guessing did not work. A learner who has done everything and
 * still cannot submit produces the same sentence from the outside whatever is
 * refusing them — a shut module, an unposted task, a closed deadline, a word
 * floor — and from a desk it is not possible to tell which. Three hypotheses
 * were offered before this existed and all three were wrong.
 *
 * So: ask every gate, keep going past the first refusal rather than stopping,
 * and report the lot. A screen that reports only the first problem sends
 * somebody round the loop once per problem.
 */
export type SubmitGate = {
  name:
    | "enrolled"
    | "module-open"
    | "task-published"
    | "deadline"
    | "word-floor"
    | "already-filed";
  /** True when this gate lets them through. */
  open: boolean;
  /** What it says, whichever way it went. */
  note: string;
};

export function submitVerdict(gates: readonly SubmitGate[]): string {
  const shut = gates.filter((g) => !g.open);
  if (shut.length === 0) {
    return "Nothing here is blocking them. Whatever is stopping them is in the browser, "
      + "not in the rules — a stale page, a failed request, or something on their screen.";
  }
  if (shut.length === 1) return `One thing is stopping them: ${shut[0].note}`;
  return `${shut.length} things are stopping them. ${shut.map((g) => g.note).join(" ")}`;
}
