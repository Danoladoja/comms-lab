/**
 * Opening a locked module for one learner, by hand.
 *
 * The lock is a good rule. It asks somebody to finish last week before
 * starting this one, and for almost everybody it is right. What it cannot see
 * is when the Lab itself is the reason they are stuck — a recording that never
 * arrived so attendance went unmeasured, a submission lost to a page that
 * dropped the request, a live class this app would not let them into. The rule
 * then runs correctly over a record that is wrong, and tells somebody to finish
 * work they have already done.
 *
 * Before this there was no move available at all. Extra time does not help,
 * because a lock is checked before any deadline. Crediting attendance does not
 * help either, unless the missing measurement happens to be the only thing
 * outstanding. So the honest answer to a stranded learner was that a patch was
 * needed, and they could wait.
 *
 * What is deliberately NOT here is anything that marks work. Opening a module
 * opens a door. It does not complete the module, does not fill in the quiz,
 * does not file the task, and does not move anybody closer to a certificate.
 * The learner still owes exactly what they owed. Keeping those two ideas apart
 * is the whole design: an override that quietly completed things would be a way
 * to award a qualification by accident, and nobody would be able to tell
 * afterwards which module was earned and which was waved through.
 */

/** Long enough to say what happened, short enough to stay on one line. */
export const MAX_UNLOCK_REASON = 300;

/**
 * A reason is required, and this is not paperwork for its own sake.
 *
 * An override is the Lab setting aside its own rules for one person. Six months
 * later somebody will ask why this learner's Module 5 was open when their work
 * says it should not have been, and "no reason recorded" is an answer that
 * makes the Lab look arbitrary to the one person it was trying to help. It also
 * keeps the act deliberate: having to say why is a moment's thought before
 * setting a rule aside.
 */
export const MIN_UNLOCK_REASON = 4;

export type UnlockRequest = {
  /** Who is being let through. */
  userIds: readonly number[];
  reason: string;
  /** Whether each of them is actually shut out of this module right now. */
  lockedNow: ReadonlyMap<number, boolean>;
  /** Whether this module is already open to them by a previous override. */
  alreadyOpen: ReadonlySet<number>;
};

/** Why this cannot be done, in the Lab's own words, or null when it can. */
export function unlockProblem(req: UnlockRequest): string | null {
  if (req.userIds.length === 0) {
    return "Nobody is selected. Tick the learners this should open for.";
  }
  const reason = req.reason.trim();
  if (reason.length < MIN_UNLOCK_REASON) {
    return "Say why you are opening this module. It goes on the record beside their name, "
      + "and it is what explains this to anybody who reads it later.";
  }
  if (reason.length > MAX_UNLOCK_REASON) {
    return `That reason is ${reason.length} characters. Keep it under ${MAX_UNLOCK_REASON}.`;
  }

  // Everybody chosen is already through. Refused rather than performed, because
  // a button that reports success and changes nothing teaches an admin to
  // distrust the screen.
  const wouldChange = req.userIds.filter(
    (id) => !req.alreadyOpen.has(id) && (req.lockedNow.get(id) ?? false),
  );
  if (wouldChange.length === 0) {
    const openAlready = req.userIds.filter((id) => req.alreadyOpen.has(id)).length;
    return openAlready > 0
      ? "This module is already open to everybody you have chosen."
      : "Nobody you have chosen is locked out of this module — it is already open to them.";
  }
  return null;
}

/**
 * What an admin is told before they press it.
 *
 * Names the number and says plainly what it does not do, because "unlock" reads
 * like "mark as done" to anybody who has not read the rules — and an admin who
 * believes they have completed somebody's module will stop chasing the work
 * that is still outstanding.
 */
export function unlockWarning(args: {
  count: number;
  moduleTitle: string;
}): string {
  const who = args.count === 1 ? "1 learner" : `${args.count} learners`;
  return `Open ${args.moduleTitle} for ${who}?\n\n`
    + "This opens the module so they can get at the class, the quiz and the task. It does "
    + "not complete anything: whatever they still owe on the module before this one, they "
    + "still owe, and it does not count towards a certificate.";
}

/** What to say afterwards. */
export function unlockNote(args: {
  opened: number;
  skipped: number;
  moduleTitle: string;
}): string {
  const opened = args.opened === 1
    ? `${args.moduleTitle} is open for 1 learner.`
    : `${args.moduleTitle} is open for ${args.opened} learners.`;
  if (args.skipped === 0) return `${opened} Nothing else about their record has changed.`;
  const skipped = args.skipped === 1
    ? "1 was already through and was left alone."
    : `${args.skipped} were already through and were left alone.`;
  return `${opened} ${skipped}`;
}

/** What to say when an override is taken back. */
export function relockNote(args: { moduleTitle: string; nowLocked: boolean }): string {
  return args.nowLocked
    ? `${args.moduleTitle} is shut for them again, by the same rule as everybody else.`
    : `That override is removed. ${args.moduleTitle} is still open to them, because their `
      + "own work now opens it.";
}

/**
 * How a learner is told, on their own dashboard.
 *
 * They were stuck and now they are not, and saying nothing would leave somebody
 * wondering whether the app is reliable. It names the module as open and says
 * what is still outstanding, so nobody reads an open door as a finished module.
 */
export function openedForYouNote(moduleTitle: string): string {
  return `${moduleTitle} has been opened for you by the Lab. Anything still outstanding on `
    + "the module before it is still yours to finish.";
}
