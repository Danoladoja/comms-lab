/**
 * The cohort, seen from above.
 *
 * Everything the Lab could previously answer was about one person at a time: a
 * learner's own dashboard, or an admin opening one module and reading forty-five
 * names. Nobody could answer "how is this cohort doing" without holding several
 * screens in their head, which meant in practice that nobody asked until a
 * learner complained.
 *
 * The one rule this file refuses to break: it invents no new definition of
 * "done". Every cell below is read off a `ProgressEntry` produced by
 * `computeProgress` — the same function, on the same inputs, that produces the
 * learner's own dashboard. If an admin sees a module as complete here, the
 * learner sees it as complete there, necessarily, because it is the same number
 * and not a second one computed to agree. A tracker with its own idea of
 * completion is worse than no tracker: it is a confident second opinion that
 * drifts, and the first sign of the drift is a learner saying the admin is
 * wrong about their own work.
 *
 * ## What "behind" means
 *
 * Behind is measured against the cohort's own deadlines, not against a notional
 * pace: a learner is behind on a module when that module's deadline has passed
 * and the module is not complete for them. Two people are deliberately not
 * caught by that:
 *
 *   - somebody who joined after the module ran. `computeProgress` already marks
 *     those complete (`beforeEnrolled`), because they were never asked for it.
 *   - somebody an admin has given extra time, whose own deadline has not yet
 *     passed. They are late by the cohort's clock and on time by theirs, and
 *     calling that "behind" would have an admin chasing the exception they
 *     themselves granted last week.
 */

import type { ProgressEntry } from "./progress";

/** A module, as the cohort was asked to do it. */
export type CohortModule = {
  sessionId: number;
  title: string;
  startsAt: string | null;
  /**
   * The cohort's deadlines — never an individual's extension. Pace is a
   * property of the cohort; an extension is a property of one learner, and
   * mixing them would move the finishing line every time a favour was done.
   */
  quizDueAt: string | null;
  assignmentDueAt: string | null;
  sortOrder: number;
};

export type CohortLearner = {
  userId: number;
  name: string | null;
  email: string;
  /** Straight from `computeProgress`. Not recomputed, not adjusted. */
  entries: ProgressEntry[];
  /** When they filed each module's written task, by session id. */
  submittedAtBySession?: Map<number, string>;
};

/**
 * Where one learner stands on one module.
 *
 * Six states rather than a percentage, because the question an admin is
 * actually asking has six answers and a number has none of them. "40%" does not
 * say whether the deadline has gone.
 */
export type CellState =
  /** Done. */
  | "complete"
  /** Ran before they joined, so it was never theirs to do. */
  | "waived"
  /** Nothing scheduled and nothing published — the Lab has not set this yet. */
  | "notSet"
  /** The cohort's deadline has gone; this learner has been given longer. */
  | "extended"
  /** The cohort's deadline has gone and the work is not done. */
  | "behind"
  /** Still to come, or no deadline yet. Nothing is wrong. */
  | "open";

/** When this module stops accepting the cohort's work, or null if nothing is dated. */
export function moduleDueAt(module: CohortModule): string | null {
  const times = [module.quizDueAt, module.assignmentDueAt]
    .filter((d): d is string => !!d)
    .map((d) => new Date(d).getTime())
    .filter((ms) => Number.isFinite(ms));
  if (times.length === 0) return null;
  // The later of the two. A module whose quiz shut on Monday and whose task is
  // open until Friday has not finished being due on Wednesday, and calling
  // somebody behind on it would be calling them behind on work they still have
  // time to file.
  return new Date(Math.max(...times)).toISOString();
}

/** Has the cohort's time on this module run out? */
export function moduleIsDue(module: CohortModule, nowMs: number): boolean {
  const due = moduleDueAt(module);
  return due !== null && new Date(due).getTime() < nowMs;
}

/**
 * The deadline this learner is actually held to on this module.
 *
 * Read off the entry rather than recomputed, because the entry's dates have
 * already had any extension applied by the loader — the same dates the doors
 * check and the same dates the learner is shown.
 */
