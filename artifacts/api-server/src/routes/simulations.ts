import { Router, type IRouter } from "express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db, enrollmentsTable, sessionsTable, simulationDefinitionsTable, simulationGroupAssignmentsTable, usersTable,
  simulationInjectReleasesTable, simulationResponsesTable, simulationRunsTable,
} from "@workspace/db";
import {
  AssignSimulationGroupsBody, AssignSimulationGroupsParams, AssignSimulationGroupsResponse,
  GetSimulationStudioParams, GetSimulationStudioResponse, ReleaseNextSimulationInjectParams,
  ReleaseNextSimulationInjectResponse, StartSimulationRunParams, StartSimulationRunResponse,
  TransitionSimulationRunBody, TransitionSimulationRunParams, TransitionSimulationRunResponse,
  UpsertSimulationDefinitionBody, UpsertSimulationDefinitionParams, UpsertSimulationDefinitionResponse,
  UpsertSimulationResponseBody, UpsertSimulationResponseParams, UpsertSimulationResponseResponse,
} from "@workspace/api-zod";
import { canAssignSimulationGroups, canStartSimulation, canTransitionSimulation, hasDistinctStableIds, isSimulationStaff, learnerCanRespond, learnerMaySeeDebrief, mayReleaseNextInject, nextInjectId, type SimulationStatus } from "@workspace/domain";
import { currentRole, getCurrentUser } from "../lib/auth";
import { learnerAccessError } from "./coursework";

const router: IRouter = Router();
type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

function dateRun(run: typeof simulationRunsTable.$inferSelect) {
  return { id: run.id, sessionId: run.sessionId, status: run.status as SimulationStatus, startedAt: run.startedAt, debriefAt: run.debriefAt, endedAt: run.endedAt };
}
function dateRelease(release: typeof simulationInjectReleasesTable.$inferSelect) {
  return { injectId: release.injectId, sortOrder: release.sortOrder, releasedAt: release.releasedAt };
}
function dateResponse(response: typeof simulationResponsesTable.$inferSelect) {
  return { injectId: response.injectId, groupId: response.groupId, body: response.body, authorId: response.authorId, createdAt: response.createdAt, updatedAt: response.updatedAt };
}
async function sessionFor(id: number) {
  const [session] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  return session;
}
async function staff(req: Parameters<typeof getCurrentUser>[0], session: { instructorId: number | null }): Promise<User | null> {
  const user = await getCurrentUser(req);
  if (!user) return null;
  return isSimulationStaff(await currentRole(req), user.id, session.instructorId) ? user : null;
}

