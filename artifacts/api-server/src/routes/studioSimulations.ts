import { Router, type IRouter } from "express";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  db, simulationDefinitionsTable, simulationGroupAssignmentsTable, simulationResponsesTable, simulationRunsTable,
} from "@workspace/db";
import {
  AdvanceSimulationRunParams, AdvanceSimulationRunResponse, CompleteSimulationRunParams, CompleteSimulationRunResponse,
  CreateSimulationRunBody, CreateSimulationRunResponse, GenerateSimulationBody, GenerateSimulationResponse,
  GetSimulationParams, GetSimulationResponse, GetSimulationRunParams, GetSimulationRunResponse,
  JoinSimulationRunBody, JoinSimulationRunResponse, ListSimulationsResponse, SubmitSimulationResponseBody,
  SubmitSimulationResponseParams, SubmitSimulationResponseResponse,
} from "@workspace/api-zod";
import { mayAdvanceStudioRun, mayCompleteStudioRun, mayControlStudioRun, mayJoinFacilitatedRun, operationLeaseIsActive } from "@workspace/domain";
import { getCurrentUser } from "../lib/auth";
import { generateDebrief, generateDevelopment, generateScenario, type GeneratedDevelopment } from "../lib/simulationAi";

const router: IRouter = Router();
const failedJoinAttempts = new Map<string, { attempts: number; resetAt: number }>();
const joinAttemptLimit = 10;
const joinAttemptWindowMs = 5 * 60 * 1000;
const operationLeaseMs = 2 * 60 * 1000;

function message(error: string) { return { error }; }
function response(row: typeof simulationResponsesTable.$inferSelect) {
  return { injectId: row.injectId, groupId: row.groupId, body: row.body, authorId: row.authorId, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function definitionView(definition: typeof simulationDefinitionsTable.$inferSelect) {
  const initialDevelopment = definition.injects[0];
  if (!initialDevelopment) throw new Error("Simulation definition has no initial development");
  return {
    id: definition.id, title: definition.title, sectorTopic: definition.context, objective: definition.learningObjective,
    difficulty: definition.difficulty, durationMinutes: definition.durationMinutes, participantPerspective: definition.participantPerspective,
    mode: definition.mode as "autonomous" | "facilitated", openingBrief: definition.openingBrief,
    stakeholderGroups: definition.groups, initialDevelopment: { id: initialDevelopment.id, title: initialDevelopment.title, content: initialDevelopment.content, responsePrompt: initialDevelopment.responsePrompt },
    evaluationDimensions: definition.evaluationDimensions, debriefQuestions: definition.debriefQuestions, createdAt: definition.createdAt,
  };
}
async function runView(run: typeof simulationRunsTable.$inferSelect, userId: number) {
  const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, run.definitionId));
  if (!definition) throw new Error("Simulation definition missing for run");
  const [assignment] = await db.select().from(simulationGroupAssignmentsTable)
    .where(and(eq(simulationGroupAssignmentsTable.runId, run.id), eq(simulationGroupAssignmentsTable.userId, userId)));
  const isOwner = run.ownerId === userId;
  if (!isOwner && !assignment) return null;
  const participantGroupId = assignment?.groupId ?? definition.groups[0]?.id ?? null;
  const allResponses = await db.select().from(simulationResponsesTable).where(eq(simulationResponsesTable.runId, run.id)).orderBy(asc(simulationResponsesTable.createdAt));
  const safeGroups = isOwner ? definition.groups : definition.groups.filter((group) => group.id === participantGroupId);
  return {
    id: run.id, simulationId: definition.id, mode: run.mode as "autonomous" | "facilitated", status: run.status as "active" | "completed",
    joinCode: isOwner ? run.joinCode : null, currentDevelopment: run.currentDevelopment,
    developments: run.developments, responses: (isOwner ? allResponses : allResponses.filter((item) => item.groupId === participantGroupId)).map(response),
    debrief: run.debrief, openingBrief: definition.openingBrief, stakeholderGroups: safeGroups, participantGroupId,
  };
}
function joinCode(): string {
  return crypto.randomUUID().replaceAll("-", "").toUpperCase();
}
function joinAttemptKey(userId: number, ip: string): string { return `${userId}:${ip}`; }
function isJoinThrottled(key: string): boolean {
  const record = failedJoinAttempts.get(key);
  if (!record) return false;
  if (record.resetAt <= Date.now()) { failedJoinAttempts.delete(key); return false; }
  return record.attempts >= joinAttemptLimit;
}
function recordFailedJoin(key: string): void {
  const existing = failedJoinAttempts.get(key);
  if (!existing || existing.resetAt <= Date.now()) {
    failedJoinAttempts.set(key, { attempts: 1, resetAt: Date.now() + joinAttemptWindowMs });
    return;
  }
  existing.attempts++;
}
async function claimOperation(runId: number): Promise<{ run: typeof simulationRunsTable.$inferSelect; token: string } | null> {
  const token = crypto.randomUUID();
  const now = new Date();
  const [run] = await db.update(simulationRunsTable)
    .set({ operationToken: token, operationStartedAt: now })
    .where(and(
      eq(simulationRunsTable.id, runId),
      eq(simulationRunsTable.status, "active"),
      or(
        isNull(simulationRunsTable.operationToken),
        isNull(simulationRunsTable.operationStartedAt),
        lt(simulationRunsTable.operationStartedAt, new Date(now.getTime() - operationLeaseMs)),
      ),
    ))
    .returning();
  return run ? { run, token } : null;
}
async function releaseOperation(runId: number, token: string): Promise<void> {
  await db.update(simulationRunsTable).set({ operationToken: null, operationStartedAt: null })
    .where(and(eq(simulationRunsTable.id, runId), eq(simulationRunsTable.operationToken, token)));
}
async function claimedCurrentResponse(run: typeof simulationRunsTable.$inferSelect, userId: number) {
  if (!run.currentDevelopment) return null;
  const [assignment] = await db.select().from(simulationGroupAssignmentsTable)
    .where(and(eq(simulationGroupAssignmentsTable.runId, run.id), eq(simulationGroupAssignmentsTable.userId, userId)));
  if (!assignment) return null;
  const [saved] = await db.select().from(simulationResponsesTable).where(and(
    eq(simulationResponsesTable.runId, run.id),
    eq(simulationResponsesTable.groupId, assignment.groupId),
    eq(simulationResponsesTable.injectId, run.currentDevelopment.id),
  ));
  return saved ?? null;
}

