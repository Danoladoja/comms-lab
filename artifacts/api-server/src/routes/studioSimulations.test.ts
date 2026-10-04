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
  // Admission now turns on a Studio invitation rather than on having once been
  // invited to the Lab. Everything on the row the rules read is here, because
  // a missing column in a mock reads as a 500 rather than as a refusal.
  studioInvitationsTable: table("studioInvitations", {
    id: "id", userId: "user_id", programId: "program_id", sessionId: "session_id",
    objective: "objective", situationSeed: "situation_seed", difficulty: "difficulty",
    durationMinutes: "duration_minutes", invitedByUserId: "invited_by_user_id",
    definitionId: "definition_id", runId: "run_id", startedAt: "started_at",
    completedAt: "completed_at", expiresAt: "expires_at", createdAt: "created_at",
  }),
  // The fourth way into the Studio: being on the cohort of an approved group
  // session, which invites nobody by name. Every column the gate reads is here,
  // because a missing one in a mock reads as a 500 rather than as a refusal.
  studioGroupSessionsTable: table("studioGroupSessions", {
    id: "id", programId: "program_id", definitionId: "definition_id", title: "title",
    objectives: "objectives", beats: "beats", scheduledAt: "scheduled_at",
    durationMinutes: "duration_minutes", approvedByUserId: "approved_by_user_id",
    approvedAt: "approved_at", runId: "run_id", startedAt: "started_at", endedAt: "ended_at",
    deliveredBeatIds: "delivered_beat_ids", sessionDebrief: "session_debrief",
    createdByUserId: "created_by_user_id", createdAt: "created_at", updatedAt: "updated_at",
  }),
  studioAccessCodesTable: table("studioAccessCodes", { id: "id", source: "source", codeHash: "code_hash", createdByUserId: "created_by", redeemedByUserId: "redeemed_by", redeemedAt: "redeemed_at" }),
  simulationDefinitionsTable: table("simulationDefinitions", { id: "id", ownerId: "owner_id", createdAt: "created_at" }),
  simulationRunsTable: table("simulationRuns", { id: "id", ownerId: "owner_id", joinCode: "join_code", status: "status", definitionId: "definition_id" }),
  simulationGroupAssignmentsTable: table("simulationGroupAssignments", { id: "id", runId: "run_id", userId: "user_id", groupId: "group_id" }),
  simulationResponsesTable: table("simulationResponses", { id: "id", runId: "run_id", groupId: "group_id", injectId: "inject_id", createdAt: "created_at" }),
  enrollmentsTable: table("enrollments", { userId: "user_id", programId: "program_id", status: "status" }),
  programsTable: table("programs", { id: "id", title: "title", description: "description", tag: "tag" }),
  sessionsTable: table("sessions", { id: "id", programId: "program_id", title: "title", startsAt: "starts_at" }),
  usersTable: table("users", { id: "id", name: "name", email: "email" }),
  // Read by programmeContext, which every planning request goes through. Absent
  // from this mock, so the two tests that reach it got a 500 instead of the
  // refusal they were checking for — the same shape of problem as the comments
  // above, for the same reason.
  assignmentsTable: table("assignments", { id: "id", sessionId: "session_id", title: "title", draft: "draft" }),
  sessionReadingsTable: table("sessionReadings", { id: "id", sessionId: "session_id", title: "title", sortOrder: "sort_order" }),
  });
});
vi.mock("../lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("../lib/email", () => ({ emailConfigured: () => false, sendEmail: vi.fn() }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const ai = vi.hoisted(() => ({
  generateScenario: vi.fn(),
  // Was missing, and so was every test that would have needed it: the route
  // that plans a group session had no coverage at all, which is how five
  // different refusals came to share one unreportable sentence on the screen.
  generateGroupPlan: vi.fn(),
  generateDevelopment: vi.fn(async () => ({ ok: true, value: { id: "turn-2", title: "Next", source: "Wire", channel: "wire", content: "c", responsePrompt: "p" } })),
  generateDebrief: vi.fn(async () => ({ ok: true, value: { score: 60, headline: "h", ratings: [], strengths: [], risks: [], stakeholderImpact: "s", recommendations: [] } })),
}));
// Switchable, because "there is no AI key on this server" is one of the ways
// planning is refused and it has to be reachable from a test.
const aiKey = vi.hoisted(() => ({ present: true }));
vi.mock("../lib/simulationAi", () => ({ simulationAiConfigured: () => aiKey.present, ...ai }));

