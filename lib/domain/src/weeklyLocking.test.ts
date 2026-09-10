import { describe, expect, it } from "vitest";
import {
  computeProgress,
  EMPTY_COURSEWORK,
  type CourseworkStatus,
  type SessionLite,
} from "./progress";
import { EMPTY_PRESENCE, type PresenceInput } from "./presence";
import { weeksOfSessions } from "./teachingWeek";

/**
 * A programme taught on Tuesdays and Thursdays.
 *
 * Week one: Tue 8 Sep, Thu 10 Sep. Week two: Tue 15 Sep, Thu 17 Sep.
 * Everything from week one is due by the end of Monday 14 Sep.
 *
 * The bug this exists to prevent is a quiet one. Under module-by-module
 * locking, Thursday's class waits on Tuesday's being *finished* — and
 * Tuesday's cannot be finished until its quiz is in, which is not due until
 * the following Monday. So every second class of every week would be shut
 * against a cohort who had done nothing wrong, and the app would give them no
 * reason for it.
 */

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-18T12:00:00Z").getTime(); // after all four classes

const CLASSES = [
  { id: 1, title: "Who Owns the Grid", startsAt: new Date("2026-09-08T15:00:00Z") },
  { id: 2, title: "Reading a Tariff", startsAt: new Date("2026-09-10T15:00:00Z") },
  { id: 3, title: "The Just Transition", startsAt: new Date("2026-09-15T15:00:00Z") },
  { id: 4, title: "Writing the Brief", startsAt: new Date("2026-09-17T15:00:00Z") },
];

const sessions: SessionLite[] = CLASSES.map((c) => ({
  id: c.id,
  programId: 1,
  title: c.title,
  startsAt: c.startsAt,
  durationMins: 60,
  sortOrder: c.id,
}));

const weekly = {
  progressionByProgram: new Map<number, "module" | "week">([[1, "week"]]),
  weekOfSession: weeksOfSessions(sessions),
};

const enrolledLongAgo = new Map([[1, new Date(NOW - 90 * 24 * HOUR)]]);
const attendedInFull = (): PresenceInput => ({ ...EMPTY_PRESENCE, liveSeconds: 60 * 60 });
const attendedEverything = new Map(sessions.map((s) => [s.id, attendedInFull()]));

/** A module's worth of work, all of it done. */
const allDone = (): CourseworkStatus => ({
  ...EMPTY_COURSEWORK,
  hasQuiz: true,
  quizBestScore: 100,
  hasAssignment: true,
  assignmentSubmitted: true,
  reviewsRequired: 2,
  reviewsGiven: 2,
});

/** Work set but not handed in. */
const nothingDone = (): CourseworkStatus => ({
  ...EMPTY_COURSEWORK,
  hasQuiz: true,
  quizBestScore: null,
  hasAssignment: true,
  assignmentSubmitted: false,
  reviewsRequired: 2,
  reviewsGiven: 0,
});

const run = (
  coursework: Map<number, CourseworkStatus>,
  presence = attendedEverything,
) => {
  const entries = computeProgress(sessions, new Map(), enrolledLongAgo, coursework, presence, NOW, weekly);
  return new Map(entries.map((e) => [e.sessionId, e]));
};

