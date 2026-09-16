import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Late passes.
 *
 * The Lab does not mark written work, so there is no score a late penalty could
 * reduce. What was missing was a way for somebody with a dead grid or a sick
 * child to stay in the programme without asking a facilitator for a favour —
 * because asking favours rewards the confident and quietly loses everybody else.
 *
 * Two rules matter enough to guard. A pass must be spent deliberately, never as
 * a side effect of filing late. And the extra time it buys must end: a pass is
 * 48 hours, not an open door.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    usersTable: { id: "id", name: "name", email: "email", role: "role" },
    programsTable: { id: "id", progression: "progression" },
    enrollmentsTable: { id: "id", userId: "userId", programId: "programId", status: "status" },
    sessionsTable: { id: "id", programId: "programId", instructorId: "instructorId" },
    quizQuestionsTable: {}, quizAttemptsTable: {},
    sessionReadingsTable: {}, sessionSlidesTable: {},
    assignmentsTable: { id: "id", sessionId: "sessionId", dueAt: "dueAt", draft: "draft" },
    assignmentSubmissionsTable: { id: "id", userId: "userId", sessionId: "sessionId", late: "late" },
    latePassesTable: {
      id: "id", userId: "userId", programId: "programId", sessionId: "sessionId",
      claimedAt: "claimedAt", extendedFrom: "extendedFrom",
    },
  };

  let selectResults: unknown[][] = [];
  // eslint-disable-next-line prefer-const
  let dbRef: Record<string, unknown>;
  const inserted: Record<string, unknown>[] = [];

  const thenable = (get: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const key of [
      "from", "where", "set", "leftJoin", "innerJoin", "orderBy", "limit",
      "returning", "groupBy", "onConflictDoNothing", "onConflictDoUpdate",
    ]) builder[key] = () => builder;
    builder.values = (v: Record<string, unknown>) => { inserted.push(v); return builder; };
    builder.then = (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(get()).then(resolve, reject);
    return builder;
  };

  const built = {
    db: {
      select: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      selectDistinct: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      insert: vi.fn(() => thenable(() => selectResults.shift() ?? [{ id: 1 }])),
      update: vi.fn(() => thenable(() => [])),
      delete: vi.fn(() => thenable(() => [])),
      execute: vi.fn(async () => []),
      // The claim runs under a lock now, so the fake has to actually run the
      // callback rather than returning undefined.
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(dbRef)),
    },
    getCurrentUser: vi.fn(),
    currentRole: vi.fn(),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    inserted,
    tables,
  };
  dbRef = built.db;
  return built;
});