import studioRouter from "./studioSimulations";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

/** Stands in for every router mounted after this one in routes/index.ts. */
const NEIGHBOURS = ["/api/reviews/queue", "/api/partnership-enquiries", "/api/sessions/1/slides", "/api/admin/staff"];

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.reset();
  aiKey.present = true;

  const app = express();
  app.use(express.json());
  // Stands in for pino-http, which runs ahead of every router in the real
  // server. Without it a handler that logs throws, and the test reads an HTML
  // 500 instead of the refusal it was checking for.
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    };
    next();
  });
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
  it("refuses an enrolled learner with no Studio invitation and no code", async () => {
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

  it("lets a learner in for their cohort's group session, which invites nobody by name", async () => {
    // The fourth door. A group session has no join code and sends no individual
    // invitation — the cohort is the room — so the approval is the invitation.
    // Without this the ticker puts somebody in a team and the Studio then
    // refuses them at the door.
    mocks.setUser({ id: 5, role: "learner" });
    mocks.setRows({ studioGroupSessions: [{ session: { id: 3, approvedAt: new Date() } }] });
    const res = await fetch(`${baseUrl}/api/simulations`);
    expect(res.status).toBe(200);
  });

  it("does not put the form in front of a cohort let in by the admin", async () => {
    /*
     * The quiet one, and the reason this test exists.
     *
     * "Open the Studio to this programme" admits a whole cohort by writing an
     * access-code row per learner, because that is where admission is recorded.
     * Every check that asked "do they have an invitation" read those learners
     * as outsiders who had typed a code, and handed them the five-field form —
     * which is the unbounded spending the invitation was built to end.
     */
    mocks.setUser({ id: 5, role: "learner" });
    mocks.setRows({ studioAccessCodes: [{ id: 9, source: "cohort" }] });
    const res = await fetch(`${baseUrl}/api/simulations/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sectorTopic: "A pipeline leak", objective: "Say the hard number first",
        difficulty: "intermediate", durationMinutes: 30,
        participantPerspective: "Head of Communications", mode: "autonomous",
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toMatch(/come from your programme/i);
  });

  it("still lets an outsider who typed a code write their own", async () => {
    // They are on no programme, so there is no programme to choose for them.
    // Taking the form away from them would leave them with an empty Studio.
    mocks.setUser({ id: 5, role: "learner" });
    mocks.setRows({ studioAccessCodes: [{ id: 9, source: "code" }] });
    ai.generateScenario.mockResolvedValueOnce({ ok: false, error: "not today" });
    mocks.setUpdates([]);
    const res = await fetch(`${baseUrl}/api/simulations/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sectorTopic: "A pipeline leak", objective: "Say the hard number first",
        difficulty: "intermediate", durationMinutes: 30,
        participantPerspective: "Head of Communications", mode: "autonomous",
      }),
    });
    // Reached the model, which is as far as this test needs it to get.
    expect(res.status).toBe(502);
  });

  it("tells a learner on a cohort that their exercise is sent, not chosen", async () => {
    mocks.setUser({ id: 5, role: "learner" });
    mocks.setRows({ studioAccessCodes: [{ id: 9, source: "cohort" }] });
    const res = await fetch(`${baseUrl}/api/studio/my-exercise`);
    expect(res.status).toBe(200);
    const body = await res.json() as { hasInvitation: boolean; awaiting: boolean };
    // Without this the Studio is blank for them, which reads as broken.
    expect(body.hasInvitation).toBe(false);
    expect(body.awaiting).toBe(true);
  });

  it("does not let that learner write an exercise of their own", async () => {
    // In for the session and nothing else. Writing exercises is the expensive
    // thing an invitation exists to govern, and nobody invited this person.
    mocks.setUser({ id: 5, role: "learner" });
    mocks.setRows({ studioGroupSessions: [{ session: { id: 3, approvedAt: new Date() } }] });
    const res = await fetch(`${baseUrl}/api/simulations/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sectorTopic: "A pipeline leak", objective: "Say the hard number first",
        difficulty: "intermediate", durationMinutes: 30,
        participantPerspective: "Head of Communications", mode: "autonomous",
      }),
    });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toMatch(/come from your programme/i);
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

/**
 * Why planning a group session was refused.
 *
 * This route had no tests. Not thin ones — none. It is the longest chain of
 * preconditions in the Lab (a role, a key, a programme, two model calls that
 * each have to come back usable) and every link in it answered with the same
 * four words on the screen, in a toast that cleared itself after four seconds.
 * The report that reached us was "it says cannot plan a group session", which
 * is as much as anybody could carry away, and it narrows the cause to five.
 *
 * So each refusal is pinned to its own status code here, because that is what
 * the screen now turns into a sentence about what to do: 403 is a role, 503 is
 * a missing key, 404 is a programme, 502 is the model. A refusal that came back
 * under the wrong code would send an admin to Railway over a Clerk problem.
 */
describe("planning a group session, and being told why not", () => {
  const PROGRAMME = { id: 1, title: "Energy Communications Intensive", description: "Eight weeks.", tag: "cohort-1" };
  const plan = (body: unknown = { programId: 1 }) => fetch(`${baseUrl}/api/admin/studio/group-sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("refuses a learner with 403, and does not spend a model call finding out", async () => {
    mocks.setUser({ id: 5, role: "learner" });
    const res = await plan();
    expect(res.status).toBe(403);
    expect(ai.generateScenario, "the role is checked before anything is written").not.toHaveBeenCalled();
  });

  it("refuses an instructor with 403 rather than letting them write to a cohort", async () => {
    mocks.setUser({ id: 6, role: "instructor" });
    expect((await plan()).status).toBe(403);
  });

  it("lets an admin and a super admin through the role check", async () => {
    for (const role of ["admin", "superadmin"]) {
      mocks.setUser({ id: 1, role });
      mocks.setRows({ programs: [] });
      // Past the role check and refused later, for a reason that is not the role.
      expect((await plan()).status, `${role} was refused by the role check`).not.toBe(403);
    }
  });

  it("says the server has no AI key, as a 503 rather than as a failure", async () => {
    mocks.setUser({ id: 1, role: "superadmin" });
    aiKey.present = false;
    const res = await plan();
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain("AI key");
  });

  it("refuses a programme that is not there with 404", async () => {
    mocks.setUser({ id: 1, role: "superadmin" });
    mocks.setRows({ programs: [] });
    expect((await plan()).status).toBe(404);
  });

  it("refuses a body with no programme at all with 400", async () => {
    mocks.setUser({ id: 1, role: "superadmin" });
    expect((await plan({})).status).toBe(400);
  });

  it("passes the AI's own reason on, under 502, when the crisis cannot be written", async () => {
    mocks.setUser({ id: 1, role: "superadmin" });
    mocks.setRows({ programs: [PROGRAMME], sessions: [] });
    ai.generateScenario.mockResolvedValueOnce({ ok: false, error: "The AI service is unavailable right now (error 404)." });

    const res = await plan();
    expect(res.status).toBe(502);
    // The sentence an admin reads has to be the server's own, not a summary of
    // it: "error 404" is the difference between a retired model and a bad key,
    // and it is the only clue either way.
    expect((await res.json() as { error: string }).error).toBe("The AI service is unavailable right now (error 404).");
    expect(ai.generateGroupPlan, "the running order is not written for a crisis that was not").not.toHaveBeenCalled();
  });

  it("names the step it crashed at, instead of shrugging", async () => {
    // The fault that started all this: a 500 somewhere in a run of five steps,
    // reported to the admin as "Something went wrong. Please try again." — true
    // of every one of them and useful about none.
    mocks.setUser({ id: 1, role: "superadmin" });
    mocks.setRows({ programs: [PROGRAMME], sessions: [] });
    ai.generateScenario.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "23502" }));

    const res = await plan();
    expect(res.status).toBe(500);
    const said = (await res.json() as { error: string }).error;
    expect(said, "it must say which step").toContain("writing the crisis");
    expect(said, "and what kind of fault").toContain("23502");
    expect(said, "and that nothing reached the cohort").toContain("Nothing was sent to the cohort");
    expect(said, "never the error's own message").not.toContain("boom");
  });

  it("names a crash in the last step as the last step, not the first", async () => {
    // The stage has to move as the run does. A marker set once at the top would
    // send somebody to look at the programme for a fault in the read-back.
    mocks.setUser({ id: 1, role: "superadmin" });
    mocks.setRows({ programs: [PROGRAMME], sessions: [] });
    ai.generateScenario.mockResolvedValueOnce({
      ok: true,
      value: {
        title: "Pipeline leak", openingBrief: "A leak.",
        stakeholderGroups: [{ id: "operator", name: "The operator", roleName: "Lead", confidentialBrief: "b" }],
        initialDevelopment: { id: "opening", title: "t", content: "c", responsePrompt: "p" },
        evaluationDimensions: [{ name: "Speed", description: "d" }],
        debriefQuestions: [],
      },
    });
    ai.generateGroupPlan.mockRejectedValueOnce(new TypeError("nope"));

    const said = (await (await plan()).json() as { error: string }).error;
    expect(said).toContain("writing the running order");
    expect(said).toContain("TypeError");
  });

  it("passes the reason on, under 502, when the running order cannot be written", async () => {
    mocks.setUser({ id: 1, role: "superadmin" });
    mocks.setRows({ programs: [PROGRAMME], sessions: [] });
    ai.generateScenario.mockResolvedValueOnce({
      ok: true,
      value: {
        title: "Pipeline leak", openingBrief: "A leak, and three days of silence.",
        stakeholderGroups: [
          { id: "operator", name: "The operator", roleName: "Head of Communications", confidentialBrief: "You knew." },
          { id: "regulator", name: "The regulator", roleName: "Spokesperson", confidentialBrief: "You did not." },
        ],
        initialDevelopment: { id: "opening", title: "A reporter calls", content: "c", responsePrompt: "p" },
        evaluationDimensions: [{ name: "Speed", description: "d" }],
        debriefQuestions: ["Who first?"],
      },
    });
    ai.generateGroupPlan.mockResolvedValueOnce({ ok: false, error: "The plan came back with nothing that happens to every team." });

    const res = await plan();
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toContain("nothing that happens to every team");
  });
});

