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
  /*
   * Answers queries by which table they are against, not by the order they
   * arrive in.
   *
   * The Studio writes the next development in the background now, so a request
   * and the work it started are both talking to the database at once and the
   * order is genuinely undefined. A queue of results keyed by call order was
   * fine before that and is a coin toss after it.
   */
  let rows: Record<string, unknown[]> = {};
  let updates: unknown[][] = [];
  let user: { id: number; role: string } | null = { id: 5, role: "learner" };

  const thenable = (get: () => unknown[]) => {
    let table = "";
    const builder: Record<string, unknown> = {};
    for (const key of ["where", "leftJoin", "innerJoin", "orderBy", "returning", "limit", "for", "values", "set", "onConflictDoUpdate", "onConflictDoNothing"]) {
      builder[key] = () => builder;
    }
    builder.from = (t: unknown) => { table = (t as { __name?: string })?.__name ?? ""; return builder; };
    builder.then = (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(get.length === 0 ? get() : (get as (t: string) => unknown[])(table)).then(resolve, reject);
    return builder;
  };

  const selectFor = (table: string) => rows[table] ?? [];

  return {
    db: {
      select: vi.fn(() => thenable(((t: string) => selectFor(t)) as unknown as () => unknown[])),
      insert: vi.fn(() => thenable(() => [])),
      update: vi.fn(() => thenable(() => updates.shift() ?? [])),
      delete: vi.fn(() => thenable(() => [])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
        select: () => thenable(((t: string) => selectFor(t)) as unknown as () => unknown[]),
        insert: () => thenable(() => []),
        update: () => thenable(() => updates.shift() ?? []),
        delete: () => thenable(() => []),
        execute: async () => undefined,
      })),
    },
    getCurrentUser: vi.fn(async () => user),
    setUser(next: { id: number; role: string } | null) { user = next; },
    /** What each table returns, for as long as the test runs. */
    setRows(next: Record<string, unknown[]>) { rows = { ...next }; },
    setUpdates(next: unknown[][]) { updates = [...next]; },
    reset() { rows = {}; updates = []; user = { id: 5, role: "learner" }; },
  };
});

