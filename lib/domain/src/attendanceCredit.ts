/**
 * Attendance credited by a human, because the app could not measure it.
 *
 * The Lab has needed this since the weeks when modules one and two ran with
 * Google Workspace unconnected and the classroom heartbeat not reporting. Those
 * classes happened. People sat through them. The app recorded nothing, and a
 * module cannot be completed without attendance — so those learners were left
 * short of a requirement by a failure that was entirely ours.
 *
 * Until now the only remedy was a script run from a database shell, which meant
 * the people who actually know who was in the room could not use it.
 *
 * ## Why this is a waiver and not a number
 *
 * The obvious implementation is to write in some minutes — enough to clear the
 * bar — and let every existing rule read them. It is also a lie that cannot be
 * undone: six months from now nobody can tell an observed forty-five minutes
 * from an invented one, and the first learner to dispute their record is owed
 * an answer the database can no longer give.
 *
 * So crediting sets a flag that says "this could not be measured, and a named
 * person judged that they were there", and the reason travels with it. Every
 * rule already understands that flag. The register keeps saying what was
 * actually observed, which is nothing, and separately says who decided what.
 *
 * ## What crediting is NOT
 *
 * It is not a way past the coursework. Attendance is one of three requirements;
 * crediting it opens nothing on its own. It is also not a way to move somebody
 * up the programme — they still have to finish the module.
 */

/** The class has to have happened before anybody can have attended it. */
export function creditProblem(facts: {
  /** When the class started, or null if it has never been scheduled. */
  startsAtMs: number | null;
  durationMins: number;
  nowMs: number;
  reason: string;
  /** How many people the admin has picked. */
  count: number;
}): string | null {
  if (facts.count <= 0) return "Choose who you are crediting first.";

  // A reason is not paperwork. It is the only thing that will explain this row
  // to whoever reads it next year, and the only defence if a learner disputes
  // it. Refusing an empty one costs five seconds now and answers a question
  // that would otherwise have no answer at all.
  if (facts.reason.trim().length < MIN_REASON_CHARS) {
    return `Say why in a few words — it goes on the record beside each name, `
      + `and it is what explains this to anyone who reads it later.`;
  }

  if (facts.startsAtMs === null) {
    return "This class has no date yet, so nobody can have attended it.";
  }

  const ended = facts.startsAtMs + facts.durationMins * 60_000;
  if (ended > facts.nowMs) {
    return "This class has not finished yet. Attendance can only be credited after it has run.";
  }

  return null;
}

/**
 * How short a reason may be.
 *
 * Low enough that "Zoom failed" or "was in the room" passes, high enough that a
 * single keystroke or a full stop does not.
 */
export const MIN_REASON_CHARS = 4;

/**
 * The reason offered by default for the weeks the app was not measuring.
 *
 * Filled in rather than imposed, because an admin who has a more specific
 * reason should say it. It exists so the commonest case — a whole class the app
 * never saw — does not stall behind a blank box.
 */
export const SUGGESTED_REASON =
  "The Lab was not recording attendance for this class, so it could not be measured.";

/**
 * What actually gets written beside the name.
 *
 * The admin's reason, plus who decided it and when. Those two facts belong on
 * the record and there is nowhere else on the row to keep them — adding a
 * column would mean a database change, and a database change that has not been
 * applied stops the whole app from starting. This is the honest version that
 * costs nobody an outage: it is one column, it is readable by a person, and it
 * cannot silently disagree with anything.
 */
export function creditRecord(facts: {
  reason: string;
  byName: string;
  whenIso: string;
}): string {
  const who = facts.byName.trim() || "an admin";
  const when = new Date(facts.whenIso);
  const date = Number.isFinite(when.getTime())
    ? new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
    }).format(when)
    : facts.whenIso;
  return `${facts.reason.trim()} — credited by ${who} on ${date}.`;
}

