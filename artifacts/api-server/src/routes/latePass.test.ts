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

  return {
    db: {
      select: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      selectDistinct: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      insert: vi.fn(() => thenable(() => selectResults.shift() ?? [{ id: 1 }])),
      update: vi.fn(() => thenable(() => [])),
      delete: vi.fn(() => thenable(() => [])),
      transaction: vi.fn(),
    },
    getCurrentUser: vi.fn(),
    currentRole: vi.fn(),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    inserted,
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
vi.mock("../lib/email", () => ({ emailConfigured: () => false, sendEmail: vi.fn() }));
vi.mock("../lib/enrollmentEmails", () => ({ appUrl: () => "https://x", labLogoUrl: () => null }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import courseworkRouter from "./coursework";

const SESSION = [{ id: 10, programId: 2, instructorId: 9 }];
const ENROLLED = [{ id: 77, status: "enrolled" }];

/** A deadline that has already gone, and one still to come. */
const passed = () => new Date(Date.now() - 6 * 60 * 60 * 1000);
const ahead = () => new Date(Date.now() + 6 * 60 * 60 * 1000);
/** Long gone — past even the 48 hours a pass would buy. */
const longGone = () => new Date(Date.now() - 96 * 60 * 60 * 1000);

const task = (dueAt: Date | null) => [{ id: 11, dueAt, draft: false }];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

const claim = () =>
  fetch(`${baseUrl}/api/sessions/10/assignment/late-pass`, { method: "POST" });

const handIn = () =>
  fetch(`${baseUrl}/api/sessions/10/assignment/submission`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "Filed at the last possible moment.", aiUse: "none" }),
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

describe("POST /sessions/:id/assignment/late-pass", () => {
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
