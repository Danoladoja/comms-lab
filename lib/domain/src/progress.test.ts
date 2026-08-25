import { describe, expect, it } from "vitest";
import {
  computeProgress,
  attendanceStreak,
  EMPTY_COURSEWORK,
  type CourseworkStatus,
  type SessionLite,
} from "./progress";
import { EMPTY_PRESENCE, type PresenceInput } from "./presence";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-10T12:00:00Z").getTime();

function session(id: number, overrides: Partial<SessionLite> = {}): SessionLite {
  return {
    id,
    programId: 1,
    startsAt: new Date(NOW - 24 * HOUR),
    durationMins: 60,
    sortOrder: id,
    ...overrides,
  };
}

function coursework(overrides: Partial<CourseworkStatus> = {}): CourseworkStatus {
  return { ...EMPTY_COURSEWORK, ...overrides };
}

/** Attended the whole class live. sessionSeconds is filled in by computeProgress. */
function attendedInFull(durationMins = 60): PresenceInput {
  return { ...EMPTY_PRESENCE, liveSeconds: durationMins * 60 };
}

/** Watched the whole recording instead. */
function watchedInFull(durationMins = 60): PresenceInput {
  return {
    ...EMPTY_PRESENCE,
    replayWatchedSeconds: durationMins * 60,
    replayDurationSeconds: durationMins * 60,
  };
}

const enrolledLongAgo = new Map([[1, new Date(NOW - 90 * 24 * HOUR)]]);
const present = new Map([[1, attendedInFull()]]);

describe("computeProgress — attending the class is required", () => {
  it("does not complete a module on coursework alone", () => {
    const [entry] = computeProgress(
      [session(1)],
      new Map(),
      enrolledLongAgo,
      new Map([[1, coursework({ hasAssignment: true, assignmentSubmitted: true })]]),
      new Map(), // never turned up, never watched
      NOW,
    );
    expect(entry.completed).toBe(false);
    expect(entry.presence.met).toBe(false);
  });

  it("completes when the class was attended live and the work is done", () => {
    const [entry] = computeProgress(
      [session(1)],
      new Map(),
      enrolledLongAgo,
      new Map([[1, coursework({ hasAssignment: true, assignmentSubmitted: true })]]),
      present,
      NOW,
    );
    expect(entry.completed).toBe(true);
    expect(entry.presence.via).toBe("live");
    expect(entry.progressPct).toBe(100);
  });

  it("treats watching the full replay as equivalent to being there", () => {
    const [entry] = computeProgress(
      [session(1)],
      new Map(),
      enrolledLongAgo,
      new Map([[1, coursework({ hasAssignment: true, assignmentSubmitted: true })]]),
      new Map([[1, watchedInFull()]]),
      NOW,
    );
    expect(entry.completed).toBe(true);
    expect(entry.presence.via).toBe("replay");
  });

  it("does not complete when the class was attended but the work is outstanding", () => {
    const [entry] = computeProgress(
      [session(1)],
      new Map(),
      enrolledLongAgo,
      new Map([[1, coursework({ hasAssignment: true, assignmentSubmitted: false })]]),
      present,
      NOW,
    );
    expect(entry.completed).toBe(false);
  });

  it("locks the next module until the class behind it has been attended", () => {
    const sessions = [session(1), session(2, { startsAt: new Date(NOW - 2 * HOUR) })];
    const cw = new Map([
      [1, coursework({ hasAssignment: true, assignmentSubmitted: true })],
      [2, coursework({ hasAssignment: true })],
    ]);
    const entries = computeProgress(sessions, new Map(), enrolledLongAgo, cw, new Map(), NOW);
    expect(entries.find((e) => e.sessionId === 2)!.locked).toBe(true);
  });

  it("counts partial attendance towards the progress bar", () => {
    // Half the class watched: 50% against a 90% bar is 56% of the way there.
    const half = new Map([[1, { ...EMPTY_PRESENCE, liveSeconds: 30 * 60 }]]);
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map(), half, NOW);
    expect(entry.presence.bestPct).toBe(50);
    expect(entry.progressPct).toBe(56);
  });
});