function personalDueAt(entry: ProgressEntry): string | null {
  const times = [entry.quizDueAt, entry.assignmentDueAt]
    .filter((d): d is string => !!d)
    .map((d) => new Date(d).getTime())
    .filter((ms) => Number.isFinite(ms));
  return times.length === 0 ? null : new Date(Math.max(...times)).toISOString();
}

export function cellState(entry: ProgressEntry, module: CohortModule, nowMs: number): CellState {
  if (entry.notSetYet) return "notSet";
  if (entry.beforeEnrolled) return "waived";
  if (entry.completed) return "complete";
  if (!moduleIsDue(module, nowMs)) return "open";

  const mine = personalDueAt(entry);
  // Their own deadline is still ahead of them: an admin moved it on purpose.
  if (mine !== null && new Date(mine).getTime() > nowMs) return "extended";
  return "behind";
}

/**
 * What is actually missing, in the words the Lab uses for it elsewhere.
 *
 * An admin who knows only that somebody is "behind on module two" has to open
 * module two to find out whether to chase a quiz or a recording. Naming the
 * parts is the difference between a list and a to-do list.
 */
export function missingParts(entry: ProgressEntry): string[] {
  const missing: string[] = [];
  if (!entry.presence.met && !entry.notSetYet) missing.push("the class");
  if (entry.hasQuiz && !entry.quizPassed) missing.push("the quiz");
  if (entry.hasAssignment && !entry.assignmentSubmitted) missing.push("the written task");
  if (entry.hasAssignment && entry.assignmentSubmitted && entry.reviewsGiven < entry.reviewsRequired) {
    const left = entry.reviewsRequired - entry.reviewsGiven;
    missing.push(left === 1 ? "one critique" : `${left} critiques`);
  }
  return missing;
}

export type LearnerCell = {
  sessionId: number;
  state: CellState;
  /** The same percentage the learner sees on their own dashboard. */
  progressPct: number;
  missing: string[];
  /** Their own deadline, when it differs from the cohort's. */
  extendedTo: string | null;
};

export type LearnerRow = {
  userId: number;
  name: string | null;
  email: string;
  cells: LearnerCell[];
  /** Modules whose deadline has passed and which are not done. */
  behind: number;
  /** Modules where an admin has bought them time that has not run out. */
  onExtraTime: number;
  /** Modules done, including the ones waived for joining late. */
  complete: number;
  /** How many modules have been asked of them so far. */
  askedSoFar: number;
};

export function learnerRow(
  learner: CohortLearner,
  modules: CohortModule[],
  nowMs: number,
): LearnerRow {
  const byId = new Map(learner.entries.map((e) => [e.sessionId, e]));
  const cells: LearnerCell[] = [];

  for (const module of modules) {
    const entry = byId.get(module.sessionId);
    if (!entry) continue;
    const state = cellState(entry, module, nowMs);
    const cohortDue = moduleDueAt(module);
    const mine = personalDueAt(entry);
    const moved = cohortDue !== null && mine !== null
      && new Date(mine).getTime() > new Date(cohortDue).getTime();
    cells.push({
      sessionId: module.sessionId,
      state,
      progressPct: entry.progressPct,
      missing: state === "complete" || state === "waived" || state === "notSet"
        ? []
        : missingParts(entry),
      extendedTo: moved ? mine : null,
    });
  }

  return {
    userId: learner.userId,
    name: learner.name,
    email: learner.email,
    cells,
    behind: cells.filter((c) => c.state === "behind").length,
    onExtraTime: cells.filter((c) => c.state === "extended").length,
    complete: cells.filter((c) => c.state === "complete" || c.state === "waived").length,
    // "Waived" is not something asked of them, so it does not count here. The
    // denominator is what this person was actually asked for, which is why a
    // learner who joined in week four is not shown as having failed weeks one
    // to three.
    askedSoFar: cells.filter((c) => c.state !== "open" && c.state !== "notSet" && c.state !== "waived").length,
  };
}

