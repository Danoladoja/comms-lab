import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Inviting fifty people at once, exercised over real HTTP.
 *
 * The behaviour worth guarding is not that a good sheet works. It is that a bad
 * row does not take the good ones with it: fifty accepted applicants, and one
 * typo must not mean forty-nine people never hear from the Lab.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    usersTable: { id: "id", email: "email" },
    programsTable: { id: "id" },
    enrollmentsTable: { userId: "userId", programId: "programId" },
    pendingInvitationsTable: { email: "email" },
  };

  /** Rows returned by successive select() calls, oldest first. */
  let selectResults: unknown[][] = [];
  /** Rows returned by successive insert().returning() calls. */
  let insertResults: unknown[][] = [];

  const thenable = (get: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const key of ["from", "where", "values", "onConflictDoUpdate", "onConflictDoNothing", "returning", "limit"]) {
      builder[key] = () => builder;
    }
    builder.then = (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(get()).then(resolve, reject);
    return builder;
  };

  return {
    db: {
      select: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      insert: vi.fn(() => thenable(() => insertResults.shift() ?? [])),
      update: vi.fn(() => thenable(() => [])),
      delete: vi.fn(() => thenable(() => [])),
    },
    sendInvitation: vi.fn(),
    deliverInvitation: vi.fn(),
    sendAdminEnrollment: vi.fn(),
    revokeInvitation: vi.fn(),
    invitesConfigured: vi.fn(() => true),
    getCurrentUser: vi.fn(async () => ({ id: 1, role: "admin" })),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    setInserts(rows: unknown[][]) { insertResults = [...rows]; },
    tables,
  };
});