vi.mock("@workspace/db", () => ({ db: mocks.db, ...mocks.tables }));
vi.mock("../lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  currentRole: mocks.currentRole,
}));
vi.mock("../lib/progress", () => ({
  progressForUser: vi.fn(async () => []),
  enrolledProgramIds: vi.fn(async () => []),
}));
vi.mock("../lib/email", () => ({ emailConfigured: () => false, sendEmail: vi.fn() }));
vi.mock("../lib/enrollmentEmails", () => ({ appUrl: () => "https://x", labLogoUrl: () => null }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import courseworkRouter from "./coursework";

const SESSION = [{ id: 10, programId: 2, instructorId: 9 }];
/** The same module, with a quiz deadline on it. */
const withQuizDue = (quizDueAt: Date | null) => [{ ...SESSION[0], quizDueAt, quizDraft: false }];
const ENROLLED = [{ id: 77, status: "enrolled" }];

/** A deadline that has already gone, and one still to come. */
const passed = () => new Date(Date.now() - 6 * 60 * 60 * 1000);
const ahead = () => new Date(Date.now() + 6 * 60 * 60 * 1000);
/** Long gone — past even the 48 hours a pass would buy. */
const longGone = () => new Date(Date.now() - 96 * 60 * 60 * 1000);

const task = (dueAt: Date | null) => [{ id: 11, dueAt, draft: false }];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

const claim = (piece?: "quiz" | "assignment") =>
  fetch(`${baseUrl}/api/sessions/10/late-pass`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(piece ? { piece } : {}),
  });

/** The address the browser used before a pass covered the quiz as well. */
const claimAtOldAddress = () =>
  fetch(`${baseUrl}/api/sessions/10/assignment/late-pass`, { method: "POST" });

const answerQuiz = () =>
  fetch(`${baseUrl}/api/sessions/10/quiz/attempts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers: [{ questionId: 1, answerIndex: 0 }] }),
  });

const QUESTIONS = [{ id: 1, prompt: "Who pays?", options: ["A", "B"], correctIndex: 0, sortOrder: 0 }];

/** Long enough to clear the 500-word floor on a module that has one. */
const longPiece = Array.from({ length: 520 }, (_, i) => `word${i}`).join(" ");

const handIn = (body = longPiece) =>
  fetch(`${baseUrl}/api/sessions/10/assignment/submission`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, aiUse: "none" }),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.setSelects([]);
  mocks.inserted.length = 0;
  mocks.getCurrentUser.mockResolvedValue({ id: 5, name: "Amina Bello", role: "learner" });
  mocks.currentRole.mockResolvedValue("learner");

  const app = express();
  app.use(express.json());
  app.use("/api", courseworkRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

describe("POST /sessions/:id/late-pass", () => {
  /** session · enrolment · task · passes already spent */
  const reads = (dueAt: Date | null, spent: unknown[]) =>
    mocks.setSelects([SESSION, ENROLLED, task(dueAt), spent, [{ id: 1 }], spent]);

  it("spends one once the deadline has gone", async () => {
    reads(passed(), []);
    const res = await claim();

    expect(res.status).toBe(201);
    const body = await res.json() as { spent: boolean; windowEnd: string };
    expect(body.spent).toBe(true);
    expect(body.windowEnd).toBeTruthy();
    // A row is written, which is what "spent" means — the balance is counted
    // from these rows rather than kept anywhere that could drift.
    expect(mocks.inserted.at(-1)).toMatchObject({ userId: 5, programId: 2, sessionId: 10 });
  });

  it("refuses one while the task is still open", async () => {
    reads(ahead(), []);
    const res = await claim();

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/still open/i);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("refuses a third", async () => {
    reads(passed(), [{ sessionId: 7 }, { sessionId: 8 }]);
    const res = await claim();

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/used both/i);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("refuses one when even the extra time has gone", async () => {
    reads(longGone(), []);
    const res = await claim();

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/run out/i);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("does not charge twice for the same task", async () => {
    // Two taps on a slow connection must not cost two passes.
    reads(passed(), [{ sessionId: 10 }]);
    const res = await claim();

    expect(res.status).toBe(200);
    expect((await res.json() as { spent: boolean }).spent).toBe(false);
    expect(mocks.inserted).toHaveLength(0);
  });
});

describe("filing after the deadline", () => {
  /** session · enrolment · task · passes spent */
  const reads = (dueAt: Date | null, spent: unknown[]) =>
    mocks.setSelects([SESSION, ENROLLED, task(dueAt), spent, [{
      id: 1, body: "Filed at the last possible moment.", submittedAt: new Date(), late: true,
    }]]);

  it("is refused when no pass has been spent", async () => {
    // The pass has to be a decision. Filing late must never quietly spend one.
    reads(passed(), []);
    const res = await handIn();

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/use one of your late passes/i);
  });

  it("goes through on a spent pass, and is recorded as late", async () => {
    reads(passed(), [{ sessionId: 10 }]);
    const res = await handIn();

    expect(res.status).toBe(200);
    expect((await res.json() as { late: boolean }).late).toBe(true);
    // Written down rather than worked out later, so an admin moving the
    // deadline afterwards cannot rewrite what happened.
    expect(mocks.inserted.at(-1)).toMatchObject({ late: true });
  });

  it("is refused once the pass's own window has run out", async () => {
    // A pass buys 48 hours, not an open door.
    reads(longGone(), [{ sessionId: 10 }]);
    const res = await handIn();

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/run out/i);
  });

  it("leaves an on-time submission completely alone", async () => {
    reads(ahead(), []);
    const res = await handIn();

    expect(res.status).toBe(200);
    expect(mocks.inserted.at(-1)).toMatchObject({ late: false });
  });

  it("leaves a task with no deadline completely alone", async () => {
    // Most modules have no deadline and must behave as they always have.
    reads(null, []);
    expect((await handIn()).status).toBe(200);
    expect(mocks.inserted.at(-1)).toMatchObject({ late: false });
  });
});

/**
 * The omission: a pass opened the written task and left the quiz shut.
 *
 * It was scoped to written work on the reasoning that an auto-marked quiz with
 * unlimited retakes has nothing to rescue. What that missed is that a shut quiz
 * leaves the module incomplete and the following week locked — the same loss
 * the passes exist to prevent, reached by a different road.
 */
describe("a late pass covers the quiz too", () => {
  it("refuses a late attempt by offering the pass, not by sending them to ask a favour", async () => {
    // session · enrolment · passes spent (none)
    mocks.setSelects([withQuizDue(passed()), ENROLLED, []]);
    const res = await answerQuiz();

    expect(res.status).toBe(403);
    const said = JSON.stringify(await res.json());
    expect(said).toMatch(/use one of your late passes/i);
    // Named for the thing in front of them: "this task" in front of a quiz
    // reads like the app has confused their two deadlines.
    expect(said).toMatch(/this quiz/i);
  });

  it("takes a late attempt from somebody who spent a pass on this module", async () => {
    // The pass was spent on the written task. The quiz opens because the pass
    // belongs to the module, which is the whole of this change.
    mocks.setSelects([
      withQuizDue(passed()), ENROLLED, [{ sessionId: 10 }],
      QUESTIONS, [{ id: 1 }], [{ best: 100 }],
    ]);
    const res = await answerQuiz();

    expect(res.status).toBe(200);
    expect(await res.json() as { scorePct: number }).toMatchObject({ scorePct: 100, passed: true });
  });

  it("shuts the quiz again once the pass's own window has run out", async () => {
    // A pass buys 48 hours on each door, not an open one.
    mocks.setSelects([withQuizDue(longGone()), ENROLLED, [{ sessionId: 10 }]]);
    const res = await answerQuiz();

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/run out/i);
  });

  it("leaves a quiz with no deadline exactly as it was", async () => {
    // Most modules have no quiz deadline and must behave as they always have —
    // and must not spend a read on late passes to find that out.
    mocks.setSelects([withQuizDue(null), ENROLLED, QUESTIONS, [{ id: 1 }], [{ best: 100 }]]);
    expect((await answerQuiz()).status).toBe(200);
  });
});

describe("spending one from the quiz", () => {
  /** session · enrolment · task · passes · rows inside the lock · passes after */
  const reads = (quizDueAt: Date | null, workDueAt: Date | null, spent: unknown[]) =>
    mocks.setSelects([
      withQuizDue(quizDueAt), ENROLLED, task(workDueAt), spent, [{ id: 1 }], spent,
    ]);

  it("spends one, and it is the module that is paid for", async () => {
    reads(passed(), passed(), []);
    const res = await claim("quiz");

    expect(res.status).toBe(201);
    expect((await res.json() as { spent: boolean }).spent).toBe(true);
    // One row, keyed on the module. There is no second row for the quiz,
    // because there is no second pass to spend.
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted.at(-1)).toMatchObject({ userId: 5, programId: 2, sessionId: 10 });
  });

  it("can be spent when only the quiz deadline has gone", async () => {
    // The quiz shut last night; the writing is not due until Friday.
    reads(passed(), ahead(), []);
    expect((await claim("quiz")).status).toBe(201);
  });

  it("is judged on the module, not on the piece the browser happened to name", async () => {
    // Same module, same moment — but the request says "assignment", which is
    // still open. Asked about that piece alone the answer is "you do not need
    // one", and the learner is refused the pass that would open their shut
    // quiz. The question has to be asked of the module, because the pass is.
    reads(passed(), ahead(), []);
    const res = await claim("assignment");

    expect(res.status).toBe(201);
    expect(mocks.inserted.at(-1)).toMatchObject({ sessionId: 10 });
  });

  it("costs nothing to press on both pieces of the same module", async () => {
    // A learner who uses it on the quiz and then opens the written task and
    // presses there too must not be charged twice for one module.
    reads(passed(), passed(), [{ sessionId: 10 }]);
    const res = await claim("assignment");

    expect(res.status).toBe(200);
    expect((await res.json() as { spent: boolean }).spent).toBe(false);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("says so plainly when neither piece is late", async () => {
    reads(ahead(), ahead(), []);
    const res = await claim("quiz");

    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/this quiz is still open/i);
  });

  it("still answers at the address yesterday's browser knows", async () => {
    // The person with a stale page open is exactly the person who needs a late
    // pass; their browser only knows the old address.
    reads(passed(), passed(), []);
    const res = await claimAtOldAddress();

    expect(res.status).toBe(201);
    expect(mocks.inserted.at(-1)).toMatchObject({ sessionId: 10 });
  });
});

/**
 * The word floors.
 *
 * Critiques had quietly become a formality: a score out of ten and "good work,
 * maybe tighten the intro" clears a 120-character minimum with room to spare.
 * Five hundred words on your own piece and two hundred and fifty on each of two
 * peers' makes a thousand words a week, half of it spent reading somebody else
 * closely enough to have something to say.
 *
 * The rule a module is judged by is the one it was set under, which is what
 * keeps this off the first module of a cohort already teaching.
 */
describe("how much has to be written", () => {
  /** session · enrolment · task · passes · the saved row */
  const reads = (dueAt: Date | null) =>
    mocks.setSelects([SESSION, ENROLLED, task(dueAt), [], [{
      id: 1, body: "x", submittedAt: new Date(), late: false,
    }]]);

  /** A deadline safely after the floors came in. */
  const laterModule = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  it("refuses a short piece, and says how far off it is", async () => {
    reads(laterModule());
    const res = await handIn("Two hundred words would be generous for this.");

    expect(res.status).toBe(400);
    const said = JSON.stringify(await res.json());
    expect(said).toMatch(/at least 500 words/i);
    // The number they are at, not just the number they need.
    expect(said).toMatch(/You have 8 /);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("takes one that is long enough", async () => {
    reads(laterModule());
    expect((await handIn()).status).toBe(200);
  });

  // Which modules the floors apply to is decided by `wordsRequired`, and it is
  // proved there — a module whose deadline had already passed when the rule
  // came in keeps the rules it was set under. It cannot be shown from here
  // without a test that decays: such a module's deadline has by definition
  // gone, so the only way in is a late pass, and that window is 48 hours wide.
  // Which is also the useful thing to know about the exemption — for
  // submissions it is nearly moot, and it is really about the critiques still
  // being written against those modules, which have no deadline of their own.

  it("puts the floor on a module with no deadline at all", async () => {
    // Falling the other way would exempt every future module that never gets a
    // date, which is most of them.
    reads(null);
    expect((await handIn("Far too short.")).status).toBe(400);
  });

  it("asks about the deadline before it asks about the length", async () => {
    // Somebody arriving after the door has shut is told the door has shut, not
    // sent away to write another two hundred words for a door that was never
    // going to open.
    reads(longGone());
    const res = await handIn("Short.");

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/deadline/i);
  });
});