/** Whether crediting this person would change anything. */
export type CreditStanding =
  /** They have not reached the bar by any route. Crediting them is the point. */
  | "needed"
  /** Already credited by hand. Crediting again would do nothing. */
  | "already-credited"
  /** They got there on their own — in the room, or on the replay. */
  | "attended";

export function creditStanding(facts: {
  presenceMet: boolean;
  alreadyWaived: boolean;
}): CreditStanding {
  if (facts.alreadyWaived) return "already-credited";
  if (facts.presenceMet) return "attended";
  return "needed";
}

/**
 * What crediting a group did, in a sentence.
 *
 * Says what was skipped as well as what was done, because "credited 31" when 45
 * were selected is a number an admin will otherwise have to work out by
 * subtraction, and the difference is the people who did not need it.
 */
export function creditNote(facts: {
  credited: number;
  alreadyAttended: number;
  alreadyCredited: number;
  moduleTitle: string;
}): string {
  if (facts.credited === 0) {
    const why = facts.alreadyAttended > 0 || facts.alreadyCredited > 0
      ? " Everybody chosen had already attended or been credited."
      : "";
    return `Nothing to credit on ${facts.moduleTitle}.${why}`;
  }

  const one = facts.credited === 1;
  const who = one ? "1 learner now counts" : `${facts.credited} learners now count`;
  const skipped: string[] = [];
  if (facts.alreadyAttended > 0) skipped.push(`${facts.alreadyAttended} had already attended`);
  if (facts.alreadyCredited > 0) skipped.push(`${facts.alreadyCredited} were already credited`);
  const tail = skipped.length > 0 ? ` ${skipped.join(", and ")} — those were left alone.` : "";

  return `${who} as having attended ${facts.moduleTitle}.${tail}`;
}

/**
 * What taking a credit back will cost, said before it happens.
 *
 * Taking back attendance can un-complete a module, and an un-completed module
 * re-locks everything behind it. Nothing is deleted — their quiz score and
 * their written work are untouched — but somebody who was moving through the
 * programme this morning can be shut out of it this afternoon, and an admin
 * should be told that in words before they press the button rather than
 * discover it from the learner.
 */
export function takeBackWarning(facts: {
  learnerName: string;
  moduleTitle: string;
  /** Whether this credit is the only thing carrying their attendance. */
  hasOwnMeasurement: boolean;
}): string {
  const who = facts.learnerName.trim() || "This learner";
  if (facts.hasOwnMeasurement) {
    return `${who} also has attendance the app measured for ${facts.moduleTitle}, `
      + "so removing the credit leaves that standing.";
  }
  return `${who} has no measured attendance for ${facts.moduleTitle}, so removing the credit `
    + "will leave the module unfinished for them, and any module waiting on it will shut again. "
    + "Nothing they have submitted is deleted.";
}

/** Why a credit cannot be taken back, if it cannot. */
export function takeBackProblem(facts: { count: number }): string | null {
  if (facts.count <= 0) return "Choose who you are taking it back from first.";
  return null;
}

/**
 * Why extra time will not reach this learner.
 *
 * The failure this exists for: an admin grants extra time on module three to
 * somebody locked out of it by module two, the grant succeeds, the learner
 * still cannot open the quiz, and everybody concludes extensions are broken.
 * They are not — a lock is checked before any deadline is, and that is correct,
 * because a deadline decides when work is accepted and a lock decides whether
 * the module is theirs to open yet.
 *
 * Saying so is the whole fix. The remedy is almost always finishing, or
 * crediting, the module named in the reason.
 */
export function extraTimeBlocked(facts: {
  locked: boolean;
  lockedReason: string | null;
}): string | null {
  if (!facts.locked) return null;
  const because = (facts.lockedReason ?? "").trim();
  return because
    ? `Extra time will not reach them yet — this module is still shut for them. ${because}.`
    : "Extra time will not reach them yet — this module is still shut for them by an earlier one.";
}
