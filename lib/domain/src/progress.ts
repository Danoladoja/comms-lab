import { ON_TIME_GRACE_MS } from "./liveWindow";

/**
 * How a learner moves through a program.
 *
 * The rule that matters: **completion is earned by what you made, never by
 * where you were at 14:00.** Attendance is a bonus signal (streaks, priority in
 * the live queue); it never gates a module and it never blocks the next one.
 * This is deliberate — the audience is working journalists across four time
 * zones with load-shedding and metered data, and the previous behaviour locked
 * a learner out of the entire rest of the program for missing one live class.
 *
 * A module is complete when every deliverable the facilitator actually
 * published has been done:
 *   - assignment (the "make"), if one exists → submitted
 *   - peer critique, if the assignment asks for it → the required reviews given
 *   - quiz, if one exists → passed
 *
 * A module that publishes no deliverables completes once its session has ended,
 * so an empty module can never dam the sequence behind it.
 */

export const QUIZ_PASS_MARK = 70;

export type SessionLite = {
  id: number;
  programId: number;
  startsAt: Date | null;
  durationMins: number;
  sortOrder: number;
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
};

export const EMPTY_COURSEWORK: CourseworkStatus = {
  hasQuiz: false,
  quizBestScore: null,
  hasAssignment: false,
  assignmentSubmitted: false,
  reviewsRequired: 0,
  reviewsGiven: 0,
  reviewsReceived: 0,
};

export type ProgressEntry = {
  sessionId: number;
  programId: number;
  progressPct: number;
  /** Joined the live room on time. A bonus — never a requirement. */
  attendedLive: boolean;
  /** Checked in at all, on time or late. */
  attended: boolean;
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
  /** Peer feedback is unlocked by giving your own — this mirrors that rule. */
  feedbackUnlocked: boolean;
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
  now = Date.now(),
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
    let previousSatisfied = true; // the first module is always unlocked

    for (const s of list) {
      const joined = attendance.get(s.id);
      const start = s.startsAt?.getTime() ?? null;
      const end = start !== null ? start + s.durationMins * 60 * 1000 : null;
      const hasEnded = end !== null && now > end;

      const attended = !!joined;
      const attendedLive =
        !!joined && start !== null && joined.getTime() <= start + ON_TIME_GRACE_MS;

      const cw = coursework.get(s.id) ?? EMPTY_COURSEWORK;
      const quizPassed = cw.hasQuiz && (cw.quizBestScore ?? 0) >= QUIZ_PASS_MARK;
      const reviewsRequired = cw.hasAssignment ? cw.reviewsRequired : 0;
      const reviewsDone = cw.reviewsGiven >= reviewsRequired;

      // Each published deliverable contributes one equal share of the module.
      const parts: number[] = [];
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

      // No deliverables published → the module completes when the class is over,
      // so an empty module never dams the sequence behind it.
      const completed = parts.length === 0 ? hasEnded : deliverablesMet;

      const progressPct = completed
        ? 100
        : parts.length === 0
          ? 0
          : Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);

      entries.push({
        sessionId: s.id,
        programId: s.programId,
        progressPct,
        attendedLive,
        attended,
        completed,
        locked: !previousSatisfied,
        hasQuiz: cw.hasQuiz,
        quizPassed,
        quizBestScore: cw.quizBestScore,
        hasAssignment: cw.hasAssignment,
        assignmentSubmitted: cw.assignmentSubmitted,
        reviewsRequired,
        reviewsGiven: cw.reviewsGiven,
        reviewsReceived: cw.reviewsReceived,
        feedbackUnlocked: reviewsRequired === 0 || reviewsDone,
      });

      // Waived prerequisites: unscheduled modules, and modules that ended before
      // this learner enrolled (late joiners are not locked out forever).
      const waived = start === null || (end !== null && end < enrolledAt);
      previousSatisfied = completed || waived;
    }
  }
  return entries;
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