describe("a week opens as a whole", () => {
  it("opens Thursday's class even though Tuesday's work is not in yet", () => {
    // The bug in one line. The learner attended Tuesday; the quiz is not due
    // until next Monday; Thursday's class is this week and must be open.
    const by = run(new Map([[1, nothingDone()], [2, nothingDone()]]));
    expect(by.get(1)!.locked).toBe(false);
    expect(by.get(2)!.locked).toBe(false);
  });

  it("holds next week shut until all of this week is done", () => {
    const by = run(new Map([
      [1, allDone()], [2, nothingDone()],   // Thursday's work still outstanding
      [3, nothingDone()], [4, nothingDone()],
    ]));
    expect(by.get(3)!.locked).toBe(true);
    expect(by.get(4)!.locked).toBe(true);
  });

  it("opens next week once both classes and all four pieces are in", () => {
    const by = run(new Map([
      [1, allDone()], [2, allDone()],
      [3, nothingDone()], [4, nothingDone()],
    ]));
    expect(by.get(3)!.locked).toBe(false);
    expect(by.get(4)!.locked).toBe(false);
  });

  it("holds next week shut when a class was neither attended nor watched", () => {
    // Both halves are required: the work and the class itself.
    const missedThursday = new Map(attendedEverything);
    missedThursday.delete(2);
    const by = run(new Map([[1, allDone()], [2, allDone()], [3, nothingDone()]]), missedThursday);
    expect(by.get(2)!.completed).toBe(false);
    expect(by.get(3)!.locked).toBe(true);
  });

  it("counts watching the recording as being there", () => {
    // A learner who missed Thursday live and watched it back is not held up.
    const watchedThursday = new Map(attendedEverything);
    watchedThursday.set(2, {
      ...EMPTY_PRESENCE,
      replayWatchedSeconds: 60 * 60,
      replayDurationSeconds: 60 * 60,
    });
    const by = run(new Map([[1, allDone()], [2, allDone()], [3, nothingDone()]]), watchedThursday);
    expect(by.get(3)!.locked).toBe(false);
  });

  it("counts the peer critiques as part of the week", () => {
    const noCritiques = { ...allDone(), reviewsGiven: 0 };
    const by = run(new Map([[1, allDone()], [2, noCritiques], [3, nothingDone()]]));
    expect(by.get(3)!.locked).toBe(true);
  });

  it("explains itself in terms of the week, not the module above", () => {
    const by = run(new Map([[1, nothingDone()], [2, nothingDone()], [3, nothingDone()]]));
    const reason = by.get(3)!.lockedReason ?? "";
    expect(reason).toMatch(/last week/i);
    expect(reason).toMatch(/both classes/i);
    // And never the old sentence, which would name Thursday's class as the
    // single thing in the way when in fact the whole week is.
    expect(reason).not.toContain("Reading a Tariff");
  });
});

describe("the same programme under the original rule", () => {
  const byModule = (coursework: Map<number, CourseworkStatus>) => {
    const entries = computeProgress(sessions, new Map(), enrolledLongAgo, coursework, attendedEverything, NOW);
    return new Map(entries.map((e) => [e.sessionId, e]));
  };

  it("shuts Thursday against a learner whose Tuesday quiz is not due yet", () => {
    // Kept as a test so the difference between the two rules is written down
    // rather than remembered. This is the behaviour the exception exists for.
    const by = byModule(new Map([[1, nothingDone()], [2, nothingDone()]]));
    expect(by.get(2)!.locked).toBe(true);
    expect(by.get(2)!.lockedReason).toContain("Who Owns the Grid");
  });

  it("is what every other programme still gets", () => {
    const entries = computeProgress(
      sessions, new Map(), enrolledLongAgo,
      new Map([[1, nothingDone()], [2, nothingDone()]]),
      attendedEverything, NOW,
      {
        // Programme 1 is not in this map, so nothing about it changes.
        progressionByProgram: new Map([[99, "week"]]),
        weekOfSession: weeksOfSessions(sessions),
      },
    );
    const thursday = entries.find((e) => e.sessionId === 2)!;
    expect(thursday.locked).toBe(true);
    expect(thursday.lockedReason).toContain("Who Owns the Grid");
    expect(thursday.lockedReason).not.toMatch(/last week/i);
  });
});

describe("classes that sit outside the weeks", () => {
  it("never locks an unscheduled class and never lets it hold a week up", () => {
    const withUndated: SessionLite[] = [
      ...sessions,
      { id: 5, programId: 1, title: "To be arranged", startsAt: null, durationMins: 60, sortOrder: 5 },
    ];
    const entries = computeProgress(
      withUndated, new Map(), enrolledLongAgo,
      new Map([[1, allDone()], [2, allDone()], [5, nothingDone()]]),
      attendedEverything, NOW,
      { progressionByProgram: new Map([[1, "week"]]), weekOfSession: weeksOfSessions(withUndated) },
    );
    const by = new Map(entries.map((e) => [e.sessionId, e]));
    expect(by.get(5)!.locked).toBe(false);
    // And week two still opened, because the undated class is in no week.
    expect(by.get(3)!.locked).toBe(false);
  });
});