describe("what the console can see about the AI", () => {
  it("tells staff whether there is a key, without telling them the key", async () => {
    mocks.setUser({ id: 1, role: "superadmin" });
    const res = await fetch(`${baseUrl}/api/admin/studio/ai`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["concern", "configured", "model"]);
    expect(JSON.stringify(body)).not.toContain("sk-");
  });

  it("is open to instructors, not only admins", async () => {
    // The Forms tab was blank for every admin in the Lab for a fortnight
    // because a staff check was written as satisfiesRole(role, ["instructor"]).
    // This one is the other way round and would be just as wrong.
    for (const role of ["instructor", "admin", "superadmin"]) {
      mocks.setUser({ id: 1, role });
      expect((await fetch(`${baseUrl}/api/admin/studio/ai`)).status, `${role} could not read it`).toBe(200);
    }
  });

  it("is closed to learners", async () => {
    mocks.setUser({ id: 5, role: "learner" });
    expect((await fetch(`${baseUrl}/api/admin/studio/ai`)).status).toBe(403);
  });
});

/**
 * A Group Session's gate has one door.
 *
 * The room screen replaced the answer box in the browser. The route that box
 * used stayed open, and for one patch anybody on a team could call it directly
 * and publish in the team's name with nobody behind the words — past the
 * leader, past the seventy per cent, past the whole point of the room. The
 * browser was the only thing stopping them, which is to say nothing was.
 *
 * Pinned here rather than only in the shape of the code, because the fix is one
 * early return in a long handler and the next person to touch that handler will
 * not know what it is for.
 */