router.get("/sessions/:sessionId/simulation", async (req, res): Promise<void> => {
  const params = GetSimulationStudioParams.safeParse(req.params);
  if (!params.success) { req.log.warn({ errors: params.error.message }, "Invalid simulation parameters"); res.status(400).json({ error: params.error.message }); return; }
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const session = await sessionFor(params.data.sessionId);
  if (!session) { res.status(404).json({ error: "Module not found" }); return; }
  const role = await currentRole(req);
  const staffUser = isSimulationStaff(role, user.id, session.instructorId);
  if (!staffUser) {
    const error = await learnerAccessError(role, user, session);
    if (error) { res.status(403).json({ error }); return; }
  }
  const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.sessionId, session.id));
  if (!definition || (!staffUser && !definition.published)) { res.status(404).json({ error: "No simulation for this module" }); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.sessionId, session.id));
  const releases = run ? await db.select().from(simulationInjectReleasesTable).where(eq(simulationInjectReleasesTable.runId, run.id)).orderBy(asc(simulationInjectReleasesTable.sortOrder)) : [];
  const assignments = run ? await db.select().from(simulationGroupAssignmentsTable).where(eq(simulationGroupAssignmentsTable.runId, run.id)) : [];
  const participants = staffUser ? await db.select({ userId: usersTable.id, name: usersTable.name }).from(enrollmentsTable).innerJoin(usersTable, eq(enrollmentsTable.userId, usersTable.id)).where(and(eq(enrollmentsTable.programId, session.programId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`)) : [];
  const groupId = assignments.find((assignment) => assignment.userId === user.id)?.groupId ?? null;
  const responses = run ? await db.select().from(simulationResponsesTable).where(staffUser ? eq(simulationResponsesTable.runId, run.id) : and(eq(simulationResponsesTable.runId, run.id), eq(simulationResponsesTable.groupId, groupId ?? ""))) : [];
  const releasedIds = releases.map((release) => release.injectId);
  const shapedDefinition = staffUser ? { sessionId: session.id, title: definition.title, context: definition.context, learningObjective: definition.learningObjective, openingBrief: definition.openingBrief, groups: definition.groups, injects: definition.injects, debriefQuestions: definition.debriefQuestions, published: definition.published } : {
    sessionId: session.id, title: definition.title, context: definition.context, learningObjective: definition.learningObjective, openingBrief: definition.openingBrief,
    groups: groupId ? definition.groups.filter((group) => group.id === groupId) : [],
    injects: definition.injects.filter((inject) => releasedIds.includes(inject.id)),
    debriefQuestions: run && learnerMaySeeDebrief(run.status as SimulationStatus) ? definition.debriefQuestions : [],
    published: definition.published,
  };
  res.json(GetSimulationStudioResponse.parse({ sessionId: session.id, definition: shapedDefinition, run: run ? dateRun(run) : null, releases: releases.map(dateRelease), responses: responses.map(dateResponse), assignments: staffUser ? assignments.map((a) => ({ userId: a.userId, groupId: a.groupId, assignedAt: a.assignedAt })) : [], participants: staffUser ? participants : [] }));
});

router.put("/sessions/:sessionId/simulation", async (req, res): Promise<void> => {
  const params = UpsertSimulationDefinitionParams.safeParse(req.params); const body = UpsertSimulationDefinitionBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const session = await sessionFor(params.data.sessionId); if (!session) { res.status(404).json({ error: "Module not found" }); return; }
  if (!await staff(req, session)) { res.status(403).json({ error: "Forbidden" }); return; }
  if (!hasDistinctStableIds(body.data.groups) || !hasDistinctStableIds(body.data.injects)) { res.status(400).json({ error: "Group and inject ids must be unique" }); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.sessionId, session.id));
  if (run && run.status !== "draft") { res.status(409).json({ error: "A started simulation definition cannot be changed" }); return; }
  const values = { ...body.data };
  const [saved] = await db.insert(simulationDefinitionsTable).values({ sessionId: session.id, ...values }).onConflictDoUpdate({ target: simulationDefinitionsTable.sessionId, set: values }).returning();
  res.json(UpsertSimulationDefinitionResponse.parse(saved));
});

router.post("/sessions/:sessionId/simulation/run/start", async (req, res): Promise<void> => {
  const params = StartSimulationRunParams.safeParse(req.params); if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const session = await sessionFor(params.data.sessionId); if (!session) { res.status(404).json({ error: "Module not found" }); return; }
  if (!await staff(req, session)) { res.status(403).json({ error: "Forbidden" }); return; }
  const result = await db.transaction(async (tx) => {
    // The definition row exists before a run can start, so it also serialises
    // two first-start requests where there is no run row yet to lock.
    await tx.execute(sql`select id from simulation_definitions where session_id = ${session.id} for update`);
    await tx.execute(sql`select id from simulation_runs where session_id = ${session.id} for update`);
    const [definition] = await tx.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.sessionId, session.id));
    if (!definition?.published) return null;
    const [existing] = await tx.select().from(simulationRunsTable).where(eq(simulationRunsTable.sessionId, session.id));
    if (!existing) return null;
    const participants = await tx.select({ userId: enrollmentsTable.userId }).from(enrollmentsTable).where(and(eq(enrollmentsTable.programId, session.programId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
    const assignments = await tx.select({ userId: simulationGroupAssignmentsTable.userId, groupId: simulationGroupAssignmentsTable.groupId }).from(simulationGroupAssignmentsTable).where(eq(simulationGroupAssignmentsTable.runId, existing.id));
    if (!canStartSimulation(existing.status as SimulationStatus, definition.published, participants.map((p) => p.userId), assignments, definition.groups.map((g) => g.id))) return null;
    return (await tx.update(simulationRunsTable).set({ status: "live", startedAt: new Date() }).where(eq(simulationRunsTable.id, existing.id)).returning())[0];
  });
  if (!result) { res.status(409).json({ error: "A published draft run with every active learner assigned is required" }); return; }
  res.json(StartSimulationRunResponse.parse(dateRun(result)));
});

router.put("/sessions/:sessionId/simulation/assignments", async (req, res): Promise<void> => {
  const params = AssignSimulationGroupsParams.safeParse(req.params); const body = AssignSimulationGroupsBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const session = await sessionFor(params.data.sessionId); if (!session) { res.status(404).json({ error: "Module not found" }); return; } if (!await staff(req, session)) { res.status(403).json({ error: "Forbidden" }); return; }
  const saved = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from simulation_definitions where session_id = ${session.id} for update`);
    let [run] = await tx.select().from(simulationRunsTable).where(eq(simulationRunsTable.sessionId, session.id));
    const [definition] = await tx.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.sessionId, session.id));
    if (!definition) return null;
    if (!run) run = (await tx.insert(simulationRunsTable).values({ sessionId: session.id, definitionId: definition.id }).returning())[0];
    await tx.execute(sql`select id from simulation_runs where id = ${run.id} for update`);
    if (!canAssignSimulationGroups(run.status as SimulationStatus) || !body.data.assignments.every((a) => definition.groups.some((g) => g.id === a.groupId))) return null;
    const ids = body.data.assignments.map((a) => a.userId);
    const enrolled = ids.length === 0 ? [] : await tx.select({ userId: enrollmentsTable.userId }).from(enrollmentsTable).where(and(eq(enrollmentsTable.programId, session.programId), inArray(enrollmentsTable.userId, ids), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
    if (enrolled.length !== ids.length || new Set(ids).size !== ids.length) return null;
    await tx.delete(simulationGroupAssignmentsTable).where(eq(simulationGroupAssignmentsTable.runId, run.id));
    return Promise.all(body.data.assignments.map(async (a) => (await tx.insert(simulationGroupAssignmentsTable).values({ runId: run.id, ...a }).returning())[0]));
  });
  if (!saved) { res.status(409).json({ error: "Assignments are allowed only for a draft run and valid enrolled learners" }); return; }
  res.json(AssignSimulationGroupsResponse.parse(saved.map((a) => ({ userId: a.userId, groupId: a.groupId, assignedAt: a.assignedAt }))));
});

