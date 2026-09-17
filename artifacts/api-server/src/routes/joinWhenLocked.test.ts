import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A locked module must never bar the door to a class that is happening.
 *
 * This is the circle that shut a cohort out of three weeks of their own
 * programme. Attendance for one week goes unrecorded; that module will not
 * complete, so the next one locks; locked, the learner is refused the door to
 * the next class, so nothing is recorded for that one either; and the week
 * after locks behind it. Each of them is told to finish a module they have
 * finished, and there is no move available that helps.
 *
 * A lock governs coursework — opening the quiz and the task before the work
 * behind them is done. Letting somebody into a live class moves them past
 * nothing: the coursework stays shut until the previous week is finished.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    sessionsTable: { id: "id", programId: "programId", instructorId: "instructorId" },
    attendanceTable: { id: "id", userId: "userId", sessionId: "sessionId", joinedAt: "joinedAt" },
    enrollmentsTable: { id: "id", userId: "userId", programId: "programId", status: "status" },
    usersTable: { id: "id" },
    programsTable: { id: "id" },
    replayProgressTable: { id: "id", userId: "userId", sessionId: "sessionId" },
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
      insert: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      update: vi.fn(() => thenable(() => [])),
      delete: vi.fn(() => thenable(() => [])),
      execute: vi.fn(async () => []),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})),
    },
    getCurrentUser: vi.fn(),
    currentRole: vi.fn(),
    progressForUser: vi.fn(async (): Promise<unknown[]> => []),
    enrolledProgramIds: vi.fn(async (): Promise<number[]> => [2]),
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
  progressForUser: mocks.progressForUser,
  enrolledProgramIds: mocks.enrolledProgramIds,
}));
vi.mock("../lib/email", () => ({ emailConfigured: () => false, sendEmail: vi.fn() }));
vi.mock("../lib/enrollmentEmails", () => ({
  appUrl: () => "https://x",
  labLogoUrl: () => null,
  sendEnrollmentEmail: vi.fn(),
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/reminders", () => ({ scheduleReminders: vi.fn() }));

import enrollmentsRouter from "./enrollments";

/** A class that is running right now, so the join window is open. */
const RUNNING = [{
  id: 10,
  programId: 2,
  instructorId: 9,
  title: "Climate Change and Energy in Africa",
  startsAt: new Date(Date.now() - 10 * 60 * 1000),
  durationMins: 90,
  meetUrl: "https://meet.google.com/abc-defg-hij",
}];

/** What progress says when the previous week was never completed. */
const LOCKED = [{ sessionId: 10, locked: true, lockedReason: "Finish the previous module" }];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

const join = () => fetch(`${baseUrl}/api/sessions/10/join`, { method: "POST" });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.setSelects([]);
  mocks.inserted.length = 0;
  mocks.getCurrentUser.mockResolvedValue({ id: 5, name: "Amina Bello", role: "learner" });
  mocks.currentRole.mockResolvedValue("learner");
  mocks.enrolledProgramIds.mockResolvedValue([2]);
  mocks.progressForUser.mockResolvedValue(LOCKED);

  const app = express();
  app.use(express.json());
  app.use("/api", enrollmentsRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

describe("joining a class while the module is locked", () => {
  it("lets the learner in, and records that they were there", async () => {
    // The whole point. They are enrolled, the class is running, and whether
    // last week's critiques are finished is not the door's business.
    mocks.setSelects([RUNNING, [{ id: 1, joinedAt: new Date() }]]);
    const res = await join();

    expect(res.status).toBe(200);
    // An attendance row is what stops the lock feeding itself into next week.
    expect(mocks.inserted.at(-1)).toMatchObject({ userId: 5, sessionId: 10 });
  });

  it("still turns away somebody who is not on the programme", async () => {
    // Removing one gate is not removing them all.
    mocks.enrolledProgramIds.mockResolvedValue([]);
    mocks.setSelects([RUNNING]);
    const res = await join();

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/not enrolled/i);
    expect(mocks.inserted).toHaveLength(0);
  });

  it("still turns away a class that has already finished", async () => {
    mocks.setSelects([[{ ...RUNNING[0], startsAt: new Date(Date.now() - 8 * 60 * 60 * 1000) }]]);
    const res = await join();

    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/already ended/i);
  });

  it("does not spend eighteen queries working out a lock it will ignore", async () => {
    // The progress calculation walks the learner's whole programme. Asking for
    // it on a door that no longer consults it is pure cost, and this endpoint
    // is hit by everybody at once when a class starts.
    mocks.setSelects([RUNNING, [{ id: 1, joinedAt: new Date() }]]);
    await join();

    expect(mocks.progressForUser).not.toHaveBeenCalled();
  });
});