vi.mock("@workspace/db", () => {
  // Inside the factory: vi.mock is hoisted above every top-level declaration.
  const table = (name: string, columns: Record<string, string>) => ({ __name: name, ...columns });
  return ({
  db: mocks.db,
  pendingInvitationsTable: table("pendingInvitations", { id: "id", acceptedByUserId: "accepted_by_user_id", role: "role" }),
  studioAccessCodesTable: table("studioAccessCodes", { id: "id", codeHash: "code_hash", createdByUserId: "created_by", redeemedByUserId: "redeemed_by", redeemedAt: "redeemed_at" }),
  simulationDefinitionsTable: table("simulationDefinitions", { id: "id", ownerId: "owner_id", createdAt: "created_at" }),
  simulationRunsTable: table("simulationRuns", { id: "id", ownerId: "owner_id", joinCode: "join_code", status: "status", definitionId: "definition_id" }),
  simulationGroupAssignmentsTable: table("simulationGroupAssignments", { id: "id", runId: "run_id", userId: "user_id", groupId: "group_id" }),
  simulationResponsesTable: table("simulationResponses", { id: "id", runId: "run_id", groupId: "group_id", injectId: "inject_id", createdAt: "created_at" }),
  enrollmentsTable: table("enrollments", { userId: "user_id", programId: "program_id", status: "status" }),
  programsTable: table("programs", { id: "id", title: "title", description: "description", tag: "tag" }),
  sessionsTable: table("sessions", { id: "id", programId: "program_id", title: "title", startsAt: "starts_at" }),
  usersTable: table("users", { id: "id", name: "name", email: "email" }),
  });
});
vi.mock("../lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("../lib/email", () => ({ emailConfigured: () => false, sendEmail: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const ai = vi.hoisted(() => ({
  generateScenario: vi.fn(),
  generateDevelopment: vi.fn(async () => ({ ok: true, value: { id: "turn-2", title: "Next", source: "Wire", channel: "wire", content: "c", responsePrompt: "p" } })),
  generateDebrief: vi.fn(async () => ({ ok: true, value: { score: 60, headline: "h", ratings: [], strengths: [], risks: [], stakeholderImpact: "s", recommendations: [] } })),
}));
vi.mock("../lib/simulationAi", () => ({ simulationAiConfigured: () => true, ...ai }));

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
      mocks.setRows({});
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
    mocks.setRows({});
    const res = await fetch(`${baseUrl}/api/simulations`);
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toMatch(/invitation or access code/i);
  });

  it("lets an admin straight in", async () => {
    mocks.setUser({ id: 1, role: "admin" });
    mocks.setRows({});
    const res = await fetch(`${baseUrl}/api/simulations`);
    expect(res.status).toBe(200);
  });

  it("lets a super admin in too", async () => {
    // Same rule as everywhere else: a super admin's row does not say "admin".
    mocks.setUser({ id: 2, role: "superadmin" });
    mocks.setRows({});
    const res = await fetch(`${baseUrl}/api/simulations`);
    expect(res.status).toBe(200);
  });

  it("lets a learner in once a code is redeemed against their account", async () => {
    mocks.setUser({ id: 5, role: "learner" });
    mocks.setRows({ studioAccessCodes: [{ id: 9 }] });
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


describe("a solo exercise carries itself", () => {
  const RUN = {
    id: 1, ownerId: 5, definitionId: 2, status: "active", responseVersion: 0,
    operationToken: null, operationStartedAt: null,
    currentDevelopment: { id: "opening", title: "t", content: "c", responsePrompt: "p" },
    developments: [{ id: "opening", title: "t", content: "c", responsePrompt: "p" }],
    debrief: null, joinCode: null,
  };
  const DEFINITION = {
    id: 2, ownerId: 5, programId: null, published: false, durationMinutes: 30,
    openingBrief: "b", participantPerspective: "spokesperson", groups: [{ id: "g", name: "G", roleName: "r", confidentialBrief: "x" }],
    injects: [{ id: "opening", title: "t", content: "c", responsePrompt: "p" }],
    evaluationDimensions: [], debriefQuestions: [], title: "T", context: "", learningObjective: "",
    difficulty: "intermediate", mode: "autonomous", createdAt: new Date(),
  };
  const ASSIGNMENT = { runId: 1, userId: 5, groupId: "g", assignedAt: new Date() };
  const ANSWER = { runId: 1, groupId: "g", injectId: "opening", body: "we are investigating", authorId: 5, createdAt: new Date(), updatedAt: new Date() };

  function answer() {
    return fetch(`${baseUrl}/api/simulation-runs/1/response`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "we are investigating" }),
    });
  }

  beforeEach(() => {
    mocks.setUser({ id: 5, role: "admin" });
    ai.generateDevelopment.mockClear();
    ai.generateDebrief.mockClear();
  });

  it("writes what happens next the moment an answer lands, with nothing to press", async () => {
    const solo = { ...RUN, mode: "autonomous" };
    mocks.setRows({
      simulationRuns: [solo], simulationDefinitions: [DEFINITION],
      simulationGroupAssignments: [ASSIGNMENT], simulationResponses: [ANSWER],
    });
    mocks.setUpdates([[solo], [{ ...solo, operationToken: "t" }], [solo]]);

    const res = await answer();
    expect(res.status).toBe(200);
    expect(ai.generateDevelopment, "a solo run should not wait to be told to continue").toHaveBeenCalledTimes(1);
  });

  it("does not carry a room forward, because the facilitator decides that", async () => {
    // Everybody in a room has to be on the same development at the same time.
    const room = { ...RUN, mode: "facilitated", joinCode: "KD7X9M" };
    mocks.setRows({
      simulationRuns: [room], simulationDefinitions: [DEFINITION],
      simulationGroupAssignments: [ASSIGNMENT], simulationResponses: [ANSWER],
    });
    mocks.setUpdates([[room]]);

    const res = await answer();
    expect(res.status).toBe(200);
    expect(ai.generateDevelopment).not.toHaveBeenCalled();
  });
});