router.post("/sessions/:sessionId/simulation/injects/release", async (req, res): Promise<void> => {
  const params = ReleaseNextSimulationInjectParams.safeParse(req.params); if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const session = await sessionFor(params.data.sessionId); if (!session) { res.status(404).json({ error: "Module not found" }); return; } if (!await staff(req, session)) { res.status(403).json({ error: "Forbidden" }); return; }
  const released = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from simulation_runs where session_id = ${session.id} for update`);
    const [run] = await tx.select().from(simulationRunsTable).where(eq(simulationRunsTable.sessionId, session.id)); const [definition] = await tx.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.sessionId, session.id));
    if (!run || !definition) return null;
    const prior = await tx.select().from(simulationInjectReleasesTable).where(eq(simulationInjectReleasesTable.runId, run.id));
    const id = nextInjectId(definition.injects.map((i) => i.id), prior.map((p) => p.injectId));
    if (!id || !mayReleaseNextInject(run.status as SimulationStatus, definition.injects.map((i) => i.id), prior.map((p) => p.injectId))) return null;
    return (await tx.insert(simulationInjectReleasesTable).values({ runId: run.id, injectId: id, sortOrder: definition.injects.findIndex((i) => i.id === id) }).returning())[0];
  });
  if (!released) { res.status(409).json({ error: "No next inject can be released" }); return; } res.json(ReleaseNextSimulationInjectResponse.parse(dateRelease(released)));
});

router.post("/sessions/:sessionId/simulation/transition", async (req, res): Promise<void> => {
  const params = TransitionSimulationRunParams.safeParse(req.params); const body = TransitionSimulationRunBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const session = await sessionFor(params.data.sessionId); if (!session) { res.status(404).json({ error: "Module not found" }); return; } if (!await staff(req, session)) { res.status(403).json({ error: "Forbidden" }); return; }
  const saved = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from simulation_runs where session_id = ${session.id} for update`);
    const [run] = await tx.select().from(simulationRunsTable).where(eq(simulationRunsTable.sessionId, session.id));
    if (!run || !canTransitionSimulation(run.status as SimulationStatus, body.data.status)) return null;
    return (await tx.update(simulationRunsTable).set({ status: body.data.status, ...(body.data.status === "debrief" ? { debriefAt: new Date() } : { endedAt: new Date() }) }).where(eq(simulationRunsTable.id, run.id)).returning())[0];
  });
  if (!saved) { res.status(409).json({ error: "The requested transition is not available" }); return; }
  res.json(TransitionSimulationRunResponse.parse(dateRun(saved)));
});

