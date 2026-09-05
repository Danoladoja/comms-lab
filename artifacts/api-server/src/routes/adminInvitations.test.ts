import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sending an unanswered invitation again, exercised over real HTTP.
 *
 * Three things here are worth a test, and none of them is the happy path.
 *
 * The first is that a resend never leaves two live links to one inbox. The
 * whole invitation system is built on one address having at most one live
 * ticket, recorded, so it can be taken back; a resend that mints a second link
 * without withdrawing the first breaks that quietly and permanently.
 *
 * The second is that a resend never becomes the back door for admin. An invited
 * admin travels to Clerk as a facilitator and is raised on arrival from our own
 * row, which only this server writes. A resend that passed "admin" through to
 * Clerk would put the one role that can delete a programme onto a link sitting
 * in an inbox.
 *
 * The third is that a live link is never left unrecorded. If the row cannot be
 * updated after the email has gone, the link is withdrawn again rather than
 * left in the wild with nothing pointing at it.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    usersTable: { id: "id", email: "email", role: "role", name: "name" },
    programsTable: { id: "id", title: "title", startDate: "startDate" },
    enrollmentsTable: { userId: "userId", programId: "programId" },
    pendingInvitationsTable: {
      id: "id", email: "email", role: "role", sessionIds: "sessionIds",
      programId: "programId", clerkInvitationId: "clerkInvitationId",
      createdAt: "createdAt", acceptedAt: "acceptedAt",
    },
    sessionsTable: { id: "id", programId: "programId", instructorId: "instructorId" },
  };

  let selectResults: unknown[][] = [];
  let updateResults: unknown[][] = [];
  let updateFails = false;

  const thenable = (get: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const key of [
      "from", "where", "values", "set", "leftJoin", "innerJoin", "orderBy",
      "onConflictDoUpdate", "onConflictDoNothing", "returning", "limit",
    ]) {
      builder[key] = () => builder;
    }
    builder.then = (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(get()).then(resolve, reject);
    return builder;
  };

  return {
    db: {
      select: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      insert: vi.fn(() => thenable(() => [])),
      update: vi.fn(() => thenable(() => {
        if (updateFails) throw new Error("the database said no");
        return updateResults.shift() ?? [];
      })),
      delete: vi.fn(() => thenable(() => [])),
    },
    deliverInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
    invitesConfigured: vi.fn(() => true),
    getCurrentUser: vi.fn(async () => ({ id: 1, role: "superadmin" })),
    currentRole: vi.fn(async () => "superadmin"),
    founderId: vi.fn(async () => 1),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    setUpdates(rows: unknown[][]) { updateResults = [...rows]; },
    failUpdates(on: boolean) { updateFails = on; },
    tables,
  };
});