router.get("/simulations", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const definitions = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.ownerId, user.id)).orderBy(asc(simulationDefinitionsTable.createdAt));
  res.json(ListSimulationsResponse.parse(definitions.map(definitionView)));
});

router.post("/simulations/generate", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const body = GenerateSimulationBody.safeParse(req.body);
  if (!body.success) { req.log.warn({ errors: body.error.message }, "Invalid simulation launch brief"); res.status(400).json(message(body.error.message)); return; }
  try {
    const generated = await generateScenario(body.data);
    const [saved] = await db.insert(simulationDefinitionsTable).values({
      ownerId: user.id, mode: body.data.mode, title: generated.title, context: body.data.sectorTopic,
      learningObjective: body.data.objective, difficulty: body.data.difficulty, durationMinutes: body.data.durationMinutes,
      participantPerspective: body.data.participantPerspective, openingBrief: generated.openingBrief, groups: generated.stakeholderGroups,
      injects: [{ ...generated.initialDevelopment, responseMinutes: body.data.durationMinutes }], evaluationDimensions: generated.evaluationDimensions,
      debriefQuestions: generated.debriefQuestions, published: true,
    }).returning();
    req.log.info({ simulationId: saved.id }, "Generated standalone simulation");
    res.status(201).json(GenerateSimulationResponse.parse(definitionView(saved)));
  } catch (error) {
    req.log.error({ error }, "Simulation generation failed");
    res.status(502).json(message("AI scenario generation failed"));
  }
});

router.get("/simulations/:simulationId", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = GetSimulationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [definition] = await db.select().from(simulationDefinitionsTable).where(and(eq(simulationDefinitionsTable.id, params.data.simulationId), eq(simulationDefinitionsTable.ownerId, user.id)));
  if (!definition) { res.status(404).json(message("Simulation not found")); return; }
  res.json(GetSimulationResponse.parse(definitionView(definition)));
});