router.put("/sessions/:sessionId/simulation/responses/:injectId", async (req, res): Promise<void> => {
  const params = UpsertSimulationResponseParams.safeParse(req.params); const body = UpsertSimulationResponseBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const user = await getCurrentUser(req); if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const session = await sessionFor(params.data.sessionId); if (!session) { res.status(404).json({ error: "Module not found" }); return; }
  const role = await currentRole(req);
  if (isSimulationStaff(role, user.id, session.instructorId)) { res.status(403).json({ error: "Only assigned learners may submit group responses" }); return; }
  const accessError = await learnerAccessError(role, user, session); if (accessError) { res.status(403).json({ error: accessError }); return; }
  const outcome = await db.transaction(async (tx) => {
    const [run] = await tx.select().from(simulationRunsTable).where(eq(simulationRunsTable.sessionId, session.id));
    if (!run) return { kind: "missing" as const };
    await tx.execute(sql`select id from simulation_runs where id = ${run.id} for update`);
    const [assignment] = await tx.select().from(simulationGroupAssignmentsTable).where(and(eq(simulationGroupAssignmentsTable.runId, run.id), eq(simulationGroupAssignmentsTable.userId, user.id)));
    const releases = await tx.select({ injectId: simulationInjectReleasesTable.injectId }).from(simulationInjectReleasesTable).where(eq(simulationInjectReleasesTable.runId, run.id));
    if (!learnerCanRespond(run.status as SimulationStatus, assignment?.groupId ?? null, releases.map((r) => r.injectId), params.data.injectId)) return { kind: "forbidden" as const };
    await tx.execute(sql`select id from simulation_responses where run_id = ${run.id} and group_id = ${assignment!.groupId} and inject_id = ${params.data.injectId} for update`);
    const [existing] = await tx.select().from(simulationResponsesTable).where(and(eq(simulationResponsesTable.runId, run.id), eq(simulationResponsesTable.groupId, assignment!.groupId), eq(simulationResponsesTable.injectId, params.data.injectId)));
    if (existing) {
      if (!body.data.expectedUpdatedAt || existing.updatedAt.getTime() !== body.data.expectedUpdatedAt.getTime()) return { kind: "conflict" as const };
      const [saved] = await tx.update(simulationResponsesTable).set({ body: body.data.body, authorId: user.id, updatedAt: new Date() }).where(eq(simulationResponsesTable.id, existing.id)).returning();
      return { kind: "saved" as const, saved };
    }
    const [saved] = await tx.insert(simulationResponsesTable).values({ runId: run.id, groupId: assignment!.groupId, injectId: params.data.injectId, body: body.data.body, authorId: user.id }).returning();
    return { kind: "saved" as const, saved };
  });
  if (outcome.kind === "missing") { res.status(404).json({ error: "No simulation run for this module" }); return; }
  if (outcome.kind === "forbidden") { res.status(403).json({ error: "This group cannot respond to that inject now" }); return; }
  if (outcome.kind === "conflict") { res.status(409).json({ error: "This response changed; refresh before editing it again" }); return; }
  const saved = outcome.saved;
  res.json(UpsertSimulationResponseResponse.parse(dateResponse(saved)));
});

export default router;