vi.mock("@workspace/db", () => ({ db: mocks.db, ...mocks.tables }));
vi.mock("../lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  currentRole: mocks.currentRole,
  founderId: mocks.founderId,
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/clerkInvites", () => ({
  invitesConfigured: mocks.invitesConfigured,
  revokeInvitation: mocks.revokeInvitation,
}));
vi.mock("../lib/invitationDelivery", () => ({ deliverInvitation: mocks.deliverInvitation }));
vi.mock("../lib/enrollmentEmails", () => ({ sendWaitlistPromotion: vi.fn() }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import adminRouter from "./admin";

/** One unanswered learner invitation, as the route's joined select returns it. */
const PENDING_LEARNER = {
  id: 7,
  email: "amina@example.org",
  role: "learner",
  sessionIds: [],
  programId: 3,
  programTitle: "Energy Reporting Foundations",
  programStart: "Nov 2026",
  clerkInvitationId: "inv_old",
  createdAt: new Date("2026-08-01T09:00:00Z"),
  acceptedAt: null,
};

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

const resend = (id: number) =>
  fetch(`${baseUrl}/api/admin/invitations/${id}/resend`, { method: "POST" });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.invitesConfigured.mockReturnValue(true);
  mocks.revokeInvitation.mockResolvedValue("revoked");
  mocks.deliverInvitation.mockResolvedValue({ ok: true, invitationId: "inv_new", sentBy: "us" });
  mocks.setSelects([]);
  mocks.setUpdates([]);
  mocks.failUpdates(false);

  const app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

describe("POST /admin/invitations/:id/resend", () => {
  it("withdraws the old link before minting a new one", async () => {
    mocks.setSelects([[PENDING_LEARNER]]);
    mocks.setUpdates([[{ ...PENDING_LEARNER, clerkInvitationId: "inv_new", createdAt: new Date() }]]);

    const res = await resend(7);
    expect(res.status).toBe(200);

    expect(mocks.revokeInvitation).toHaveBeenCalledWith("inv_old");
    expect(mocks.deliverInvitation).toHaveBeenCalledTimes(1);

    // Order matters, not just the fact of both happening: minting first would
    // leave two live links to the same inbox if the withdrawal then failed.
    const revokedAt = mocks.revokeInvitation.mock.invocationCallOrder[0];
    const sentAt = mocks.deliverInvitation.mock.invocationCallOrder[0];
    expect(revokedAt).toBeLessThan(sentAt);
  });

  it("carries the learner's programme into the letter", async () => {
    mocks.setSelects([[PENDING_LEARNER]]);
    mocks.setUpdates([[PENDING_LEARNER]]);

    await resend(7);

    expect(mocks.deliverInvitation).toHaveBeenCalledWith(expect.objectContaining({
      email: "amina@example.org",
      role: "learner",
      programmeTitle: "Energy Reporting Foundations",
      programmeStart: "Nov 2026",
    }));
  });

  it("sends nothing when the old link cannot be withdrawn", async () => {
    mocks.setSelects([[PENDING_LEARNER]]);
    mocks.revokeInvitation.mockResolvedValue("failed");

    const res = await resend(7);

    expect(res.status).toBe(502);
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
  });

  it("refuses an invitation that has already been accepted", async () => {
    mocks.setSelects([[{ ...PENDING_LEARNER, acceptedAt: new Date("2026-08-02T09:00:00Z") }]]);

    const res = await resend(7);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/already accepted/i);
    expect(mocks.revokeInvitation).not.toHaveBeenCalled();
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
  });

  it("records the truth when Clerk says the link was already spent", async () => {
    mocks.setSelects([[PENDING_LEARNER]]);
    mocks.revokeInvitation.mockResolvedValue("already-accepted");

    const res = await resend(7);

    expect(res.status).toBe(400);
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
    // The row is marked accepted, so the console stops offering to resend it.
    expect(mocks.db.update).toHaveBeenCalled();
  });

  it("never puts admin on a link, even when resending an admin invitation", async () => {
    mocks.setSelects([[{ ...PENDING_LEARNER, role: "admin", programId: null, programTitle: null, programStart: null }]]);
    mocks.setUpdates([[PENDING_LEARNER]]);

    await resend(7);

    const args = mocks.deliverInvitation.mock.calls[0]![0] as { role: string; describeAs: string };
    // Clerk is told facilitator; the letter still says admin, so nobody is told
    // one thing and handed another.
    expect(args.role).toBe("instructor");
    expect(args.describeAs).toBe("admin");
  });

  it("takes the new link back if it cannot be recorded", async () => {
    mocks.setSelects([[PENDING_LEARNER]]);
    mocks.failUpdates(true);

    const res = await resend(7);

    expect(res.status).toBe(500);
    // Withdrawn twice: the old link before sending, the new one after failing.
    expect(mocks.revokeInvitation).toHaveBeenCalledWith("inv_new");
  });

  it("is a 404 for an invitation that is not there", async () => {
    mocks.setSelects([[]]);

    const res = await resend(999);

    expect(res.status).toBe(404);
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
  });

  it("says so plainly when Clerk is not configured", async () => {
    mocks.invitesConfigured.mockReturnValue(false);

    const res = await resend(7);

    expect(res.status).toBe(503);
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
  });
});

/**
 * Sending several again at once.
 *
 * The batch shares its whole implementation with the single resend, which is
 * the point: it is the obvious place for "withdraw the old link first" or
 * "never let an admin invitation carry admin to Clerk" to get quietly dropped
 * by a second, hastier implementation. These tests hold it to the same rules,
 * and to the one rule that is its own: nobody's failure takes the others down.
 */
describe("POST /admin/invitations/resend-batch", () => {
  const batch = (ids: unknown) =>
    fetch(`${baseUrl}/api/admin/invitations/resend-batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });

  const another = { ...PENDING_LEARNER, id: 8, email: "kwame@example.org", clerkInvitationId: "inv_old_8" };

  it("sends to everybody asked for", async () => {
    mocks.setSelects([[PENDING_LEARNER], [another]]);
    mocks.setUpdates([[PENDING_LEARNER], [another]]);

    const res = await batch([7, 8]);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { sent: number; failed: number; outcomes: { email: string; status: string }[] };
    expect(body.sent).toBe(2);
    expect(body.failed).toBe(0);
    expect(mocks.deliverInvitation).toHaveBeenCalledTimes(2);
  });

  it("lets one failure alone rather than taking the rest with it", async () => {
    // The middle one has already been accepted, which the single path refuses.
    mocks.setSelects([
      [PENDING_LEARNER],
      [{ ...another, acceptedAt: new Date("2026-08-02T09:00:00Z") }],
      [{ ...another, id: 9, email: "ngozi@example.org" }],
    ]);
    mocks.setUpdates([[PENDING_LEARNER], [another]]);

    const body = (await (await batch([7, 8, 9])).json()) as {
      sent: number; failed: number;
      outcomes: { id: number; email: string; status: string; detail: string }[];
    };

    expect(body.sent).toBe(2);
    expect(body.failed).toBe(1);
    // And it says which one, and why — "2 of 3 sent" leaves an admin hunting.
    const failure = body.outcomes.find((o) => o.status === "failed")!;
    expect(failure.id).toBe(8);
    expect(failure.email).toBe("kwame@example.org");
    expect(failure.detail).toMatch(/already accepted/i);
  });

  it("withdraws each old link before minting its replacement", async () => {
    mocks.setSelects([[PENDING_LEARNER], [another]]);
    mocks.setUpdates([[PENDING_LEARNER], [another]]);

    await batch([7, 8]);

    expect(mocks.revokeInvitation).toHaveBeenCalledWith("inv_old");
    expect(mocks.revokeInvitation).toHaveBeenCalledWith("inv_old_8");
    // Every send is preceded by a withdrawal, not merely accompanied by one.
    for (const send of mocks.deliverInvitation.mock.invocationCallOrder) {
      const revokesBefore = mocks.revokeInvitation.mock.invocationCallOrder.filter((at) => at < send);
      expect(revokesBefore.length).toBeGreaterThan(0);
    }
  });

  it("never puts admin on a link here either", async () => {
    mocks.setSelects([[{ ...PENDING_LEARNER, role: "admin", programId: null, programTitle: null, programStart: null }]]);
    mocks.setUpdates([[PENDING_LEARNER]]);

    await batch([7]);

    const args = mocks.deliverInvitation.mock.calls[0]![0] as { role: string; describeAs: string };
    expect(args.role).toBe("instructor");
    expect(args.describeAs).toBe("admin");
  });

  it("sends one after another rather than all at once", async () => {
    // Parallel is faster and is also the quickest way to be rate-limited
    // halfway through with nobody able to say who was sent to.
    let inFlight = 0;
    let mostAtOnce = 0;
    mocks.deliverInvitation.mockImplementation(async () => {
      inFlight += 1;
      mostAtOnce = Math.max(mostAtOnce, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { ok: true, invitationId: "inv_new", sentBy: "us" };
    });
    mocks.setSelects([[PENDING_LEARNER], [another], [{ ...another, id: 9 }]]);
    mocks.setUpdates([[PENDING_LEARNER], [another], [another]]);

    await batch([7, 8, 9]);

    expect(mostAtOnce).toBe(1);
  });

  it("asks for at least one, and refuses an implausible number", async () => {
    expect((await batch([])).status).toBe(400);
    expect((await batch(["nonsense"])).status).toBe(400);
    expect((await batch(Array.from({ length: 60 }, (_, i) => i + 1))).status).toBe(400);
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
  });

  it("ignores a duplicate id rather than sending twice to one inbox", async () => {
    mocks.setSelects([[PENDING_LEARNER]]);
    mocks.setUpdates([[PENDING_LEARNER]]);

    const body = (await (await batch([7, 7, 7])).json()) as { sent: number };

    expect(body.sent).toBe(1);
    expect(mocks.deliverInvitation).toHaveBeenCalledTimes(1);
  });

  it("says so plainly when Clerk is not configured", async () => {
    mocks.invitesConfigured.mockReturnValue(false);
    expect((await batch([7, 8])).status).toBe(503);
    expect(mocks.deliverInvitation).not.toHaveBeenCalled();
  });
});
