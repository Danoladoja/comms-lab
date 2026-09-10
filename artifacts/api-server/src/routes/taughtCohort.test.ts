import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reading the register of a class you teach.
 *
 * The one thing worth guarding is the scope. "Instructor" is a role, not a key
 * to the building: somebody teaching one programme must not be able to read
 * another cohort's names and addresses by changing a number in the address bar.
 * The check has to be a query about what they actually teach, never a claim
 * carried in the request.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    usersTable: { id: "id", name: "name", email: "email" },
    programsTable: { id: "id", title: "title" },
    enrollmentsTable: { userId: "userId", programId: "programId", status: "status" },
    sessionsTable: { id: "id", programId: "programId", instructorId: "instructorId" },
    courseworkTable: {}, reviewsTable: {}, attendanceTable: {},
  };

  let selectResults: unknown[][] = [];

  const thenable = (get: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const key of [
      "from", "where", "values", "set", "leftJoin", "innerJoin", "orderBy", "limit", "returning", "groupBy",
    ]) builder[key] = () => builder;
    builder.then = (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(get()).then(resolve, reject);
    return builder;
  };

  return {
    db: {
      select: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      selectDistinct: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      insert: vi.fn(() => thenable(() => [])),
      update: vi.fn(() => thenable(() => [])),
      delete: vi.fn(() => thenable(() => [])),
      transaction: vi.fn(),
    },
    getCurrentUser: vi.fn(),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    tables,
  };
});

vi.mock("@workspace/db", () => ({ db: mocks.db, ...mocks.tables }));
vi.mock("../lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("../lib/progress", () => ({
  progressForUser: vi.fn(async () => []),
  enrolledProgramIds: vi.fn(async () => []),
}));
vi.mock("../lib/enrollmentEmails", () => ({
  sendEnrollmentConfirmation: vi.fn(),
  sendWaitlistConfirmation: vi.fn(),
  sendAdminEnrollment: vi.fn(),
  sendWaitlistPromotion: vi.fn(),
  labLogoUrl: () => null,
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import enrollmentsRouter from "./enrollments";

const CLASS = [
  { name: "Amina Bello", email: "amina@example.org", status: "enrolled" },
  { name: "Kwame Mensah", email: "kwame@example.org", status: "enrolled" },
  { name: "Ngozi Eze", email: "ngozi@example.org", status: "completed" },
];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

const register = (programId: number) =>
  fetch(`${baseUrl}/api/my/programmes/${programId}/learners`);

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.setSelects([]);
  mocks.getCurrentUser.mockResolvedValue({ id: 5, role: "instructor" });

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

describe("GET /my/programmes/:id/learners", () => {
  it("gives a facilitator the register of a class they teach", async () => {
    // First select: do they teach here. Second: the class.
    mocks.setSelects([[{ programId: 3 }], CLASS]);

    const res = await register(3);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      active: number; finished: number; learners: { name: string; finished: boolean }[];
    };
    expect(body.active).toBe(2);
    expect(body.finished).toBe(1);
    expect(body.learners.map((l) => l.name)).toContain("Amina Bello");
    expect(body.learners.find((l) => l.name === "Ngozi Eze")?.finished).toBe(true);
  });

  it("refuses a facilitator a cohort they do not teach", async () => {
    // The whole point: changing the number in the address bar reaches nothing.
    mocks.setSelects([[], CLASS]);

    const res = await register(9);

    expect(res.status).toBe(403);
    // And the names were never fetched, let alone returned.
    expect(JSON.stringify(await res.json())).not.toContain("amina@example.org");
  });

  it("lets an admin read any of them", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 1, role: "admin" });
    mocks.setSelects([[], CLASS]);

    expect((await register(9)).status).toBe(200);
  });

  it("refuses a learner their own cohort's register", async () => {
    // A learner is on the programme, so the "do they teach here" query is the
    // only thing standing between them and everybody's address.
    mocks.getCurrentUser.mockResolvedValue({ id: 7, role: "learner" });
    mocks.setSelects([[], CLASS]);

    expect((await register(3)).status).toBe(403);
  });

  it("refuses anybody who is not signed in", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await register(3)).status).toBe(401);
  });

  it("refuses a programme that is not a number", async () => {
    const res = await fetch(`${baseUrl}/api/my/programmes/nonsense/learners`);
    expect(res.status).toBe(400);
  });
});
