import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deadlines on a module's quiz and written task.
 *
 * The point of these is the refusal. A greyed-out button is a courtesy to an
 * honest learner; it stops nobody who reloads the page at one minute past, and
 * it stops nobody at all who has the address of the submit endpoint. So the
 * tests worth having are the ones that go straight past the browser and knock
 * on the door itself.
 *
 * The other thing guarded here is the escape hatch. Missing a deadline blocks
 * the module, and a blocked module blocks the rest of the programme, so
 * clearing the date has to genuinely let a learner back in — otherwise a
 * mistyped year quietly ends somebody's course.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    sessionsTable: { id: "id", programId: "programId", quizDueAt: "quizDueAt" },
    enrollmentsTable: { id: "id", userId: "userId", programId: "programId", status: "status" },
    quizQuestionsTable: { sessionId: "sessionId", sortOrder: "sortOrder", id: "id" },
    quizAttemptsTable: { userId: "userId", sessionId: "sessionId", scorePct: "scorePct" },
    assignmentsTable: { id: "id", sessionId: "sessionId", dueAt: "dueAt" },
    assignmentSubmissionsTable: { userId: "userId", sessionId: "sessionId", body: "body", submittedAt: "submittedAt" },
  };

  let selectResults: unknown[][] = [];
  const inserted: string[] = [];

  const thenable = (get: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const key of [
      "from", "where", "values", "set", "leftJoin", "innerJoin", "orderBy", "limit",
      "returning", "groupBy", "onConflictDoUpdate",
    ]) builder[key] = () => builder;
    builder.then = (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(get()).then(resolve, reject);
    return builder;
  };

  return {
    db: {
      select: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      selectDistinct: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      insert: vi.fn((table: { sessionId?: string }) => {
        inserted.push(String(Object.keys(table ?? {})[0] ?? "unknown"));
        return thenable(() => selectResults.shift() ?? []);
      }),
      update: vi.fn(() => thenable(() => [])),
      delete: vi.fn(() => thenable(() => [])),
      transaction: vi.fn(),
    },
    getCurrentUser: vi.fn(),
    currentRole: vi.fn(),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    inserts: inserted,
    tables,
  };
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

import courseworkRouter from "./coursework";

const HOUR = 60 * 60 * 1000;
const yesterday = () => new Date(Date.now() - 24 * HOUR);
const nextWeek = () => new Date(Date.now() + 7 * 24 * HOUR);

const MODULE = { id: 10, programId: 3, instructorId: 99 };
const ENROLLED = [{ id: 1 }];
const QUESTIONS = [
  { id: 1, prompt: "Who pays?", options: ["A", "B"], correctIndex: 0, sortOrder: 0, origin: "manual" },
];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

const answerQuiz = () =>
  fetch(`${baseUrl}/api/sessions/10/quiz/attempts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answers: [{ questionId: 1, answerIndex: 0 }] }),
  });

const handIn = () =>
  fetch(`${baseUrl}/api/sessions/10/assignment/submission`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "My piece, written on the night of the deadline." }),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.inserts.length = 0;
  mocks.setSelects([]);
  mocks.getCurrentUser.mockResolvedValue({ id: 5, role: "learner" });
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

describe("the quiz deadline", () => {
  it("refuses answers once the date has passed", async () => {
    mocks.setSelects([[{ ...MODULE, quizDueAt: yesterday() }], ENROLLED]);

    const res = await answerQuiz();

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/deadline/i);
    // And nothing was recorded — a refused attempt is not an attempt.
    expect(mocks.inserts).toHaveLength(0);
  });

  it("takes answers when the deadline is still ahead", async () => {
    mocks.setSelects([
      [{ ...MODULE, quizDueAt: nextWeek() }], ENROLLED, QUESTIONS,
      [{ id: 1 }], [{ best: 100 }],
    ]);

    const res = await answerQuiz();

    expect(res.status).toBe(200);
    expect((await res.json()) as { scorePct: number }).toMatchObject({ scorePct: 100, passed: true });
  });

  it("takes answers when there is no deadline at all", async () => {
    // Every module worked this way before deadlines existed, and most still do.
    mocks.setSelects([
      [{ ...MODULE, quizDueAt: null }], ENROLLED, QUESTIONS,
      [{ id: 1 }], [{ best: 100 }],
    ]);

    expect((await answerQuiz()).status).toBe(200);
  });

  it("tells the learner the deadline and that it has closed", async () => {
    const due = yesterday();
    mocks.setSelects([[{ ...MODULE, quizDueAt: due }], ENROLLED, QUESTIONS, [{ best: null }]]);

    const body = (await (await fetch(`${baseUrl}/api/sessions/10/quiz`)).json()) as {
      dueAt: string; closed: boolean;
    };

    // The verdict travels as an answer, not as a sum for the browser to do:
    // a learner with a slow clock must not be handed an extra day.
    expect(body.closed).toBe(true);
    expect(body.dueAt).toBe(due.toISOString());
  });
});

describe("the assignment deadline", () => {
  it("refuses a submission once the date has passed", async () => {
    mocks.setSelects([[MODULE], ENROLLED, [{ id: 4, dueAt: yesterday() }]]);

    const res = await handIn();

    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/deadline/i);
    expect(mocks.inserts).toHaveLength(0);
  });

  it("takes a submission before the date", async () => {
    mocks.setSelects([
      [MODULE], ENROLLED, [{ id: 4, dueAt: nextWeek() }],
      [{ body: "My piece, written on the night of the deadline.", submittedAt: new Date() }],
    ]);

    expect((await handIn()).status).toBe(200);
  });

  it("lets a learner back in the moment the date is cleared", async () => {
    // This is the way out of a missed deadline, and the reason a deadline is
    // safe to set at all. If clearing it did not reopen the door, one wrong
    // date would end somebody's programme.
    mocks.setSelects([
      [MODULE], ENROLLED, [{ id: 4, dueAt: null }],
      [{ body: "My piece, written on the night of the deadline.", submittedAt: new Date() }],
    ]);

    expect((await handIn()).status).toBe(200);
  });
});
