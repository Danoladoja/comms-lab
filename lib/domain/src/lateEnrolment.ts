/**
 * Putting somebody onto a cohort that is already running.
 *
 * Every other way into a programme assumes the person arrives at the start: a
 * learner enrols themselves while the door is open, or an invitation is sent to
 * an address with no account behind it yet. Somebody who signed up, never
 * finished onboarding, and now has an account on no programme falls through
 * both. The admin console even points at the invitation tool, which refuses
 * anybody who already has an account — a signpost to a locked door.
 *
 * The only real decision in letting them in is *when they count from*, and it
 * is not a small one. `progress` treats a module that ended before somebody's
 * first day as complete for them, and waives it as a prerequisite — otherwise a
 * learner let in during week four could do everything asked of them and still
 * never be certificated, because week one's deadline shut before they arrived.
 *
 * So:
 *   from today        — the modules that already ran are written off, and they
 *                       begin at the current week.
 *   from cohort start — they are held to the whole programme, exactly like
 *                       everybody else. Which is the right answer when they
 *                       registered alongside the cohort and simply never
 *                       onboarded — but it can also hand somebody a module they
 *                       cannot complete, because its deadline has already gone.
 *
 * That last case is the one worth saying out loud at the moment of the
 * decision, which is what `lateEnrolmentNote` is for.
 */

/** Where a late arrival is measured from. */
export type CountsFrom = "cohort-start" | "today";

/**
 * When this cohort actually began.
 *
 * `programs.startDate` cannot answer this — it is a display string like
 * "Nov 2026", written for a page rather than for arithmetic. The first class is
 * the real beginning, and where a programme has no dated classes yet, the
 * oldest enrolment is when the cohort was formed. Falling back to `now` last
 * means the worst case is treating them as new, which is the forgiving
 * direction: it waives modules rather than handing out ones nobody can finish.
 */
export function cohortStart(
  firstClassAt: Date | null,
  earliestEnrolmentAt: Date | null,
  now: Date,
): Date {
  if (firstClassAt) return firstClassAt;
  if (earliestEnrolmentAt) return earliestEnrolmentAt;
  return now;
}

/**
 * The date to write on the enrolment.
 *
 * A moment before the first class, not the moment of it: `progress` compares a
 * module's *end* against this, and a start exactly equal to the first class
 * would still count that class as having ended before they joined on any
 * timing quirk. A minute of margin removes the question.
 */
export function startDateFor(choice: CountsFrom, startOfCohort: Date, now: Date): Date {
  if (choice === "today") return now;
  return new Date(startOfCohort.getTime() - 60_000);
}

/** One module, as far as this decision is concerned. */
export type ModuleTiming = {
  startsAtMs: number | null;
  durationMins: number;
  /** Deadlines on this module. Empty entries mean no deadline at all. */
  dueAtMs: (number | null)[];
};

/**
 * What this person has already missed, counted against *now*.
 *
 * Anchoring this to the date being written on the enrolment was wrong, and
 * wrong in the direction that silences the warning. Somebody held to the whole
 * programme gets a start date before the first class, so nothing has "already
 * run" relative to it — the count came back zero, the deadline warning never
 * fired, and the one case it was built for was the one case it stayed quiet
 * for. What the admin is asking is how much of the programme has gone by in
 * real time, which is a question about today, not about the date being written.
 */
export function modulesMissed(
  modules: ModuleTiming[],
  now: Date,
): { alreadyRun: number; deadlinesPassed: number } {
  const nowMs = now.getTime();
  let alreadyRun = 0;
  let deadlinesPassed = 0;

  for (const m of modules) {
    // A module with no date has not run: it cannot have been missed.
    if (m.startsAtMs === null) continue;
    if (m.startsAtMs + m.durationMins * 60_000 >= nowMs) continue;
    alreadyRun += 1;
    if (m.dueAtMs.some((d) => d !== null && d < nowMs)) deadlinesPassed += 1;
  }
  return { alreadyRun, deadlinesPassed };
}

/** What the admin is about to do to this person, in a sentence. */
export function lateEnrolmentNote(facts: {
  name: string;
  choice: CountsFrom;
  /** Modules whose class has already finished. */
  modulesAlreadyRun: number;
  /** Of those, how many have a quiz or assignment deadline already gone. */
  deadlinesPassed: number;
}): string {
  const who = facts.name.trim() || "They";

  if (facts.choice === "today") {
    if (facts.modulesAlreadyRun === 0) return `${who} starts with the rest of the cohort.`;
    return `${who} starts from today. The ${facts.modulesAlreadyRun} module${
      facts.modulesAlreadyRun === 1 ? "" : "s"
    } that already ran ${facts.modulesAlreadyRun === 1 ? "is" : "are"} counted as done and will not hold them back.`;
  }

  if (facts.modulesAlreadyRun === 0) return `${who} starts with the rest of the cohort.`;

  const base = `${who} is held to the whole programme, so ${
    facts.modulesAlreadyRun === 1 ? "the module" : `all ${facts.modulesAlreadyRun} modules`
  } that already ran still ${facts.modulesAlreadyRun === 1 ? "has" : "have"} to be completed.`;

  // The trap. Said plainly, because it is invisible from the admin console and
  // only shows up as a learner emailing to say they are stuck.
  if (facts.deadlinesPassed > 0) {
    return `${base} ${facts.deadlinesPassed} deadline${
      facts.deadlinesPassed === 1 ? " has" : "s have"
    } already passed, so they cannot submit that work as things stand — extend the deadline, or add them from today instead.`;
  }

  return `${base} Nothing is closed to them yet.`;
}

/**
 * Why this person cannot be added, if they cannot.
 *
 * Separate from the note above: this is a refusal, and a refusal has to name
 * the thing to do instead rather than simply saying no.
 */
export function lateEnrolmentProblem(facts: {
  accountExists: boolean;
  email: string;
  existingStatus: "enrolled" | "waitlisted" | "cancelled" | "completed" | null;
}): string | null {
  if (!facts.accountExists) {
    return `There is no account here for ${facts.email}. If they have never signed in, invite them instead — `
      + "the invitation tool is below, and it creates the account for them.";
  }
  if (facts.existingStatus === "completed") {
    return "They have already completed this programme. Adding them again would overwrite that record.";
  }
  return null;
}
