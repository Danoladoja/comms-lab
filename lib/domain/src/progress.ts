import { ON_TIME_GRACE_MS } from "./liveWindow";
import { whyWeekLocked } from "./teachingWeek";
import {
  presenceStatus,
  EMPTY_PRESENCE,
  PRESENCE_THRESHOLD_PCT,
  type PresenceInput,
  type PresenceStatus,
} from "./presence";

/**
 * How a learner moves through a program.
 *
 * A module is complete when the learner has both **attended the class** and
 * **done the work**.
 *
 * Attending means reaching the presence bar by either route — being in the live
 * class, or watching the recording (see ./presence.ts). Which route is nobody's
 * business but the learner's: someone on a night shift in Lagos who watches the
 * replay in full has attended as surely as someone who was there at 14:00.
 *
 * Doing the work means every deliverable the facilitator actually published:
 *   - assignment (the "make"), if one exists → submitted
 *   - peer critique, if the assignment asks for it → the required reviews given
 *   - quiz, if one exists → passed
 *
 * A module that has neither a scheduled class nor any deliverable completes
 * once it is in the past, so an empty module can never dam the sequence behind
 * it.
 */

export const QUIZ_PASS_MARK = 70;

export type SessionLite = {
  id: number;
  programId: number;
  startsAt: Date | null;
  durationMins: number;
  sortOrder: number;
  /**
   * Only ever used to name the module a learner has to finish first. Optional
   * so that callers written before locked modules explained themselves keep
   * working; the sentence falls back to a general one without it.
   */
  title?: string | null;
};

export type CourseworkStatus = {
  hasQuiz: boolean;
  quizBestScore: number | null;
  hasAssignment: boolean;
  assignmentSubmitted: boolean;
  /** How many peer critiques this module asks of each learner. 0 = none. */
  reviewsRequired: number;
  /** How many the learner has actually written. */
  reviewsGiven: number;
  /** How many critiques the learner's own submission has received. */
  reviewsReceived: number;
  /**
   * When each stops accepting work, or nothing at all for no deadline.
   *
   * Carried through untouched, and deliberately absent from every rule below. A
   * deadline shuts a door; it does not mark anybody down, and it must never be
   * able to un-complete work already handed in.
   */
  quizDueAt?: string | null;
  assignmentDueAt?: string | null;
};

export const EMPTY_COURSEWORK: CourseworkStatus = {
  hasQuiz: false,
  quizBestScore: null,
  hasAssignment: false,
  assignmentSubmitted: false,
  reviewsRequired: 0,
  reviewsGiven: 0,
  reviewsReceived: 0,
  quizDueAt: null,
  assignmentDueAt: null,
};

export type ProgressEntry = {
  sessionId: number;
  programId: number;
  progressPct: number;
  /** Joined the live room within the on-time grace window. */
  attendedLive: boolean;
  /** Checked in to the live room at all, on time or late. */
  attended: boolean;
  /** How much of the class has been attended live or watched on replay. */
  presence: PresenceStatus;
  completed: boolean;
  locked: boolean;
  hasQuiz: boolean;
  quizPassed: boolean;
  quizBestScore: number | null;
  hasAssignment: boolean;
  assignmentSubmitted: boolean;
  reviewsRequired: number;
  reviewsGiven: number;
  reviewsReceived: number;
  /** Deadlines, so a learner sees them without opening each piece of work. */
  quizDueAt: string | null;
  assignmentDueAt: string | null;
  /**
   * Why this one is shut, in words, or null when it is open.
   *
   * Worked out here rather than in the browser because the answer depends on
   * how the programme advances, and only this function knows that. The browser
   * used to guess "the module above this one", which is the wrong sentence
   * entirely for a programme that moves a week at a time.
   */
  lockedReason: string | null;
  /** Peer feedback is unlocked by giving your own — this mirrors that rule. */
  feedbackUnlocked: boolean;
};

/**
 * How a programme advances.
 *
 * "module": each class opens when the one before it is finished. The original
 * rule, and still the right one for a programme taught one class at a time.
 *
 * "week": every class in a week opens together, and the next week waits until
 * the whole of this one is done — both classes attended or watched, both
 * quizzes, both tasks. Written for a programme taught on Tuesdays and
 * Thursdays, where module-by-module locking shuts Thursday's class against a
 * cohort who cannot possibly have finished Tuesday's yet.
 */
export type Progression = "module" | "week";