describe("computeProgress — the live room is still recorded", () => {
  const start = new Date(NOW - 24 * HOUR);

  it("credits attendedLive when the learner joined within the grace window", () => {
    const joined = new Date(start.getTime() + 4 * 60 * 1000);
    const [entry] = computeProgress(
      [session(1, { startsAt: start })],
      new Map([[1, joined]]),
      enrolledLongAgo,
      new Map(),
      present,
      NOW,
    );
    expect(entry.attendedLive).toBe(true);
    expect(entry.attended).toBe(true);
  });

  it("records a late join as attended but not on time", () => {
    const joined = new Date(start.getTime() + 20 * 60 * 1000);
    const [entry] = computeProgress(
      [session(1, { startsAt: start })],
      new Map([[1, joined]]),
      enrolledLongAgo,
      new Map(),
      present,
      NOW,
    );
    expect(entry.attended).toBe(true);
    expect(entry.attendedLive).toBe(false);
  });

  it("does not let joining the room stand in for staying in it", () => {
    // Clicked join, left immediately: checked in, but no time accumulated.
    const [entry] = computeProgress(
      [session(1, { startsAt: start })],
      new Map([[1, start]]),
      enrolledLongAgo,
      new Map(),
      new Map(),
      NOW,
    );
    expect(entry.attendedLive).toBe(true);
    expect(entry.presence.met).toBe(false);
    expect(entry.completed).toBe(false);
  });
});

describe("computeProgress — peer critique gates completion", () => {
  it("holds the module open until the required reviews are written", () => {
    const cw = coursework({
      hasAssignment: true,
      assignmentSubmitted: true,
      reviewsRequired: 2,
      reviewsGiven: 1,
    });
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, cw]]), present, NOW);
    expect(entry.completed).toBe(false);
    expect(entry.feedbackUnlocked).toBe(false);
    // presence 100 + submitted 100 + half the reviews 50
    expect(entry.progressPct).toBe(83);
  });

  it("completes once both reviews are in", () => {
    const cw = coursework({
      hasAssignment: true,
      assignmentSubmitted: true,
      reviewsRequired: 2,
      reviewsGiven: 2,
    });
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, cw]]), present, NOW);
    expect(entry.completed).toBe(true);
    expect(entry.feedbackUnlocked).toBe(true);
  });

  it("ignores reviewsRequired when the module has no assignment", () => {
    const cw = coursework({ hasAssignment: false, reviewsRequired: 2, reviewsGiven: 0 });
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, cw]]), present, NOW);
    expect(entry.reviewsRequired).toBe(0);
    expect(entry.completed).toBe(true);
  });
});

describe("computeProgress — quizzes", () => {
  it("requires a pass when a quiz is published", () => {
    const cw = coursework({ hasQuiz: true, quizBestScore: 60 });
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, cw]]), present, NOW);
    expect(entry.quizPassed).toBe(false);
    expect(entry.completed).toBe(false);
    expect(entry.progressPct).toBe(80); // presence 100 + quiz 60
  });

  it("caps an unpassed best score below 100 so the bar never lies", () => {
    const failing = coursework({ hasQuiz: true, quizBestScore: 69 });
    const entries = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, failing]]), present, NOW);
    expect(entries[0].progressPct).toBe(85); // presence 100 + quiz 69
    expect(entries[0].completed).toBe(false);
  });
});

