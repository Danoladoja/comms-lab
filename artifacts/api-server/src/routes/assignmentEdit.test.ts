import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Editing a task must not change the deal the cohort is already working to.
 *
 * The task editor sends a title, a brief, a deadline and where the text came
 * from. It has never sent the rubric or the number of critiques — and the
 * server filled both from the house defaults when they were missing. So every
 * save of a title or a date quietly reset the critique requirement to two and
 * replaced a custom rubric, with nothing on screen to say so.
 *
 * That is not cosmetic. A learner whose work predates
 * `reviewsRequiredAtSubmission` has their requirement read live from this row,
 * so a module raised from one critique to two turns everyone who did what was
 * asked back into "not finished" — and the next module waits on this one. An
 * edit that asked nothing new of them locks them out of the following week.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    sessionsTable: { id: "id", programId: "programId", instructorId: "instructorId" },
    programsTable: { id: "id", progression: "progression" },
    enrollmentsTable: { id: "id", userId: "userId", programId: "programId", status: "status" },
    usersTable: { id: "id" },
    quizQuestionsTable: {}, quizAttemptsTable: {},
    sessionReadingsTable: {}, sessionSlidesTable: {}, latePassesTable: {},
    assignmentsTable: {
      id: "id", sessionId: "sessionId", dueAt: "dueAt", draft: "draft",
      rubric: "rubric", reviewsRequired: "reviewsRequired",
    },
    assignmentSubmissionsTable: { userId: "userId", sessionId: "sessionId" },
  };

  let selectResults: unknown[][] = [];
  /** What the upsert would actually write: the insert values, and the update set. */
  const written: { values?: Record<string, unknown>; set?: Record<string, unknown> }[] = [];

  const thenable = (get: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const key of [
      "from", "where", "leftJoin", "innerJoin", "orderBy", "limit",
      "returning", "groupBy", "onConflictDoNothing",
    ]) builder[key] = () => builder;
    builder.values = (v: Record<string, unknown>) => { written.push({ values: v }); return builder; };
    builder.set = () => builder;
    builder.onConflictDoUpdate = (arg: { set?: Record<string, unknown> }) => {
      written[written.length - 1] = { ...written[written.length - 1], set: arg?.set };
      return builder;
    };
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
      execute: vi.fn(async () => []),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
    },
    getCurrentUser: vi.fn(),
    currentRole: vi.fn(),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    written,
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

/** A rubric a facilitator wrote for this module, which is not the house one. */
const OWN_RUBRIC = [
  { id: "sourcing", label: "Sourcing", description: "Is every number attributed?", maxScore: 5 },
];

/** The task as it stands in the database before the edit. */
const saved = (over: Record<string, unknown> = {}) => [{
  id: 4,
  sessionId: 10,
  title: "Write the lede",
  instructions: "200 words.",
  dueAt: null,
  draft: false,
  postedAt: null,
  origin: "manual",
  rubric: OWN_RUBRIC,
  reviewsRequired: 1,
  ...over,
}];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

/** Exactly what the task editor sends: no rubric, no critique count. */
const editTheBrief = (body: Record<string, unknown> = {}) =>
  fetch(`${baseUrl}/api/sessions/10/assignment`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Write the lede",
      instructions: "Two hundred words, for a national daily.",
      origin: "manual",
      ...body,
    }),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.setSelects([]);
  mocks.written.length = 0;
  mocks.getCurrentUser.mockResolvedValue({ id: 9, name: "Amina Bello", role: "admin" });
  mocks.currentRole.mockResolvedValue("admin");

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

describe("saving a task the cohort is already working to", () => {
  /** session · the task as it stands · the row the upsert returns */
  const reads = (existing = saved()) =>
    mocks.setSelects([SESSION, existing, existing]);

  it("does not change how many critiques are owed", async () => {
    // This is the whole bug. The editor sends no number, and the number it was
    // set to is what the cohort has been working to all week.
    reads(saved({ reviewsRequired: 1 }));
    const res = await editTheBrief();

    expect(res.status).toBe(200);
    expect(mocks.written.at(-1)?.set).toMatchObject({ reviewsRequired: 1 });
  });

  it("does not throw away a rubric somebody wrote", async () => {
    // Critiques store their scores against the criteria that were on screen.
    // Swapping the rubric underneath them does not just change future marking —
    // it orphans the scores already given.
    reads();
    await editTheBrief();

    expect(mocks.written.at(-1)?.set).toMatchObject({ rubric: OWN_RUBRIC });
  });

  it("still takes a change when one is actually asked for", async () => {
    // Keeping a value is not the same as refusing to change it. A facilitator
    // who means to ask for three critiques gets three.
    reads(saved({ reviewsRequired: 1 }));
    await editTheBrief({ reviewsRequired: 3 });

    expect(mocks.written.at(-1)?.set).toMatchObject({ reviewsRequired: 3 });
  });

  it("uses the house defaults for a task that does not exist yet", async () => {
    // Nothing to preserve, so the defaults are right — and this is the only
    // case they were ever right for.
    mocks.setSelects([SESSION, [], saved()]);
    await editTheBrief();

    const first = mocks.written.at(-1);
    expect(first?.values).toMatchObject({ reviewsRequired: 2, draft: true });
    expect((first?.values?.rubric as unknown[])?.length).toBeGreaterThan(0);
  });

  it("falls back to the house rubric when the saved one is empty", async () => {
    // Tasks written before rubrics existed have an empty array, which is not a
    // rubric to preserve — it would fail validation and refuse the save.
    reads(saved({ rubric: [] }));
    const res = await editTheBrief();

    expect(res.status).toBe(200);
    expect((mocks.written.at(-1)?.set?.rubric as unknown[])?.length).toBeGreaterThan(0);
  });

  it("leaves the deadline alone too, as it always did", async () => {
    // The deadline was already protected this way. The point of this one is
    // that the protection now covers all three.
    const due = new Date("2026-09-21T22:59:00.000Z");
    reads(saved({ dueAt: due }));
    await editTheBrief();

    expect(mocks.written.at(-1)?.set).toMatchObject({ dueAt: due });
  });
});
