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

/* ------------------------------------------------------------------ *
 * Clearing a module, which is a different act from opening one
 * ------------------------------------------------------------------ */

/**
 * Opening and clearing, and why both exist.
 *
 * Opening a module is the right remedy when somebody is stuck behind work they
 * genuinely still owe and there is a reason to let them get on with this week
 * anyway. It moves them past nothing.
 *
 * It is the wrong remedy — and this took a learner and an argument to see —
 * when the work was actually done and the Lab is why the record does not say
 * so. There, an open door quietly defers the problem to the worst possible
 * moment. A certificate requires every module complete, so somebody carried
 * through five modules on open doors reaches the end of the programme, asks for
 * the certificate they have earned, and is refused by a rule nobody mentioned
 * on the way. Stuck at the finish is worse than stuck in the middle, because by
 * then everyone has stopped watching.
 *
 * So clearing counts the module as done: the module after it opens by the
 * ordinary rule, and the certificate follows. What keeps it honest is not
 * withholding the credit but recording the act — who, when, why, and precisely
 * which requirements were set aside — and showing that wherever staff look at
 * the learner's record.
 *
 * It is deliberately not written into the learner's work. Clearing does not
 * invent a submission, does not fill in a quiz score and does not forge
 * critiques; the coursework tables are left exactly as they were. Anybody
 * reading the audit afterwards can still see that no task was filed, beside a
 * note saying the Lab judged it met and why. A remedy that rewrote the evidence
 * would be indistinguishable from the fault it was fixing.
 */

/** The requirements a module can ask for, as stored. */
export type RequirementKey = "presence" | "assignment" | "reviews" | "quiz" | "simulation";

/** What this learner still owes on this module, as stable keys. */
export function outstandingKeys(entry: {
  kind?: string;
  presence: { met: boolean };
  notSetYet?: boolean;
  hasAssignment: boolean;
  assignmentSubmitted: boolean;
  reviewsGiven: number;
  reviewsRequired: number;
  hasQuiz: boolean;
  quizPassed: boolean;
  hasSimulation: boolean;
  simulationDone: boolean;
}): RequirementKey[] {
  const out: RequirementKey[] = [];
  // A simulation module never asked for a class, so it is never short of one.
  if (entry.kind !== "simulation" && !entry.presence.met && !entry.notSetYet) out.push("presence");
  if (entry.hasAssignment && !entry.assignmentSubmitted) out.push("assignment");
  if (entry.hasAssignment && entry.reviewsGiven < entry.reviewsRequired) out.push("reviews");
  if (entry.hasQuiz && !entry.quizPassed) out.push("quiz");
  if (entry.hasSimulation && !entry.simulationDone) out.push("simulation");
  return out;
}

/**
 * The same list in the words the Lab uses everywhere else.
 *
 * Separate from the keys because an admin about to set a requirement aside has
 * to be able to read what it is, and because rewording this later must not
 * rewrite what is already stored against somebody's name.
 */
export function describeRequirements(keys: readonly string[]): string[] {
  const words: Record<string, string> = {
    presence: "the class",
    assignment: "the written task",
    reviews: "the critiques",
    quiz: "the quiz",
    simulation: "the Studio exercise",
  };
  return keys.map((k) => words[k] ?? k);
}

/** One line naming everything that would be set aside. */
export function clearingList(keys: readonly string[]): string {
  const words = describeRequirements(keys);
  if (words.length === 0) return "nothing — they have met every requirement on it";
  if (words.length === 1) return words[0];
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export type ClearRequest = {
  userIds: readonly number[];
  reason: string;
  /** Whether each of them has this module outstanding at all. */
  outstanding: ReadonlyMap<number, readonly string[]>;
  /** Whether this module is already cleared for them. */
  alreadyCleared: ReadonlySet<number>;
};

/** Why this cannot be done, or null when it can. */
export function clearProblem(req: ClearRequest): string | null {
  if (req.userIds.length === 0) {
    return "Nobody is selected. Tick the learners this should count as done for.";
  }
  const reason = req.reason.trim();
  if (reason.length < MIN_UNLOCK_REASON) {
    return "Say why you are counting this module as done. It goes on the record beside their "
      + "name, and it is the only thing that will explain a cleared module to whoever reads it "
      + "later.";
  }
  if (reason.length > MAX_UNLOCK_REASON) {
    return `That reason is ${reason.length} characters. Keep it under ${MAX_UNLOCK_REASON}.`;
  }
  const wouldChange = req.userIds.filter(
    (id) => !req.alreadyCleared.has(id) && (req.outstanding.get(id)?.length ?? 0) > 0,
  );
  if (wouldChange.length === 0) {
    const done = req.userIds.filter((id) => req.alreadyCleared.has(id)).length;
    return done > 0
      ? "This module is already counted as done for everybody you have chosen."
      : "Nobody you have chosen has anything outstanding on this module — they have finished it "
        + "on their own work, and nothing needs setting aside.";
  }
  return null;
}

/**
 * What an admin is told before they press it.
 *
 * Names the requirements rather than the count, because "clear the module for 3
 * learners" hides the thing that actually matters — that one of them has not
 * taken the quiz. An admin who can see that will sometimes stop.
 */
export function clearWarning(args: {
  count: number;
  moduleTitle: string;
  keys: readonly string[];
}): string {
  const who = args.count === 1 ? "1 learner" : `${args.count} learners`;
  return `Count ${args.moduleTitle} as done for ${who}?\n\n`
    + `This sets aside: ${clearingList(args.keys)}.\n\n`
    + "The module counts as complete, the next one opens, and it counts towards their "
    + "certificate. Their work is not altered — nothing is filed, marked or scored on their "
    + "behalf — and the record will show that staff cleared it, and why.";
}

/** What to say afterwards. */
export function clearedNote(args: {
  cleared: number;
  skipped: number;
  moduleTitle: string;
}): string {
  const done = args.cleared === 1
    ? `${args.moduleTitle} now counts as done for 1 learner.`
    : `${args.moduleTitle} now counts as done for ${args.cleared} learners.`;
  const next = " The module after it opens by the ordinary rule, and it counts towards their "
    + "certificate.";
  if (args.skipped === 0) return done + next;
  const skipped = args.skipped === 1
    ? " 1 needed nothing and was left alone."
    : ` ${args.skipped} needed nothing and were left alone.`;
  return done + next + skipped;
}

/**
 * How a learner is told a module was counted as done for them.
 *
 * Says it plainly rather than letting a module quietly turn green. Somebody who
 * knows the Lab lost their work should be able to see that the Lab put it
 * right; and somebody who does not know why their module completed deserves an
 * explanation more than a pleasant surprise.
 */
export function clearedForYouNote(moduleTitle: string): string {
  return `${moduleTitle} has been counted as complete by the Lab. If something you did was not `
    + "recorded properly, this is us putting that right — you do not need to do it again.";
}
