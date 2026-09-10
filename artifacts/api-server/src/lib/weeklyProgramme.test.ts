import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The switch has to actually reach the rules.
 *
 * The weekly rule itself is tested where it lives, without a database. What is
 * worth checking here is the wiring: that the setting is read from the
 * programme, that the classes are grouped into weeks before the rules see them,
 * and — most of all — that a programme with the setting off is untouched.
 *
 * That last one is the whole promise made when this was scoped: one cohort
 * changes, and every other cohort, including finished ones, behaves exactly as
 * it did yesterday.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    attendanceTable: {}, replayProgressTable: {}, enrollmentsTable: { programId: "programId", createdAt: "createdAt", userId: "userId" },
    sessionsTable: { id: "id", programId: "programId", startsAt: "startsAt", durationMins: "durationMins", sortOrder: "sortOrder", title: "title", quizDueAt: "quizDueAt", quizDraft: "quizDraft" },
    programsTable: { id: "id", progression: "progression" },
    quizQuestionsTable: { sessionId: "sessionId" },
    quizAttemptsTable: { sessionId: "sessionId", userId: "userId", scorePct: "scorePct" },
    assignmentsTable: { sessionId: "sessionId", reviewsRequired: "reviewsRequired", dueAt: "dueAt", draft: "draft" },
    assignmentSubmissionsTable: { sessionId: "sessionId", userId: "userId", id: "id" },
    submissionReviewsTable: { sessionId: "sessionId", reviewerId: "reviewerId", submissionId: "submissionId", id: "id" },
  };

  let queue: unknown[][] = [];
  const thenable = (get: () => unknown[]) => {
    const b: Record<string, unknown> = {};
    for (const k of ["from", "where", "innerJoin", "leftJoin", "groupBy", "orderBy", "limit"]) b[k] = () => b;
    b.then = (res: (v: unknown[]) => unknown, rej?: (r: unknown) => unknown) =>
      Promise.resolve(get()).then(res, rej);
    return b;
  };

  return {
    db: {
      select: vi.fn(() => thenable(() => queue.shift() ?? [])),
      selectDistinct: vi.fn(() => thenable(() => queue.shift() ?? [])),
    },
    setQueue(rows: unknown[][]) { queue = [...rows]; },
    tables,
  };
});

vi.mock("@workspace/db", () => ({ db: mocks.db, ...mocks.tables }));

import { progressForUser } from "./progress";

const TUESDAY = new Date("2026-09-08T15:00:00Z");
const THURSDAY = new Date("2026-09-10T15:00:00Z");
const NEXT_TUESDAY = new Date("2026-09-15T15:00:00Z");

const CLASSES = [
  { id: 1, programId: 1, startsAt: TUESDAY, durationMins: 60, sortOrder: 1, title: "Who Owns the Grid", quizDueAt: null },
  { id: 2, programId: 1, startsAt: THURSDAY, durationMins: 60, sortOrder: 2, title: "Reading a Tariff", quizDueAt: null },
  { id: 3, programId: 1, startsAt: NEXT_TUESDAY, durationMins: 60, sortOrder: 3, title: "The Just Transition", quizDueAt: null },
];

/**
 * The queue of query results, in the order progressForUser asks for them:
 * classes, programmes, then attendance, replay, enrolment, quizzes, best
 * scores, tasks, submissions, critiques given, critiques received.
 */
function arrange(progression: "module" | "week") {
  mocks.setQueue([
    CLASSES,
    [{ id: 1, progression }],
    // Turned up to every class, on time, for the whole hour.
    CLASSES.map((c) => ({ sessionId: c.id, joinedAt: c.startsAt, liveSeconds: 3600 })),
    [],
    [{ programId: 1, createdAt: new Date("2026-06-01T00:00:00Z") }],
    // Every class has a posted quiz and a posted task; none of the work is in.
    CLASSES.map((c) => ({ sessionId: c.id })),
    [],
    CLASSES.map((c) => ({ sessionId: c.id, reviewsRequired: 0, dueAt: null })),
    [],
    [],
    [],
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setQueue([]);
});

describe("a programme switched to weekly", () => {
  it("opens Thursday's class while Tuesday's quiz is still outstanding", async () => {
    arrange("week");
    const by = new Map((await progressForUser(5, [1])).map((e) => [e.sessionId, e]));

    expect(by.get(1)!.locked).toBe(false);
    expect(by.get(2)!.locked).toBe(false);
    // But next week still waits on this one being finished.
    expect(by.get(3)!.locked).toBe(true);
    expect(by.get(3)!.lockedReason).toMatch(/last week/i);
  });
});

describe("every other programme", () => {
  it("is left exactly as it was", async () => {
    // The same classes, the same learner, the same unfinished work — and the
    // original rule, because this programme was not switched.
    arrange("module");
    const by = new Map((await progressForUser(5, [1])).map((e) => [e.sessionId, e]));

    expect(by.get(2)!.locked).toBe(true);
    expect(by.get(2)!.lockedReason).toContain("Who Owns the Grid");
  });

  it("takes the original rule when the setting is something unexpected", async () => {
    // A value nobody meant must not silently change how a cohort progresses.
    mocks.setQueue([]);
    arrange("module");
    mocks.setQueue([
      CLASSES,
      [{ id: 1, progression: "fortnightly" }],
      CLASSES.map((c) => ({ sessionId: c.id, joinedAt: c.startsAt, liveSeconds: 3600 })),
      [],
      [{ programId: 1, createdAt: new Date("2026-06-01T00:00:00Z") }],
      CLASSES.map((c) => ({ sessionId: c.id })),
      [],
      CLASSES.map((c) => ({ sessionId: c.id, reviewsRequired: 0, dueAt: null })),
      [],
      [],
      [],
    ]);
    const by = new Map((await progressForUser(5, [1])).map((e) => [e.sessionId, e]));
    expect(by.get(2)!.locked).toBe(true);
  });
});