router.post("/simulation-runs", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const body = CreateSimulationRunBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }
  const [definition] = await db.select().from(simulationDefinitionsTable).where(and(eq(simulationDefinitionsTable.id, body.data.simulationId), eq(simulationDefinitionsTable.ownerId, user.id)));
  if (!definition) { res.status(403).json(message("Only the simulation owner can create its run")); return; }
  const initial = definition.injects[0];
  if (!initial || definition.groups.length === 0) { res.status(400).json(message("Simulation has no initial development or stakeholder group")); return; }
  const [run] = await db.insert(simulationRunsTable).values({
    ownerId: user.id, definitionId: definition.id, mode: definition.mode, status: "active",
    joinCode: definition.mode === "facilitated" ? joinCode() : null,
    currentDevelopment: { id: initial.id, title: initial.title, content: initial.content, responsePrompt: initial.responsePrompt },
    developments: [{ id: initial.id, title: initial.title, content: initial.content, responsePrompt: initial.responsePrompt }], startedAt: new Date(),
  }).returning();
  await db.insert(simulationGroupAssignmentsTable).values({ runId: run.id, userId: user.id, groupId: definition.groups[0].id });
  res.status(201).json(CreateSimulationRunResponse.parse(await runView(run, user.id)));
});

router.post("/simulation-runs/join", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const body = JoinSimulationRunBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }
  const attemptKey = joinAttemptKey(user.id, req.ip ?? "unknown");
  if (isJoinThrottled(attemptKey)) { res.status(429).json(message("Too many join attempts. Try again later.")); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.joinCode, body.data.joinCode.trim().toUpperCase()));
  if (!run) { recordFailedJoin(attemptKey); res.status(404).json(message("Facilitated room not found")); return; }
  if (!mayJoinFacilitatedRun(run.mode as "autonomous" | "facilitated", run.status as "active" | "completed", !!run.joinCode)) { recordFailedJoin(attemptKey); res.status(409).json(message("This room cannot be joined")); return; }
  const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, run.definitionId));
  if (!definition?.groups[0]) { recordFailedJoin(attemptKey); res.status(409).json(message("This room has no participant role")); return; }
  await db.insert(simulationGroupAssignmentsTable).values({ runId: run.id, userId: user.id, groupId: definition.groups[0].id }).onConflictDoNothing();
  failedJoinAttempts.delete(attemptKey);
  res.json(JoinSimulationRunResponse.parse(await runView(run, user.id)));
});

router.get("/simulation-runs/:runId", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = GetSimulationRunParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, params.data.runId));
  if (!run) { res.status(404).json(message("Simulation run not found")); return; }
  const view = await runView(run, user.id);
  if (!view) { res.status(403).json(message("Not a participant in this simulation run")); return; }
  res.json(GetSimulationRunResponse.parse(view));
});

