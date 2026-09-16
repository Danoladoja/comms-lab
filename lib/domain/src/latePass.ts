/**
 * Late passes: a fixed number of second chances, spent by the learner.
 *
 * The Lab's written work is not marked. A task is done or it is not — the code
 * that works out progress scores it `submitted ? 100 : 0` — so there is no
 * number a late penalty could reduce. Deducting from the peer critique score
 * instead would ruin the one figure that is supposed to be about craft: a
 * learner reading 62% would not know whether that was their writing or their
 * timing.
 *
 * The deadline already carries a real consequence, and a heavier one than a
 * penalty: miss it and the following week stays shut. There is a second cost
 * nobody designed and everybody feels — a piece filed after the cohort has
 * finished the critiques they owed tends to receive none at all.
 *
 * So what was missing was never a punishment. It was a way for somebody with a
 * dead grid, a sick child or a delayed flight to stay in the programme without
 * having to ask a facilitator for a favour — because asking favours rewards the
 * confident and quietly loses the people who most need the room.
 *
 * Hence: a small, countable allowance, spent by the learner, visible to both
 * sides. Scarce enough that the deadline still means something, and honest
 * enough that using one is a decision rather than an accident.
 *
 * ---
 *
 * A pass covers a whole module — both its quiz and its written task.
 *
 * It was built for written work alone, on the reasoning that a quiz is
 * auto-marked with unlimited retakes and so has nothing to rescue. That
 * reasoning was wrong, and wrong in the way that matters: a closed quiz does not
 * merely cost a score, it leaves the module incomplete and the following week
 * shut. The learner with the dead grid loses the week either way.
 *
 * So the unit is the module, not the piece — which is also the unit the Lab
 * already thinks in, since everything from a week is due at the end of the same
 * Monday. One pass, one module, both doors. That is worth saying plainly,
 * because the alternative — a pass per piece — would have quietly halved an
 * allowance nobody would have noticed shrinking until they needed it.
 */

/** Passes a learner gets for a whole programme. Not per week, and not per module. */
export const LATE_PASSES_PER_PROGRAMME = 2;

/** The two things a module can ask of a learner, each with its own deadline. */
export type LatePassPiece = "quiz" | "assignment";

/**
 * How much time one buys.
 *
 * Forty-eight hours, because the teaching week runs Tuesday and Thursday with
 * everything due at the end of Monday. Two days puts the late piece in before
 * Thursday's class, so nobody sits through the second class of the week not
 * having done the work. Seventy-two would land after it; a full week would land
 * while the cohort is critiquing the next task, which is how a piece ends up
 * with no critiques at all.
 */
export const LATE_PASS_HOURS = 48;

/** When the extended door shuts, or null when there was no deadline to extend. */
export function latePassWindowEnd(dueAt: string | null | undefined): string | null {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + LATE_PASS_HOURS * 60 * 60 * 1000).toISOString();
}

/** Is `now` inside the extra time a pass buys — after the deadline, before the extension runs out? */
export function withinLatePassWindow(
  dueAt: string | null | undefined,
  now: number,
): boolean {
  const end = latePassWindowEnd(dueAt);
  if (!end) return false;
  const dueMs = new Date(dueAt as string).getTime();
  const endMs = new Date(end).getTime();
  return now > dueMs && now <= endMs;
}

export type LatePassState =
  /** No deadline on this task, so there is nothing to be late for. */
  | "no-deadline"
  /** Still open the ordinary way. A pass is neither needed nor offered. */
  | "not-needed"
  /** A pass is already spent here; the learner is inside their extra time. */
  | "in-use"
  /** Late, a pass would reopen it, and they have one to spend. */
  | "available"
  /** Late, a pass would reopen it, and they have none left. */
  | "none-left"
  /** Even the extra time has run out, whether or not they spent a pass. */
  | "too-late";

export type LatePassFacts = {
  dueAt: string | null | undefined;
  now: number;
  /** Passes this learner has already spent anywhere on this programme. */
  used: number;
  /**
   * Has a pass already been spent on this module?
   *
   * On the module, not on the piece. A pass spent to reopen the written task
   * reopens the quiz as well, and the other way round — so this is true for
   * both pieces once it is true for either.
   */
  claimedHere: boolean;
};