vi.mock("@workspace/db", () => ({ db: mocks.db, ...mocks.tables }));
vi.mock("../lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  // Every request in these tests is an admin; the gate itself is Clerk's.
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/clerkInvites", () => ({
  invitesConfigured: mocks.invitesConfigured,
  sendInvitation: mocks.sendInvitation,
  revokeInvitation: mocks.revokeInvitation,
}));
vi.mock("../lib/invitationDelivery", () => ({
  deliverInvitation: mocks.deliverInvitation,
}));
vi.mock("../lib/enrollmentEmails", () => ({
  sendAdminEnrollment: mocks.sendAdminEnrollment,
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import bulkInvitesRouter from "./bulkInvites";

const PROGRAMME = [{ id: 3, title: "Energy Reporting", capacity: 30, startDate: "Nov 2026" }];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

function post(body: unknown) {
  return fetch(`${baseUrl}/api/admin/invitations/bulk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Result = {
  outcomes: { email: string; status: string; detail: string }[];
  invited: number; enrolled: number; alreadyEnrolled: number; failed: number;
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.invitesConfigured.mockReturnValue(true);
  mocks.sendInvitation.mockResolvedValue({ ok: true, invitation: { id: "inv_1", email: "", url: null } });
  mocks.deliverInvitation.mockResolvedValue({ ok: true, invitationId: "inv_1", sentBy: "us" });
  mocks.revokeInvitation.mockResolvedValue("revoked");
  mocks.setSelects([]);
  mocks.setInserts([]);

  const app = express();
  app.use(express.json());
  app.use("/api", bulkInvitesRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

describe("POST /admin/invitations/bulk", () => {
  it("invites everybody on a clean sheet", async () => {
    mocks.setSelects([
      PROGRAMME,
      [], [],   // person 1: no account, no prior invitation
      [], [],   // person 2
    ]);

    const res = await post({
      programId: 3,
      entries: [
        { row: 2, name: "Amina Bello", email: "amina@example.org" },
        { row: 3, name: "Kwame Mensah", email: "kwame@example.org" },
      ],
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Result;
    expect(body.invited).toBe(2);
    expect(body.failed).toBe(0);
    expect(mocks.deliverInvitation).toHaveBeenCalledTimes(2);
  });

  it("one bad address does not stop the rest of the sheet", async () => {
    // The whole reason this endpoint reports per person rather than failing.
    mocks.setSelects([PROGRAMME, [], [], [], []]);

    const res = await post({
      programId: 3,
      entries: [
        { row: 2, email: "amina@example.org" },
        { row: 3, email: "not-an-address" },
        { row: 4, email: "kwame@example.org" },
      ],
    });

    const body = (await res.json()) as Result;
    expect(body.invited).toBe(2);
    expect(body.failed).toBe(1);
    expect(body.outcomes).toHaveLength(3);
    expect(body.outcomes[1].status).toBe("failed");
    expect(body.outcomes[0].status).toBe("invited");
    expect(body.outcomes[2].status).toBe("invited");
  });

  it("keeps going when the invitation provider refuses one person", async () => {
    mocks.setSelects([PROGRAMME, [], [], [], [], [], []]);
    mocks.deliverInvitation
      .mockResolvedValueOnce({ ok: true, invitationId: "inv_1", sentBy: "us" })
      .mockResolvedValueOnce({ ok: false, error: "Clerk would not accept that address." })
      .mockResolvedValueOnce({ ok: true, invitationId: "inv_3", sentBy: "us" });

    const res = await post({
      programId: 3,
      entries: [
        { email: "one@example.org" },
        { email: "two@example.org" },
        { email: "three@example.org" },
      ],
    });

    const body = (await res.json()) as Result;
    expect(body.invited).toBe(2);
    expect(body.failed).toBe(1);
    expect(body.outcomes[1].detail).toMatch(/would not accept/i);
  });

  it("enrols somebody who already has an account instead of inviting them", async () => {
    mocks.setSelects([PROGRAMME, [{ id: 42, email: "amina@example.org" }]]);
    mocks.setInserts([[{ id: 900 }]]);   // the enrolment row was created

    const res = await post({ programId: 3, entries: [{ email: "amina@example.org" }] });
    const body = (await res.json()) as Result;

    expect(body.enrolled).toBe(1);
    expect(body.invited).toBe(0);
    // No second invitation to somebody who is already here.
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
  });

  it("says nothing to do for a learner already on the programme", async () => {
    mocks.setSelects([PROGRAMME, [{ id: 42, email: "amina@example.org" }]]);
    mocks.setInserts([[]]);              // conflict: no row returned

    const res = await post({ programId: 3, entries: [{ email: "amina@example.org" }] });
    const body = (await res.json()) as Result;

    expect(body.alreadyEnrolled).toBe(1);
    expect(body.enrolled).toBe(0);
  });

  it("sends one invitation when the same address is listed twice", async () => {
    // Two colleagues added the same applicant. They get one email.
    mocks.setSelects([PROGRAMME, [], []]);

    const res = await post({
      programId: 3,
      entries: [{ email: "amina@example.org" }, { email: "AMINA@example.org" }],
    });

    const body = (await res.json()) as Result;
    expect(mocks.deliverInvitation).toHaveBeenCalledTimes(1);
    expect(body.outcomes).toHaveLength(2);
    expect(body.outcomes[1].detail).toMatch(/appeared earlier/i);
  });

  it("withdraws a live invitation before issuing a replacement", async () => {
    // Otherwise the first link stays valid forever with nothing recording it.
    mocks.setSelects([PROGRAMME, [], [{ email: "amina@example.org", clerkInvitationId: "inv_old", acceptedAt: null }]]);

    const res = await post({ programId: 3, entries: [{ email: "amina@example.org" }] });
    const body = (await res.json()) as Result;

    expect(mocks.revokeInvitation).toHaveBeenCalledWith("inv_old");
    expect(body.outcomes[0].status).toBe("reinvited");
  });

  it("does not re-invite somebody who already accepted", async () => {
    mocks.setSelects([PROGRAMME, [], [{ email: "amina@example.org", clerkInvitationId: "inv_old", acceptedAt: new Date() }]]);

    const res = await post({ programId: 3, entries: [{ email: "amina@example.org" }] });
    const body = (await res.json()) as Result;

    expect(body.failed).toBe(1);
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
  });

  it("refuses the whole request when no programme was chosen", async () => {
    const res = await post({ entries: [{ email: "amina@example.org" }] });
    expect(res.status).toBe(400);
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
  });

  it("refuses when the list is empty", async () => {
    mocks.setSelects([PROGRAMME]);
    const res = await post({ programId: 3, entries: [] });
    expect(res.status).toBe(400);
  });

  it("says so plainly when invitations are not configured", async () => {
    mocks.invitesConfigured.mockReturnValue(false);
    const res = await post({ programId: 3, entries: [{ email: "amina@example.org" }] });
    expect(res.status).toBe(503);
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
  });
});

describe("telling people they were added", () => {
  it("emails somebody who already had an account", async () => {
    // They get no invitation, because they need no account. Without this email
    // they are enrolled in silence — which is what an admin testing with their
    // own address reported as the feature not working.
    mocks.setSelects([PROGRAMME, [{ id: 42, email: "amina@example.org", name: "Amina" }]]);
    mocks.setInserts([[{ id: 900 }]]);

    await post({ programId: 3, entries: [{ email: "amina@example.org", name: "Amina Bello" }] });

    expect(mocks.sendAdminEnrollment).toHaveBeenCalledTimes(1);
    expect(mocks.sendAdminEnrollment.mock.calls[0][0]).toMatchObject({ email: "amina@example.org" });
    expect(mocks.sendAdminEnrollment.mock.calls[0][1]).toMatchObject({ title: "Energy Reporting" });
  });

  it("says nothing to somebody who was already on the programme", async () => {
    mocks.setSelects([PROGRAMME, [{ id: 42, email: "amina@example.org", name: "Amina" }]]);
    mocks.setInserts([[]]);

    await post({ programId: 3, entries: [{ email: "amina@example.org" }] });
    expect(mocks.sendAdminEnrollment).not.toHaveBeenCalled();
  });
});

describe("when the invitation email itself fails", () => {
  it("reports that person as failed rather than as invited", async () => {
    // The letter is now ours to send. If it does not go, the person has no way
    // in, and telling an admin otherwise is how somebody gets forgotten.
    mocks.setSelects([PROGRAMME, [], []]);
    mocks.deliverInvitation.mockResolvedValue({
      ok: false,
      error: "The invitation email could not be sent, so it was withdrawn. Try again.",
    });

    const res = await post({ programId: 3, entries: [{ email: "amina@example.org" }] });
    const body = (await res.json()) as Result;

    expect(body.invited).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.outcomes[0].detail).toMatch(/withdrawn/i);
  });

  it("carries the person's name and programme into the letter", async () => {
    mocks.setSelects([PROGRAMME, [], []]);

    await post({ programId: 3, entries: [{ email: "amina@example.org", name: "Amina Bello" }] });

    expect(mocks.deliverInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "amina@example.org",
        name: "Amina Bello",
        programmeTitle: "Energy Reporting",
        role: "learner",
      }),
    );
  });
});
