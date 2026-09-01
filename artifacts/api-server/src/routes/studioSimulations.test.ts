import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Studio's gate, over real HTTP.
 *
 * This file exists because of one bug, and its whole job is to stop that bug
 * coming back.
 *
 * The Studio needs an invitation or an access code. That gate was added as
 * `router.use(requireStudioAccess)` inside this router. This router is mounted
 * without a path prefix, alongside every other router, and above reviews,
 * presence, slides, the forum, the admin API and the public partnership form.
 * A bare `use` runs for every request that reaches the router and matches no
 * route in it, so it refused all of those, for every learner, while leaving
 * admins working perfectly. It reached production.
 *
 * So the tests below check two things that are easy to say and were expensive
 * to learn: a learner without a code cannot open the Studio, and nothing else
 * in the API is touched by that refusal.
 */

const mocks = vi.hoisted(() => {
  let selectResults: unknown[][] = [];
  let user: { id: number; role: string } | null = { id: 5, role: "learner" };

  const thenable = (get: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const key of ["from", "where", "leftJoin", "innerJoin", "orderBy", "returning", "limit", "for", "values", "set", "onConflictDoUpdate", "onConflictDoNothing"]) {
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
      update: vi.fn(() => thenable(() => [])),
      delete: vi.fn(() => thenable(() => [])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
        select: () => thenable(() => selectResults.shift() ?? []),
        insert: () => thenable(() => []),
        update: () => thenable(() => []),
        delete: () => thenable(() => []),
        execute: async () => undefined,
      })),
    },
    getCurrentUser: vi.fn(async () => user),
    setUser(next: { id: number; role: string } | null) { user = next; },
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    reset() { selectResults = []; user = { id: 5, role: "learner" }; },
  };
});

vi.mock("@workspace/db", () => ({
  db: mocks.db,
  pendingInvitationsTable: { id: "id", acceptedByUserId: "accepted_by_user_id", role: "role" },
  studioAccessCodesTable: { id: "id", codeHash: "code_hash", createdByUserId: "created_by", redeemedByUserId: "redeemed_by", redeemedAt: "redeemed_at" },
  simulationDefinitionsTable: { id: "id", ownerId: "owner_id", createdAt: "created_at" },
  simulationRunsTable: { id: "id", ownerId: "owner_id", joinCode: "join_code", status: "status", definitionId: "definition_id" },
  simulationGroupAssignmentsTable: { id: "id", runId: "run_id", userId: "user_id", groupId: "group_id" },
  simulationResponsesTable: { id: "id", runId: "run_id", groupId: "group_id", injectId: "inject_id", createdAt: "created_at" },
}));
vi.mock("../lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../lib/simulationAi", () => ({
  simulationAiConfigured: () => true,
  generateScenario: vi.fn(),
  generateDevelopment: vi.fn(),
  generateDebrief: vi.fn(),
}));

import studioRouter from "./studioSimulations";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

/** Stands in for every router mounted after this one in routes/index.ts. */
const NEIGHBOURS = ["/api/reviews/queue", "/api/partnership-enquiries", "/api/sessions/1/slides", "/api/admin/staff"];

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.reset();

  const app = express();
  app.use(express.json());
  app.use("/api", studioRouter);
  // Everything registered after the Studio router. If the Studio's gate ever
  // reaches past its own routes again, these stop answering.
  for (const path of NEIGHBOURS) app.all(path, (_req, res) => { res.json({ reached: true }); });

  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

describe("the Studio gate stays inside the Studio", () => {
  it("lets a learner with no Studio access reach the rest of the API", async () => {
    mocks.setUser({ id: 5, role: "learner" });
    for (const path of NEIGHBOURS) {
      mocks.setSelects([[], []]);
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status, `${path} was blocked by the Studio gate`).toBe(200);
      expect(await res.json()).toEqual({ reached: true });
    }
  });

  it("lets a signed-out visitor reach the public parts of the API", async () => {
    // The partnership enquiry form is on the public site and takes no account.
    mocks.setUser(null);
    const res = await fetch(`${baseUrl}/api/partnership-enquiries`, { method: "POST" });
    expect(res.status).toBe(200);
  });
});

describe("the Studio gate itself", () => {
  it("refuses a learner with no invitation and no code", async () => {
    mocks.setUser({ id: 5, role: "learner" });
    mocks.setSelects([[], []]);
    const res = await fetch(`${baseUrl}/api/simulations`);
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toMatch(/invitation or access code/i);
  });

  it("lets an admin straight in", async () => {
    mocks.setUser({ id: 1, role: "admin" });
    mocks.setSelects([[]]);
    const res = await fetch(`${baseUrl}/api/simulations`);
    expect(res.status).toBe(200);
  });

  it("lets a super admin in too", async () => {
    // Same rule as everywhere else: a super admin's row does not say "admin".
    mocks.setUser({ id: 2, role: "superadmin" });
    mocks.setSelects([[]]);
    const res = await fetch(`${baseUrl}/api/simulations`);
    expect(res.status).toBe(200);
  });

  it("lets a learner in once a code is redeemed against their account", async () => {
    mocks.setUser({ id: 5, role: "learner" });
    mocks.setSelects([[], [{ id: 9 }], []]);
    const res = await fetch(`${baseUrl}/api/simulations`);
    expect(res.status).toBe(200);
  });

  it("asks a signed-out visitor to sign in rather than refusing them", async () => {
    mocks.setUser(null);
    const res = await fetch(`${baseUrl}/api/simulations`);
    expect(res.status).toBe(401);
  });

  it("does not let a learner mint access codes", async () => {
    mocks.setUser({ id: 5, role: "learner" });
    const res = await fetch(`${baseUrl}/api/studio/access-codes`, { method: "POST" });
    expect(res.status).toBe(403);
  });
});