export function latePassState(f: LatePassFacts): LatePassState {
  const dueMs = f.dueAt ? new Date(f.dueAt).getTime() : NaN;
  // An unreadable date is treated as no deadline, the same way the rest of the
  // app treats it: a corrupt value must never become a wall a cohort cannot pass.
  if (!Number.isFinite(dueMs)) return "no-deadline";
  if (f.now <= dueMs) return "not-needed";
  if (withinLatePassWindow(f.dueAt, f.now)) {
    if (f.claimedHere) return "in-use";
    return f.used >= LATE_PASSES_PER_PROGRAMME ? "none-left" : "available";
  }
  return "too-late";
}

/** Passes left to spend. Never negative, however the counting went. */
export function passesLeft(used: number): number {
  return Math.max(0, LATE_PASSES_PER_PROGRAMME - used);
}

/** May this learner spend a pass on this task right now? */
export function canClaimLatePass(f: LatePassFacts): boolean {
  return latePassState(f) === "available";
}

/**
 * May a pass be spent on this module, given the state of every piece in it?
 *
 * One deadline having gone is enough. A module whose quiz shut last night and
 * whose written task is not due until Friday is a module a pass can open — and
 * once spent it covers both, because the pass belongs to the module.
 *
 * Asked of the pieces together rather than one at a time so that the browser
 * never has to decide which deadline the learner is really asking about. It
 * would get that wrong at exactly the moment it mattered.
 */
export function canClaimForModule(pieces: LatePassFacts[]): boolean {
  return pieces.some(canClaimLatePass);
}

/**
 * What a pass opens here, for the purpose of describing it.
 *
 * Worked out from which pieces actually have a deadline: one that has none is
 * open regardless and there is nothing to say about it.
 */
export function latePassCovers(
  quizDueAt: string | null | undefined,
  assignmentDueAt: string | null | undefined,
  asking: LatePassPiece,
): LatePassPiece | "both" {
  if (quizDueAt && assignmentDueAt) return "both";
  if (quizDueAt) return "quiz";
  if (assignmentDueAt) return "assignment";
  return asking;
}

/**
 * Why a submission is being refused, or null when it should go through.
 *
 * The server asks this, not the browser. A learner whose laptop clock is a day
 * slow must not get an extra day, and one whose clock is fast must not lose one.
 */
export function lateSubmissionProblem(
  f: LatePassFacts,
  piece: LatePassPiece = "assignment",
): string | null {
  // Named, because "this task" in front of a quiz reads like a mistake and
  // makes a learner wonder whether the app has confused their two deadlines.
  const it = piece === "quiz" ? "this quiz" : "this task";
  switch (latePassState(f)) {
    case "no-deadline":
    case "not-needed":
    case "in-use":
      return null;
    case "available":
      return `The deadline has passed. Use one of your late passes to reopen ${it}.`;
    case "none-left":
      return "The deadline has passed and you have used both of your late passes. Talk to the team.";
    case "too-late":
      return "The deadline has passed, and the extra time a late pass buys has run out too. Talk to the team.";
  }
}

/**
 * What the learner reads before spending one.
 *
 * It says the cost out loud — how many are left afterwards, and that critiques
 * may not come — because a scarce thing spent without seeing the price is a
 * thing people feel cheated by later.
 *
 * It also says what it buys, which on a module with both a quiz and a written
 * task is both of them. A learner who spent one on the quiz and then found the
 * writing still shut would have every reason to think they had been robbed.
 */
export function latePassOffer(
  used: number,
  covers: LatePassPiece | "both" = "assignment",
): string {
  const left = passesLeft(used) - 1;
  const after = left === 1 ? "one left" : left === 0 ? "none left" : `${left} left`;
  const what = covers === "both"
    ? "on both the quiz and the written task for this module"
    : covers === "quiz"
      ? "on this quiz"
      : "on this task";
  // The warning about critiques is only true where there is writing to critique.
  const feedback = covers === "quiz"
    ? ""
    : ", and your piece may arrive after your cohort has finished critiquing — so it may get less feedback than usual";
  return `Using a late pass gives you ${LATE_PASS_HOURS} more hours ${what}. You will have ${after} for the rest of the programme${feedback}.`;
}

/** The plain count, for a learner who has not needed one yet. */
export function latePassBalance(used: number): string {
  const left = passesLeft(used);
  if (left === 0) return "No late passes left.";
  if (left === 1) return "1 late pass left.";
  return `${left} late passes left.`;
}