export type ProgressOptions = {
  /** Programmes that advance a week at a time. Anything absent advances by module. */
  progressionByProgram?: Map<number, Progression>;
  /** Which week each class belongs to, by session id. Classes with no date have none. */
  weekOfSession?: Map<number, string>;
};

function sortSessions(list: SessionLite[]): SessionLite[] {
  // Canonical deterministic order: startsAt, sortOrder, id.
  return [...list].sort((a, b) => {
    const at = a.startsAt?.getTime() ?? Infinity;
    const bt = b.startsAt?.getTime() ?? Infinity;
    return at - bt || a.sortOrder - b.sortOrder || a.id - b.id;
  });
}

/**
 * Compute per-module progress and sequential lock state for one learner.
 * Pure: pass `now` explicitly in tests.
 */
export function computeProgress(
  sessions: SessionLite[],
  attendance: Map<number, Date>,
  enrolledAtByProgram: Map<number, Date>,
  coursework: Map<number, CourseworkStatus>,
  presenceBySession: Map<number, PresenceInput> = new Map(),
  now = Date.now(),
  // Added last so that every existing caller keeps working untouched. A
  // programme with nothing here behaves exactly as it always has.
  options: ProgressOptions = {},
): ProgressEntry[] {
  const byProgram = new Map<number, SessionLite[]>();
  for (const s of sessions) {
    const list = byProgram.get(s.programId) ?? [];
    list.push(s);
    byProgram.set(s.programId, list);
  }

  const entries: ProgressEntry[] = [];
  for (const [programId, unsorted] of byProgram.entries()) {
    const list = sortSessions(unsorted);
    const enrolledAt = enrolledAtByProgram.get(programId)?.getTime() ?? 0;
    const progression = options.progressionByProgram?.get(programId) ?? "module";

    /**
     * Two passes, because a week cannot be judged until all of it has been read.
     *
     * The first works out what is true of each class on its own. The second
     * decides what is open, which is the only part that differs between a
     * programme taught module by module and one taught week by week.
     */
    const rows: { session: SessionLite; entry: ProgressEntry; satisfied: boolean }[] = [];

    for (const s of list) {
      const joined = attendance.get(s.id);
      const start = s.startsAt?.getTime() ?? null;
      const end = start !== null ? start + s.durationMins * 60 * 1000 : null;
      const hasEnded = end !== null && now > end;

      const attended = !!joined;
      const attendedLive =
        !!joined && start !== null && joined.getTime() <= start + ON_TIME_GRACE_MS;

      // Presence is measured against the scheduled length of the class, so an
      // unscheduled module has nothing to be present for.
      const presence = presenceStatus({
        ...(presenceBySession.get(s.id) ?? EMPTY_PRESENCE),
        sessionSeconds: s.durationMins * 60,
      });

      const cw = coursework.get(s.id) ?? EMPTY_COURSEWORK;
      const quizPassed = cw.hasQuiz && (cw.quizBestScore ?? 0) >= QUIZ_PASS_MARK;
      const reviewsRequired = cw.hasAssignment ? cw.reviewsRequired : 0;
      const reviewsDone = cw.reviewsGiven >= reviewsRequired;

      // Attending the class is a requirement in its own right, and counts as one
      // share of the module alongside each published deliverable.
      const parts: number[] = [];
      const presenceRequired = start !== null;
      if (presenceRequired) {
        parts.push(Math.min(100, Math.round((presence.bestPct / PRESENCE_THRESHOLD_PCT) * 100)));
      }
      if (cw.hasAssignment) {
        parts.push(cw.assignmentSubmitted ? 100 : 0);
        if (reviewsRequired > 0) {
          parts.push(Math.min(100, Math.round((cw.reviewsGiven / reviewsRequired) * 100)));
        }
      }
      if (cw.hasQuiz) {
        parts.push(quizPassed ? 100 : Math.min(cw.quizBestScore ?? 0, 99));
      }

      const deliverablesMet =
        (!cw.hasAssignment || (cw.assignmentSubmitted && reviewsDone)) &&
        (!cw.hasQuiz || quizPassed);

      // Both halves: attended the class, and did the work.
      const requirementsMet = (!presenceRequired || presence.met) && deliverablesMet;

      // Nothing scheduled and nothing published → the module completes once it is
      // in the past, so an empty module never dams the sequence behind it.
      const completed = parts.length === 0 ? hasEnded : requirementsMet;

      const progressPct = completed
        ? 100
        : parts.length === 0
          ? 0
          : Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);

      const entry: ProgressEntry = {
        sessionId: s.id,
        programId: s.programId,
        progressPct,
        attendedLive,
        attended,
        presence,
        completed,
        // Filled in by the second pass below.
        locked: false,
        lockedReason: null,
        hasQuiz: cw.hasQuiz,
        quizPassed,
        quizBestScore: cw.quizBestScore,
        hasAssignment: cw.hasAssignment,
        assignmentSubmitted: cw.assignmentSubmitted,
        reviewsRequired,
        reviewsGiven: cw.reviewsGiven,
        reviewsReceived: cw.reviewsReceived,
        quizDueAt: cw.quizDueAt ?? null,
        assignmentDueAt: cw.assignmentDueAt ?? null,
        feedbackUnlocked: reviewsRequired === 0 || reviewsDone,
      };

      // Waived prerequisites: unscheduled modules, and modules that ended before
      // this learner enrolled (late joiners are not locked out forever).
      const waived = start === null || (end !== null && end < enrolledAt);
      rows.push({ session: s, entry, satisfied: completed || waived });
    }

    if (progression === "week") {
      lockByWeek(rows, options.weekOfSession ?? new Map());
    } else {
      lockByModule(rows);
    }

    for (const row of rows) entries.push(row.entry);
  }
  return entries;
}