describe("a Group Session cannot be answered around its room", () => {
  const roomSession = { id: 9, runId: 1, format: "room", programId: 1, definitionId: 2 };
  const rapidSession = { ...roomSession, format: "rapid" };

  const run = {
    id: 1, ownerId: 5, definitionId: 2, mode: "facilitated", status: "active", responseVersion: 0,
    operationToken: null, operationStartedAt: null, joinCode: null, debrief: null,
    startedAt: new Date(), endedAt: null,
    currentDevelopment: { id: "opening", title: "t", content: "c", responsePrompt: "p" },
    developments: [],
  };

  const answer = () => fetch(`${baseUrl}/api/simulation-runs/1/response`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ body: "I speak for all of us, apparently." }),
  });

  it("refuses the old answer box, and says where the reply goes instead", async () => {
    mocks.setUser({ id: 7, role: "learner" });
    mocks.setRows({
      simulationRuns: [run],
      simulationGroupAssignments: [{ id: 1, runId: 1, userId: 7, groupId: "operator" }],
      studioGroupSessions: [roomSession],
      studioInvitations: [{ id: 1, userId: 7, programId: 1, expiresAt: null }],
    });

    const res = await answer();
    expect(res.status, "a response got in around the room").toBe(409);
    expect((await res.json() as { error: string }).error).toContain("through your room");
  });

  it("sends a Rapid Response Session down the other path entirely", async () => {
    // The other half of the same rule: closing the door on one shape must not
    // close it on the other, which is the exercise the cohort asks for by name.
    //
    // This mock answers every insert with no rows, which is exactly what
    // Postgres does when somebody else got there first — so a rapid session
    // here reports being beaten rather than saved. That is the wrong outcome
    // for a real first answer and the right proof for this test: it can only
    // be reached down the fastest-finger branch.
    mocks.setUser({ id: 7, role: "learner" });
    mocks.setRows({
      simulationRuns: [run],
      simulationGroupAssignments: [{ id: 1, runId: 1, userId: 7, groupId: "operator" }],
      studioGroupSessions: [rapidSession],
      studioInvitations: [{ id: 1, userId: 7, programId: 1, expiresAt: null }],
    });

    const said = (await (await answer()).json() as { error: string }).error;
    expect(said, "a rapid session was sent to the room").not.toContain("through your room");
    expect(said).toContain("got there first");
  });
});