/** Everything the cohort did on one module. */
export type ModuleRollup = {
  sessionId: number;
  title: string;
  startsAt: string | null;
  dueAt: string | null;
  due: boolean;
  learners: number;
  complete: number;
  behind: number;
  onExtraTime: number;
  waived: number;
  /** Attendance, by the route that carried each learner over the bar. */
  attended: number;
  viaLive: number;
  viaReplay: number;
  presenceWaived: number;
  notAttended: number;
  hasQuiz: boolean;
  quizPassed: number;
  hasAssignment: boolean;
  submitted: number;
  /** Filed before the cohort's own deadline, after it, or not at all. */
  filedBeforeDeadline: number;
  filedAfterDeadline: number;
  /** Peer critique, which is the quietest of the requirements and the most missed. */
  critiquesAsked: number;
  critiquesGiven: number;
};

function moduleRollup(
  module: CohortModule,
  learners: CohortLearner[],
  rows: LearnerRow[],
  nowMs: number,
): ModuleRollup {
  const cells = rows
    .map((r) => r.cells.find((c) => c.sessionId === module.sessionId))
    .filter((c): c is LearnerCell => !!c);
  const entries = learners
    .map((l) => l.entries.find((e) => e.sessionId === module.sessionId))
    .filter((e): e is ProgressEntry => !!e);

  const taskDue = module.assignmentDueAt ? new Date(module.assignmentDueAt).getTime() : null;
  let filedBefore = 0;
  let filedAfter = 0;
  for (const learner of learners) {
    const filedAt = learner.submittedAtBySession?.get(module.sessionId);
    if (!filedAt) continue;
    const ms = new Date(filedAt).getTime();
    if (!Number.isFinite(ms)) continue;
    // With no deadline on the task, nothing was filed late — there was no line
    // to cross. Counting those as "before" says exactly that.
    if (taskDue === null || ms <= taskDue) filedBefore += 1;
    else filedAfter += 1;
  }

  const count = (p: (e: ProgressEntry) => boolean) => entries.filter(p).length;

  return {
    sessionId: module.sessionId,
    title: module.title,
    startsAt: module.startsAt,
    dueAt: moduleDueAt(module),
    due: moduleIsDue(module, nowMs),
    learners: cells.length,
    complete: cells.filter((c) => c.state === "complete").length,
    behind: cells.filter((c) => c.state === "behind").length,
    onExtraTime: cells.filter((c) => c.state === "extended").length,
    waived: cells.filter((c) => c.state === "waived").length,
    attended: count((e) => e.presence.met),
    viaLive: count((e) => e.presence.met && e.presence.via === "live"),
    viaReplay: count((e) => e.presence.met && e.presence.via === "replay"),
    presenceWaived: count((e) => e.presence.met && e.presence.via === "waived"),
    notAttended: count((e) => !e.presence.met),
    hasQuiz: entries.some((e) => e.hasQuiz),
    quizPassed: count((e) => e.quizPassed),
    hasAssignment: entries.some((e) => e.hasAssignment),
    submitted: count((e) => e.assignmentSubmitted),
    filedBeforeDeadline: filedBefore,
    filedAfterDeadline: filedAfter,
    critiquesAsked: entries.reduce((sum, e) => sum + e.reviewsRequired, 0),
    critiquesGiven: entries.reduce((sum, e) => sum + Math.min(e.reviewsGiven, e.reviewsRequired), 0),
  };
}

export type CohortSnapshot = {
  headline: {
    learners: number;
    /** Nothing overdue. Not the same as finished. */
    onTrack: number;
    behind: number;
    onExtraTime: number;
    /** Modules whose deadline has passed. */
    modulesDue: number;
    modules: number;
    /** Of everything asked of everybody so far, how much is in. */
    completionPct: number;
  };
  modules: ModuleRollup[];
  learners: LearnerRow[];
  /** Behind first, most behind at the top. The list an admin works down. */
  needsAttention: LearnerRow[];
  /**
   * Modules nobody can be behind on because nothing was ever dated.
   *
   * A blind spot rather than good news: the class ran, the work exists, and the
   * tracker will report a clean sheet for it for ever. Said out loud because
   * the alternative is an admin trusting a green column that means nothing.
   */
  undatedModulesThatHaveRun: { sessionId: number; title: string }[];
};

