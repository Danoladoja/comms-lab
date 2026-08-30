import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tables = {
    attendanceTable: {},
    enrollmentsTable: {
      certificateCode: "certificateCode",
      status: "status",
      userId: "userId",
      programId: "programId",
      portfolioPublic: "portfolioPublic",
    },
    programsTable: { id: "id", title: "title" },
    sessionsTable: {
      id: "id",
      programId: "programId",
      startsAt: "startsAt",
      durationMins: "durationMins",
      sortOrder: "sortOrder",
    },
    usersTable: { id: "id", name: "name" },
    assignmentsTable: { sessionId: "sessionId", title: "title" },
    assignmentSubmissionsTable: {
      userId: "userId",
      sessionId: "sessionId",
      body: "body",
      submittedAt: "submittedAt",
    },
  };

  let queryResults: unknown[][] = [];
  const query = () => {
    const result = queryResults.shift() ?? [];
    const builder = {
      from: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: () => builder,
      groupBy: () => builder,
      orderBy: () => builder,
      then: (
        resolve: (value: unknown[]) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(result).then(resolve, reject),
    };
    return builder;
  };

  return {
    db: { select: vi.fn(query) },
    progressForUser: vi.fn(),
    setQueryResults(results: unknown[][]) {
      queryResults = [...results];
    },
    tables,
  };
});

vi.mock("@workspace/db", () => ({ db: mocks.db, ...mocks.tables }));
vi.mock("../lib/progress", () => ({
  progressForUser: mocks.progressForUser,
  enrolledProgramIds: vi.fn(),
}));
vi.mock("../lib/auth", () => ({ getCurrentUser: vi.fn() }));
vi.mock("../lib/enrollmentEmails", () => ({
  sendEnrollmentConfirmation: vi.fn(),
  sendWaitlistConfirmation: vi.fn(),
}));

import enrollmentsRouter, {
  certificateCodeForVerification,
  enrollmentCanReceiveCertificate,
} from "./enrollments";

const CODE = "AECL-7F3K-9QM2-XR41";
const completedProgress = [{
  sessionId: 10,
  programId: 3,
  completed: true,
  reviewsGiven: 2,
}];

describe("GET /certificates/:certificateId/verify", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>;
  let origin: string;

  beforeEach(async () => {
    mocks.db.select.mockClear();
    mocks.progressForUser.mockReset();
    mocks.setQueryResults([]);

    const app = express();
    app.use(enrollmentsRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve()),
    );
  });

  async function verify(code: string) {
    const response = await fetch(`${origin}/certificates/${code}/verify`);
    return { response, body: await response.json() as Record<string, unknown> };
  }

  function arrangeEligibleEnrollment() {
    mocks.setQueryResults([
      [{
        userId: 7,
        programId: 3,
        portfolioPublic: false,
        certificateCode: CODE,
        status: "enrolled",
      }],
      [{ title: "Energy Reporting" }],
      [{ name: "Amina Diallo" }],
      [{ programId: 3, lastEnd: "2026-08-20T12:00:00.000Z" }],
    ]);
    mocks.progressForUser.mockResolvedValue(completedProgress);
  }

  it("returns a verified completed program without leaking private learner data", async () => {
    arrangeEligibleEnrollment();

    const { response, body } = await verify(CODE);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      learnerName: "Amina Diallo",
      programTitle: "Energy Reporting",
      completedAt: "2026-08-20T12:00:00.000Z",
    });
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("role");
    expect(body).not.toHaveProperty("enrollmentId");
    expect(body.works).toEqual([]);
  });

  it("returns 404 when the program is incomplete", async () => {
    mocks.setQueryResults([
      [{
        userId: 7,
        programId: 3,
        portfolioPublic: false,
        certificateCode: CODE,
        status: "enrolled",
      }],
    ]);
    mocks.progressForUser.mockResolvedValue([{ ...completedProgress[0], completed: false }]);

    const { response, body } = await verify(CODE);

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Certificate not found" });
  });

  it("returns 404 for malformed IDs without querying certificate records", async () => {
    const { response, body } = await verify("not-a-certificate");

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Certificate not found" });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it("returns 404 for cancelled or waitlisted enrollments", async () => {
    for (const status of ["cancelled", "waitlisted"]) {
      mocks.setQueryResults([[
        {
          userId: 7,
          programId: 3,
          portfolioPublic: false,
          certificateCode: CODE,
          status,
        },
      ]]);

      const { response, body } = await verify(CODE);

      expect(response.status).toBe(404);
      expect(body).toEqual({ error: "Certificate not found" });
    }
    expect(mocks.progressForUser).not.toHaveBeenCalled();
  });

  it("handles certificate IDs case-insensitively", async () => {
    arrangeEligibleEnrollment();

    const { response, body } = await verify(CODE.toLowerCase());

    expect(response.status).toBe(200);
    expect(body.certificateId).toBe(CODE);
    expect(certificateCodeForVerification(CODE.toLowerCase())).toBe(CODE);
  });

  it("publishes only the intended coursework fields when the learner opts in", async () => {
    mocks.setQueryResults([
      [{
        userId: 7,
        programId: 3,
        portfolioPublic: true,
        certificateCode: CODE,
        status: "completed",
      }],
      [{ title: "Energy Reporting" }],
      [{ name: "Amina Diallo" }],
      [{ programId: 3, lastEnd: "2026-08-20T12:00:00.000Z" }],
      [{
        title: "Write a dispatch",
        body: "A concise submitted dispatch.",
        submittedAt: new Date("2026-08-19T09:00:00.000Z"),
        privateMarker: "must not leak",
      }],
    ]);
    mocks.progressForUser.mockResolvedValue(completedProgress);

    const { response, body } = await verify(CODE);

    expect(response.status).toBe(200);
    expect(body.works).toEqual([{
      title: "Write a dispatch",
      body: "A concise submitted dispatch.",
      submittedAt: "2026-08-19T09:00:00.000Z",
    }]);
  });

  it("returns 404 when the certificate owner no longer exists", async () => {
    mocks.setQueryResults([
      [{
        userId: 7,
        programId: 3,
        portfolioPublic: false,
        certificateCode: CODE,
        status: "completed",
      }],
      [{ title: "Energy Reporting" }],
      [],
      [{ programId: 3, lastEnd: "2026-08-20T12:00:00.000Z" }],
    ]);
    mocks.progressForUser.mockResolvedValue(completedProgress);

    const { response, body } = await verify(CODE);

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Certificate not found" });
  });
});

describe("certificate verification guards", () => {
  it("normalises case before lookup and rejects malformed IDs", () => {
    expect(certificateCodeForVerification(CODE.toLowerCase())).toBe(CODE);
    expect(certificateCodeForVerification("not-a-certificate")).toBeNull();
  });

  it("allows only active or completed enrollment statuses", () => {
    expect(enrollmentCanReceiveCertificate("enrolled")).toBe(true);
    expect(enrollmentCanReceiveCertificate("completed")).toBe(true);
    expect(enrollmentCanReceiveCertificate("cancelled")).toBe(false);
    expect(enrollmentCanReceiveCertificate("waitlisted")).toBe(false);
  });
});