/**
 * Turning up is the ticket, and it can only be bought while the door is open.
 *
 * The debrief names what a handful of people did under pressure, and a team
 * session puts every enrolled learner into a team whether they come or not. So
 * the rule is that it goes to the people who were in the room — and the record
 * of who was in the room is a timestamp written the first time somebody opens
 * the run.
 *
 * Which was written by *any* read, including one the morning after. Somebody
 * who missed the session entirely, opened the link late and was marked present
 * by the act of looking: the gate would have admitted precisely the people it
 * exists to keep out, and from the outside it would have looked like it worked.
 */
describe("attendance is stamped while it runs, and not after", () => {
  const assignment = { id: 1, runId: 1, userId: 7, groupId: "operator", enteredAt: null };
  const base = {
    id: 1, ownerId: 5, definitionId: 2, mode: "facilitated", joinCode: null, debrief: null,
    responseVersion: 0, operationToken: null, operationStartedAt: null,
    startedAt: new Date(), endedAt: null, teamDebriefs: [],
    currentDevelopment: null, developments: [],
  };

  const open = () => fetch(`${baseUrl}/api/simulation-runs/1`);

  it("marks somebody present when they open a running session", async () => {
    mocks.setUser({ id: 7, role: "learner" });
    mocks.setRows({
      simulationRuns: [{ ...base, status: "active" }],
      simulationDefinitions: [{ id: 2, ownerId: 5, groups: [{ id: "operator", name: "The operator", roleName: "Lead" }], evaluationDimensions: [], debriefQuestions: [], openingBrief: "b", injects: [] }],
      simulationGroupAssignments: [assignment],
      studioInvitations: [{ id: 1, userId: 7, programId: 1, expiresAt: null }],
    });

    await open();
    expect(mocks.db.update, "nobody was marked present on a live session").toHaveBeenCalled();
  });

  it("does not mark somebody present when they open a finished one", async () => {
    mocks.setUser({ id: 7, role: "learner" });
    mocks.setRows({
      simulationRuns: [{ ...base, status: "completed", endedAt: new Date() }],
      simulationDefinitions: [{ id: 2, ownerId: 5, groups: [{ id: "operator", name: "The operator", roleName: "Lead" }], evaluationDimensions: [], debriefQuestions: [], openingBrief: "b", injects: [] }],
      simulationGroupAssignments: [assignment],
      studioInvitations: [{ id: 1, userId: 7, programId: 1, expiresAt: null }],
    });

    await open();
    expect(
      mocks.db.update,
      "reading yesterday's debrief marked somebody as having been there",
    ).not.toHaveBeenCalled();
  });
});