export function cohortSnapshot(args: {
  modules: CohortModule[];
  learners: CohortLearner[];
  nowMs: number;
}): CohortSnapshot {
  const modules = [...args.modules].sort(
    (a, b) => {
      const at = a.startsAt ? new Date(a.startsAt).getTime() : Infinity;
      const bt = b.startsAt ? new Date(b.startsAt).getTime() : Infinity;
      return at - bt || a.sortOrder - b.sortOrder || a.sessionId - b.sessionId;
    },
  );

  const rows = args.learners
    .map((l) => learnerRow(l, modules, args.nowMs))
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));

  const asked = rows.reduce((sum, r) => sum + r.askedSoFar, 0);
  const done = rows.reduce(
    (sum, r) => sum + r.cells.filter((c) => c.state === "complete").length,
    0,
  );

  return {
    headline: {
      learners: rows.length,
      onTrack: rows.filter((r) => r.behind === 0).length,
      behind: rows.filter((r) => r.behind > 0).length,
      onExtraTime: rows.filter((r) => r.onExtraTime > 0).length,
      modulesDue: modules.filter((m) => moduleIsDue(m, args.nowMs)).length,
      modules: modules.length,
      // Nothing asked of anybody yet is 100% done, not 0%. A cohort in its
      // first week owes nothing, and opening the tracker to a red zero on day
      // one would be a lie told in a large font.
      completionPct: asked === 0 ? 100 : Math.round((done / asked) * 100),
    },
    modules: modules.map((m) => moduleRollup(m, args.learners, rows, args.nowMs)),
    learners: rows,
    needsAttention: rows
      .filter((r) => r.behind > 0)
      .sort((a, b) =>
        b.behind - a.behind
        // Two people one module behind are not in equal trouble. Somebody
        // missing the class, the quiz and the task needs a different message
        // from somebody who only has a quiz left, and ordering them by name
        // would put that entirely by chance.
        || piecesOutstanding(b) - piecesOutstanding(a)
        || (a.name ?? a.email).localeCompare(b.name ?? b.email)),
    undatedModulesThatHaveRun: modules
      .filter((m) => {
        if (moduleDueAt(m) !== null) return false;
        const start = m.startsAt ? new Date(m.startsAt).getTime() : null;
        return start !== null && start < args.nowMs;
      })
      .map((m) => ({ sessionId: m.sessionId, title: m.title })),
  };
}

/** How many separate things a learner is overdue on, across every late module. */
function piecesOutstanding(row: LearnerRow): number {
  return row.cells
    .filter((c) => c.state === "behind")
    .reduce((sum, c) => sum + c.missing.length, 0);
}

/**
 * One learner's position, said in a sentence.
 *
 * The needs-attention list is read at speed by somebody about to send an email,
 * so it has to name the modules and the missing pieces, not a count.
 */
export function whyBehind(row: LearnerRow, modules: CohortModule[]): string {
  const titleOf = new Map(modules.map((m) => [m.sessionId, m.title]));
  const late = row.cells.filter((c) => c.state === "behind");
  if (late.length === 0) return "Nothing overdue.";

  const parts = late.map((c) => {
    const title = titleOf.get(c.sessionId) ?? "a module";
    return c.missing.length > 0 ? `${title} (${c.missing.join(", ")})` : title;
  });
  return parts.join("; ");
}

/**
 * How the cohort is doing, in one line, for the top of the page.
 *
 * Deliberately not a score. "68%" invites an admin to watch a number go up;
 * naming how many people are overdue and on what invites them to do something.
 */
export function cohortHeadline(snapshot: CohortSnapshot): string {
  const { learners, behind, onExtraTime, modulesDue, modules } = snapshot.headline;
  if (learners === 0) return "Nobody is enrolled on this programme yet.";
  if (modulesDue === 0) return `${learners} learners, and nothing is due yet.`;

  const who = behind === 0
    ? "everybody is up to date"
    : behind === 1 ? "1 learner is behind" : `${behind} learners are behind`;
  const extra = onExtraTime > 0
    ? `, ${onExtraTime} on extra time`
    : "";
  return `${modulesDue} of ${modules} modules are due, and ${who}${extra}.`;
}