type Row = { session: SessionLite; entry: ProgressEntry; satisfied: boolean };

/** The original rule: each class waits on the one immediately before it. */
function lockByModule(rows: Row[]): void {
  let previousSatisfied = true; // the first module is always unlocked
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    row.entry.locked = !previousSatisfied;
    row.entry.lockedReason = previousSatisfied ? null : whyModuleLocked(rows[i - 1]?.session.title);
    previousSatisfied = row.satisfied;
  }
}

/**
 * A week at a time: everything in a week opens together, and the next week
 * waits on the whole of the last one.
 *
 * The gate is the *previous* week rather than every week before it, which
 * matches how module-by-module locking already behaves — a learner who has been
 * let past one gate is not sent back through it later.
 *
 * A class with no date sits outside the weeks entirely. It is never locked and
 * never holds a week up, because there is no way to say where in the term it
 * falls.
 */
function lockByWeek(rows: Row[], weekOfSession: Map<number, string>): void {
  const order: string[] = [];
  const satisfiedByWeek = new Map<string, boolean>();

  for (const row of rows) {
    const week = weekOfSession.get(row.session.id);
    if (!week) continue;
    if (!satisfiedByWeek.has(week)) {
      satisfiedByWeek.set(week, true);
      order.push(week);
    }
    // Every class in the week has to be done, so one unfinished class fails it.
    satisfiedByWeek.set(week, satisfiedByWeek.get(week)! && row.satisfied);
  }

  for (const row of rows) {
    const week = weekOfSession.get(row.session.id);
    if (!week) {
      row.entry.locked = false;
      row.entry.lockedReason = null;
      continue;
    }
    const previous = order[order.indexOf(week) - 1];
    // The first week of a programme has nothing behind it.
    const open = previous === undefined || satisfiedByWeek.get(previous) === true;
    row.entry.locked = !open;
    row.entry.lockedReason = open ? null : whyWeekLocked();
  }
}

/**
 * The learner's on-time attendance streak for a program: consecutive scheduled
 * sessions, most recent first, that they joined on time. Recognition, not a gate.
 */
export function attendanceStreak(entries: ProgressEntry[], sessionsInOrder: SessionLite[]): number {
  const byId = new Map(entries.map((e) => [e.sessionId, e]));
  const past = sortSessions(sessionsInOrder).filter((s) => s.startsAt !== null);
  let streak = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    const entry = byId.get(past[i].id);
    if (!entry) break;
    if (!entry.attendedLive) break;
    streak++;
  }
  return streak;
}

/**
 * Why a module is locked, and what to do about it.
 *
 * A locked module used to show a padlock and the word "Locked", and that was
 * the whole of it. The explanation existed — "complete the previous module to
 * unlock this one" — in a message that fired when the row was clicked, on a
 * button that was disabled precisely because the row was locked. So it never
 * fired. Not once. A learner saw a padlock and was told nothing, ever.
 *
 * Naming the module they have to finish is the difference between a closed door
 * and a signpost, and the Lab already knows which one it is.
 */
export function whyModuleLocked(previousTitle?: string | null): string {
  const previous = (previousTitle ?? "").trim();
  return previous
    ? `Finish ${previous} to open this`
    : "Finish the module before this one to open it";
}
