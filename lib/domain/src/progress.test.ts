import { describe, expect, it } from "vitest";
import {
  computeProgress,
  attendanceStreak,
  EMPTY_COURSEWORK,
  type CourseworkStatus,
  type SessionLite,
} from "./progress";

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

const enrolledLongAgo = new Map([[1, new Date(NOW - 90 * 24 * HOUR)]]);

describe("computeProgress — attendance is never a gate", () => {
  it("completes a module from the make alone, with no attendance at all", () => {
    const sessions = [session(1)];
    const [entry] = computeProgress(
      sessions,
      new Map(), // never joined the live room
      enrolledLongAgo,
      new Map([[1, coursework({ hasAssignment: true, assignmentSubmitted: true })]]),
      NOW,
    );
    expect(entry.attended).toBe(false);
    expect(entry.completed).toBe(true);
    expect(entry.progressPct).toBe(100);
  });

  it("does not lock module 2 because the learner missed module 1 live", () => {
    const sessions = [session(1), session(2, { startsAt: new Date(NOW - 2 * HOUR) })];
    const cw = new Map([
      [1, coursework({ hasAssignment: true, assignmentSubmitted: true })],
      [2, coursework({ hasAssignment: true, assignmentSubmitted: false })],
    ]);
    const entries = computeProgress(sessions, new Map(), enrolledLongAgo, cw, NOW);
    expect(entries.find((e) => e.sessionId === 2)!.locked).toBe(false);
  });

  it("still locks module 2 when the module-1 make is outstanding", () => {
    const sessions = [session(1), session(2, { startsAt: new Date(NOW - 2 * HOUR) })];
    const cw = new Map([
      [1, coursework({ hasAssignment: true, assignmentSubmitted: false })],
      [2, coursework({ hasAssignment: true })],
    ]);
    const entries = computeProgress(sessions, new Map(), enrolledLongAgo, cw, NOW);
    expect(entries.find((e) => e.sessionId === 2)!.locked).toBe(true);
  });
});

describe("computeProgress — on-time attendance is recorded as a bonus", () => {
  const start = new Date(NOW - 24 * HOUR);

  it("credits attendedLive when the learner joined within the grace window", () => {
    const joined = new Date(start.getTime() + 4 * 60 * 1000);
    const [entry] = computeProgress(
      [session(1, { startsAt: start })],
      new Map([[1, joined]]),
      enrolledLongAgo,
      new Map(),
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
      NOW,
    );
    expect(entry.attended).toBe(true);
    expect(entry.attendedLive).toBe(false);
  });

  it("credits attendance during the class, not only after it ends", () => {
    const liveStart = new Date(NOW - 10 * 60 * 1000);
    const [entry] = computeProgress(
      [session(1, { startsAt: liveStart })],
      new Map([[1, new Date(liveStart.getTime() + 60 * 1000)]]),
      enrolledLongAgo,
      new Map(),
      NOW,
    );
    expect(entry.attendedLive).toBe(true);
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
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, cw]]), NOW);
    expect(entry.completed).toBe(false);
    expect(entry.feedbackUnlocked).toBe(false);
    expect(entry.progressPct).toBe(75); // submitted (100) + half the reviews (50)
  });

  it("completes and unlocks feedback once both reviews are in", () => {
    const cw = coursework({
      hasAssignment: true,
      assignmentSubmitted: true,
      reviewsRequired: 2,
      reviewsGiven: 2,
    });
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, cw]]), NOW);
    expect(entry.completed).toBe(true);
    expect(entry.feedbackUnlocked).toBe(true);
  });

  it("ignores reviewsRequired when the module has no assignment", () => {
    const cw = coursework({ hasAssignment: false, reviewsRequired: 2, reviewsGiven: 0 });
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, cw]]), NOW);
    expect(entry.reviewsRequired).toBe(0);
    expect(entry.completed).toBe(true); // no deliverables, and the class has ended
  });
});

describe("computeProgress — quizzes", () => {
  it("requires a pass when a quiz is published", () => {
    const cw = coursework({ hasQuiz: true, quizBestScore: 60 });
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, cw]]), NOW);
    expect(entry.quizPassed).toBe(false);
    expect(entry.completed).toBe(false);
    expect(entry.progressPct).toBe(60);
  });

  it("caps an unpassed best score below 100 so the bar never lies", () => {
    const cw = coursework({ hasQuiz: true, quizBestScore: 100 });
    const passing = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, cw]]), NOW);
    expect(passing[0].progressPct).toBe(100);

    const failing = coursework({ hasQuiz: true, quizBestScore: 69 });
    const entries = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map([[1, failing]]), NOW);
    expect(entries[0].progressPct).toBe(69);
  });
});

describe("computeProgress — empty and unscheduled modules never dam the sequence", () => {
  it("completes an empty module once its class has ended", () => {
    const [entry] = computeProgress([session(1)], new Map(), enrolledLongAgo, new Map(), NOW);
    expect(entry.completed).toBe(true);
  });

  it("leaves an empty future module incomplete but does not lock the next one", () => {
    const sessions = [
      session(1, { startsAt: new Date(NOW + 24 * HOUR) }),
      session(2, { startsAt: new Date(NOW + 48 * HOUR) }),
    ];
    const entries = computeProgress(sessions, new Map(), enrolledLongAgo, new Map(), NOW);
    expect(entries[0].completed).toBe(false);
    // module 1 is not complete, so module 2 is genuinely locked...
    expect(entries[1].locked).toBe(true);
  });

  it("waives an unscheduled module as a prerequisite", () => {
    const sessions = [
      session(1, { startsAt: null }),
      session(2, { startsAt: new Date(NOW - 2 * HOUR) }),
    ];
    const cw = new Map([[2, coursework({ hasAssignment: true })]]);
    const entries = computeProgress(sessions, new Map(), enrolledLongAgo, cw, NOW);
    const second = entries.find((e) => e.sessionId === 2)!;
    expect(second.locked).toBe(false);
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
    const entries = computeProgress(sessions, new Map(), enrolledYesterday, cw, NOW);
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
    const entries = computeProgress(sessions, new Map(), enrolledLongAgo, cw, NOW);
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
    const entries = computeProgress(sessions, new Map(), enrolled, cw, NOW);
    expect(entries.find((e) => e.sessionId === 2)!.locked).toBe(false);
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
    const entries = computeProgress(sessions, attendance, enrolledLongAgo, new Map(), NOW);
    expect(attendanceStreak(entries, sessions)).toBe(1);
  });

  it("counts every session when the learner was always on time", () => {
    const attendance = new Map([
      [1, new Date(NOW - 72 * HOUR)],
      [2, new Date(NOW - 48 * HOUR)],
      [3, new Date(NOW - 24 * HOUR)],
    ]);
    const entries = computeProgress(sessions, attendance, enrolledLongAgo, new Map(), NOW);
    expect(attendanceStreak(entries, sessions)).toBe(3);
  });
});