router.post("/simulation-runs/:runId/response", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = SubmitSimulationResponseParams.safeParse(req.params); const body = SubmitSimulationResponseBody.safeParse(req.body);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from simulation_runs where id = ${params.data.runId} for update`);
    const [run] = await tx.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, params.data.runId));
    if (!run?.currentDevelopment || run.status !== "active") return { kind: "inactive" as const };
    if (run.operationToken && operationLeaseIsActive(run.operationStartedAt, new Date(), operationLeaseMs)) return { kind: "busy" as const };
    const [assignment] = await tx.select().from(simulationGroupAssignmentsTable).where(and(eq(simulationGroupAssignmentsTable.runId, run.id), eq(simulationGroupAssignmentsTable.userId, user.id)));
    if (!assignment) return { kind: "forbidden" as const };
    await tx.insert(simulationResponsesTable).values({ runId: run.id, groupId: assignment.groupId, injectId: run.currentDevelopment.id, body: body.data.body, authorId: user.id }).onConflictDoUpdate({
      target: [simulationResponsesTable.runId, simulationResponsesTable.groupId, simulationResponsesTable.injectId],
      set: { body: body.data.body, authorId: user.id, updatedAt: new Date() },
    });
    const [updated] = await tx.update(simulationRunsTable).set({ responseVersion: sql`${simulationRunsTable.responseVersion} + 1` }).where(eq(simulationRunsTable.id, run.id)).returning();
    return { kind: "saved" as const, run: updated };
  });
  if (outcome.kind === "inactive") { res.status(409).json(message("This run is not accepting responses")); return; }
  if (outcome.kind === "busy") { res.status(409).json(message("This run is busy. Try again shortly.")); return; }
  if (outcome.kind === "forbidden") { res.status(403).json(message("Not a participant in this simulation run")); return; }
  res.json(SubmitSimulationResponseResponse.parse(await runView(outcome.run, user.id)));
});

router.post("/simulation-runs/:runId/advance", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = AdvanceSimulationRunParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, params.data.runId));
  const view = run ? await runView(run, user.id) : null;
  if (!run || !view) { res.status(403).json(message("Not a participant in this simulation run")); return; }
  if (!mayControlStudioRun(run.mode as "autonomous" | "facilitated", run.ownerId, user.id)) { res.status(403).json(message("Only the run owner can advance this simulation")); return; }
  const claim = await claimOperation(run.id);
  if (!claim) { res.status(409).json(message("This run is busy. Try again shortly.")); return; }
  const latest = await claimedCurrentResponse(claim.run, user.id);
  if (!latest || !mayAdvanceStudioRun(claim.run.status as "active" | "completed", true) || !claim.run.currentDevelopment) {
    await releaseOperation(claim.run.id, claim.token);
    res.status(409).json(message("Submit a response to the current development before advancing")); return;
  }
  try {
    const next = await generateDevelopment({ openingBrief: view.openingBrief, currentDevelopment: claim.run.currentDevelopment as GeneratedDevelopment, latestResponse: latest.body, perspective: "participant" });
    const [updated] = await db.update(simulationRunsTable).set({ currentDevelopment: next, developments: [...claim.run.developments, next], operationToken: null, operationStartedAt: null }).where(and(eq(simulationRunsTable.id, claim.run.id), eq(simulationRunsTable.operationToken, claim.token), eq(simulationRunsTable.responseVersion, claim.run.responseVersion))).returning();
    if (!updated) { await releaseOperation(claim.run.id, claim.token); res.status(409).json(message("This run changed. Refresh and try again.")); return; }
    res.json(AdvanceSimulationRunResponse.parse(await runView(updated, user.id)));
  } catch (error) {
    await releaseOperation(claim.run.id, claim.token);
    req.log.error({ error, runId: claim.run.id }, "Simulation advancement failed");
    res.status(502).json(message("AI advancement failed"));
  }
});

router.post("/simulation-runs/:runId/complete", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = CompleteSimulationRunParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, params.data.runId));
  const view = run ? await runView(run, user.id) : null;
  if (!run || !view) { res.status(403).json(message("Not a participant in this simulation run")); return; }
  if (!mayControlStudioRun(run.mode as "autonomous" | "facilitated", run.ownerId, user.id)) { res.status(403).json(message("Only the run owner can complete this simulation")); return; }
  const claim = await claimOperation(run.id);
  if (!claim) { res.status(409).json(message("This run is busy. Try again shortly.")); return; }
  const latest = await claimedCurrentResponse(claim.run, user.id);
  if (!latest || !mayCompleteStudioRun(claim.run.status as "active" | "completed")) {
    await releaseOperation(claim.run.id, claim.token);
    res.status(409).json(message("Submit a response to the current development before completing")); return;
  }
  try {
    const frozenResponses = await db.select().from(simulationResponsesTable).where(eq(simulationResponsesTable.runId, claim.run.id)).orderBy(asc(simulationResponsesTable.createdAt));
    const debrief = await generateDebrief({ openingBrief: view.openingBrief, developments: claim.run.developments, responses: frozenResponses.map(response) });
    const [updated] = await db.update(simulationRunsTable).set({ status: "completed", debrief, endedAt: new Date(), operationToken: null, operationStartedAt: null }).where(and(eq(simulationRunsTable.id, claim.run.id), eq(simulationRunsTable.operationToken, claim.token), eq(simulationRunsTable.responseVersion, claim.run.responseVersion))).returning();
    if (!updated) { await releaseOperation(claim.run.id, claim.token); res.status(409).json(message("This run changed. Refresh and try again.")); return; }
    res.json(CompleteSimulationRunResponse.parse(await runView(updated, user.id)));
  } catch (error) {
    await releaseOperation(claim.run.id, claim.token);
    req.log.error({ error, runId: claim.run.id }, "Simulation debrief failed");
    res.status(502).json(message("AI debrief generation failed"));
  }
});

export default router;