describe("the clock, on the way in and out", () => {
  const DEFINITION = {
    id: 2, ownerId: 5, programId: null, published: false, durationMinutes: 30,
    openingBrief: "b", participantPerspective: "spokesperson",
    groups: [{ id: "g", name: "G", roleName: "r", confidentialBrief: "x" }],
    injects: [{ id: "opening", title: "t", content: "c", responsePrompt: "p", responseSeconds: 240 }],
    evaluationDimensions: [], debriefQuestions: [], title: "T", context: "", learningObjective: "",
    difficulty: "intermediate", mode: "autonomous", createdAt: new Date(),
  };
  const ASSIGNMENT = { runId: 1, userId: 5, groupId: "g", assignedAt: new Date() };

  function runRow(over: Record<string, unknown> = {}) {
    return {
      id: 1, ownerId: 5, definitionId: 2, mode: "autonomous", status: "active", responseVersion: 0,
      operationToken: null, operationStartedAt: null, joinCode: null, debrief: null,
      startedAt: new Date(), endedAt: null,
      currentDevelopment: { id: "opening", title: "t", content: "c", responsePrompt: "p", responseSeconds: 240, dueAt: new Date(Date.now() + 240_000).toISOString() },
      developments: [{ id: "opening", title: "t", content: "c", responsePrompt: "p" }],
      ...over,
    };
  }

  beforeEach(() => {
    mocks.setUser({ id: 5, role: "admin" });
    ai.generateDevelopment.mockClear();
    ai.generateDebrief.mockClear();
  });

  it("tells the browser how long is left, on both clocks", async () => {
    const run = runRow();
    mocks.setRows({ simulationRuns: [run], simulationDefinitions: [DEFINITION], simulationGroupAssignments: [ASSIGNMENT] });
    const res = await fetch(`${baseUrl}/api/simulation-runs/1`);
    expect(res.status).toBe(200);
    const body = await res.json() as { clock: { sessionSecondsLeft: number; responseSecondsLeft: number } };
    expect(body.clock.responseSecondsLeft).toBeGreaterThan(200);
    expect(body.clock.sessionSecondsLeft).toBeGreaterThan(1700);
  });

  it("ends an exercise whose time is up, the moment somebody looks", async () => {
    // There is no background job. Opening it is when the clock bites.
    const over = runRow({ startedAt: new Date(Date.now() - 60 * 60_000) });
    mocks.setRows({ simulationRuns: [over], simulationDefinitions: [DEFINITION], simulationGroupAssignments: [ASSIGNMENT] });
    mocks.setUpdates([[{ ...over, operationToken: "t" }], [{ ...over, status: "completed" }]]);

    const res = await fetch(`${baseUrl}/api/simulation-runs/1`);
    expect(res.status).toBe(200);
    expect(ai.generateDebrief, "an exercise past its time should end itself").toHaveBeenCalledTimes(1);
  });

  it("moves a solo run past a deadline nobody answered", async () => {
    const late = runRow({ currentDevelopment: { id: "opening", title: "t", content: "c", responsePrompt: "p", dueAt: new Date(Date.now() - 5000).toISOString() } });
    mocks.setRows({ simulationRuns: [late], simulationDefinitions: [DEFINITION], simulationGroupAssignments: [ASSIGNMENT] });
    mocks.setUpdates([[{ ...late, operationToken: "t" }], [late]]);

    const res = await fetch(`${baseUrl}/api/simulation-runs/1`);
    expect(res.status).toBe(200);
    expect(ai.generateDevelopment, "the story should run without them").toHaveBeenCalledTimes(1);
  });

  it("leaves a room alone when a deadline passes, because the facilitator decides", async () => {
    const room = runRow({ mode: "facilitated", currentDevelopment: { id: "opening", title: "t", content: "c", responsePrompt: "p", dueAt: new Date(Date.now() - 5000).toISOString() } });
    mocks.setRows({ simulationRuns: [room], simulationDefinitions: [DEFINITION], simulationGroupAssignments: [ASSIGNMENT] });
    const res = await fetch(`${baseUrl}/api/simulation-runs/1`);
    expect(res.status).toBe(200);
    expect(ai.generateDevelopment).not.toHaveBeenCalled();
    expect(ai.generateDebrief).not.toHaveBeenCalled();
  });
});