describe("computeProgress — empty and unscheduled modules never dam the sequence", () => {
  it("completes an attended module with no coursework once the class has ended", () => {
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map(), present, NOW);
    expect(entry.completed).toBe(true);
  });

  it("does not require presence for a module that was never scheduled", () => {
    const cw = new Map([[1, coursework({ hasAssignment: true, assignmentSubmitted: true })]]);
    const [entry] = computeProgress(
      [session(1, { startsAt: null })],
      new Map(),
      enrolledLongAgo,
      cw,
      new Map(),
      NOW,
    );
    expect(entry.completed).toBe(true);
  });

  it("waives an unscheduled module as a prerequisite", () => {
    const sessions = [
      session(1, { startsAt: null }),
      session(2, { startsAt: new Date(NOW - 2 * HOUR) }),
    ];
    const cw = new Map([[2, coursework({ hasAssignment: true })]]);
    const entries = computeProgress(sessions, new Map(), enrolledLongAgo, cw, new Map(), NOW);
    expect(entries.find((e) => e.sessionId === 2)!.locked).toBe(false);
  });

  it("waives modules that ended before the learner enrolled", () => {
    const sessions = [
      session(1, { startsAt: new Date(NOW - 10 * 24 * HOUR) }),
      session(2, { startsAt: new Date(NOW - 2 * HOUR) }),
    ];
    const enrolledYesterday = new Map([[1, new Date(NOW - 24 * HOUR)]]);
    const cw = new Map([
      [1, coursework({ hasAssignment: true, assignmentSubmitted: false })],
      [2, coursework({ hasAssignment: true })],
    ]);
    const entries = computeProgress(sessions, new Map(), enrolledYesterday, cw, new Map(), NOW);
    expect(entries.find((e) => e.sessionId === 2)!.locked).toBe(false);
  });
});

describe("computeProgress — ordering and multi-program isolation", () => {
  it("orders by startsAt regardless of the order rows arrive in", () => {
    const sessions = [
      session(2, { startsAt: new Date(NOW - 2 * HOUR), sortOrder: 99 }),
      session(1, { startsAt: new Date(NOW - 48 * HOUR), sortOrder: 1 }),
    ];
    const cw = new Map([
      [1, coursework({ hasAssignment: true, assignmentSubmitted: false })],
      [2, coursework({ hasAssignment: true })],
    ]);
    const entries = computeProgress(sessions, new Map(), enrolledLongAgo, cw, new Map(), NOW);
    expect(entries.find((e) => e.sessionId === 1)!.locked).toBe(false);
    expect(entries.find((e) => e.sessionId === 2)!.locked).toBe(true);
  });

  it("does not let one program's incomplete module lock another program", () => {
    const sessions = [
      session(1, { programId: 1 }),
      session(2, { programId: 2, startsAt: new Date(NOW - 2 * HOUR) }),
    ];
    const enrolled = new Map([
      [1, new Date(NOW - 90 * 24 * HOUR)],
      [2, new Date(NOW - 90 * 24 * HOUR)],
    ]);
    const cw = new Map([
      [1, coursework({ hasAssignment: true, assignmentSubmitted: false })],
      [2, coursework({ hasAssignment: true, assignmentSubmitted: true })],
    ]);
    const presence = new Map([[2, attendedInFull()]]);
    const entries = computeProgress(sessions, new Map(), enrolled, cw, presence, NOW);
    expect(entries.find((e) => e.sessionId === 2)!.locked).toBe(false);
    expect(entries.find((e) => e.sessionId === 2)!.completed).toBe(true);
  });
});

describe("attendanceStreak", () => {
  const sessions = [
    session(1, { startsAt: new Date(NOW - 72 * HOUR) }),
    session(2, { startsAt: new Date(NOW - 48 * HOUR) }),
    session(3, { startsAt: new Date(NOW - 24 * HOUR) }),
  ];

  it("counts consecutive on-time joins from the most recent session backwards", () => {
    const attendance = new Map([
      [1, new Date(NOW - 72 * HOUR)],
      [2, new Date(NOW - 48 * HOUR + 40 * 60 * 1000)], // late
      [3, new Date(NOW - 24 * HOUR)],
    ]);
    const entries = computeProgress(sessions, attendance, enrolledLongAgo, new Map(), new Map(), NOW);
    expect(attendanceStreak(entries, sessions)).toBe(1);
  });

  it("counts every session when the learner was always on time", () => {
    const attendance = new Map([
      [1, new Date(NOW - 72 * HOUR)],
      [2, new Date(NOW - 48 * HOUR)],
      [3, new Date(NOW - 24 * HOUR)],
    ]);
    const entries = computeProgress(sessions, attendance, enrolledLongAgo, new Map(), new Map(), NOW);
    expect(attendanceStreak(entries, sessions)).toBe(3);
  });
});
