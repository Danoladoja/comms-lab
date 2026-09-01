import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  db, pendingInvitationsTable, simulationDefinitionsTable, simulationGroupAssignmentsTable, simulationResponsesTable,
  simulationRunsTable, studioAccessCodesTable,
} from "@workspace/db";
import {
  AdvanceSimulationRunParams, AdvanceSimulationRunResponse, CompleteSimulationRunParams, CompleteSimulationRunResponse,
  CreateStudioAccessCodeResponse,
  CreateSimulationRunBody, CreateSimulationRunResponse, GenerateSimulationBody, GenerateSimulationResponse,
  GetSimulationParams, GetSimulationResponse, GetSimulationRunParams, GetSimulationRunResponse,
  JoinSimulationRunBody, JoinSimulationRunResponse, ListSimulationsResponse, SubmitSimulationResponseBody,
  SubmitSimulationResponseParams, SubmitSimulationResponseResponse, GetStudioAccessResponse,
  RedeemStudioAccessBody, RedeemStudioAccessResponse,
} from "@workspace/api-zod";
import {
  JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, mayAdvanceStudioRun, mayCompleteStudioRun, mayControlStudioRun,
  mayEnterStudio, mayJoinFacilitatedRun, normaliseJoinCode, operationLeaseIsActive, satisfiesRole,
} from "@workspace/domain";
import { getCurrentUser } from "../lib/auth";
import { createBudget } from "../lib/rateBudget";
import { generateDebrief, generateDevelopment, generateScenario, simulationAiConfigured } from "../lib/simulationAi";

/**
 * Writing an exercise is the one thing here that costs real money on somebody
 * else's meter, and it is reachable by every signed-in learner. Twelve a day
 * each is far more than anyone practising will use and far less than a stuck
 * retry loop would spend overnight.
 */
const generationBudget = createBudget({ windowMs: 24 * 60 * 60 * 1000, max: 12 });

const router: IRouter = Router();
const failedJoinAttempts = new Map<string, { attempts: number; resetAt: number }>();
const joinAttemptLimit = 10;
const joinAttemptWindowMs = 5 * 60 * 1000;
const operationLeaseMs = 2 * 60 * 1000;

function message(error: string) { return { error }; }
function normaliseAccessCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function accessCodeHash(value: string): string {
  return createHash("sha256").update(normaliseAccessCode(value)).digest("hex");
}
function newAccessCode(): string {
  return randomBytes(9).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}
async function studioAccess(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) return { allowed: false, isAdmin: false, source: null };
  if (satisfiesRole(user.role, ["admin"])) return { allowed: true, isAdmin: true, source: "admin" as const };
  const [[invitation], [code]] = await Promise.all([
    db.select({ id: pendingInvitationsTable.id }).from(pendingInvitationsTable)
      .where(and(eq(pendingInvitationsTable.acceptedByUserId, user.id), eq(pendingInvitationsTable.role, "learner"))).limit(1),
    db.select({ id: studioAccessCodesTable.id }).from(studioAccessCodesTable)
      .where(eq(studioAccessCodesTable.redeemedByUserId, user.id)).limit(1),
  ]);
  if (mayEnterStudio(false, !!invitation, !!code)) {
    return invitation
      ? { allowed: true, isAdmin: false, source: "invitation" as const }
      : { allowed: true, isAdmin: false, source: "access_code" as const };
  }
  return { allowed: false, isAdmin: false, source: null };
}
/**
 * The gate, applied to each Studio route by name.
 *
 * Deliberately not `router.use(requireStudioAccess)`. This router is mounted
 * without a path prefix, alongside the rest of the API, so a bare `use` runs
 * for **every** request that reaches it and does not match a route here, and
 * this router sits above reviews, presence, slides, the forum, the admin API
 * and the public partnership form. A catch-all here refused all of those for
 * every learner, and refused the public enquiry form for everyone, while
 * leaving admins untouched, which is the worst possible shape for a bug: it
 * looks fine to whoever is testing it.
 *
 * Naming each route costs one word per line and cannot reach past the Studio.
 */
async function requireStudioAccess(req: Request, res: Response, next: NextFunction) {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!(await studioAccess(user)).allowed) {
    res.status(403).json(message("A Studio invitation or access code is required"));
    return;
  }
  next();
}
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
    joinCode: isOwner ? run.joinCode : null, isOwner, currentDevelopment: run.currentDevelopment,
    developments: run.developments, responses: (isOwner ? allResponses : allResponses.filter((item) => item.groupId === participantGroupId)).map(response),
    debrief: run.debrief, openingBrief: definition.openingBrief, stakeholderGroups: safeGroups, participantGroupId,
  };
}
/**
 * A code a facilitator can read out to a room.
 *
 * Six characters from an alphabet with no O against 0 and no I against 1.
 * Uniqueness is enforced by the index on the column, so a collision is
 * retried rather than trusted away.
 */
function joinCode(): string {
  const bytes = new Uint32Array(JOIN_CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((n) => JOIN_CODE_ALPHABET[n % JOIN_CODE_ALPHABET.length]).join("");
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
/**
 * Everything written in this run so far, paired with the development it answered.
 *
 * This is what the AI is given, and it is why the exercise feels like one thing
 * rather than a series of unrelated prompts: the next development is written
 * knowing the whole conversation, not only the last line of it.
 *
 * In a facilitated room several groups answer the same development. They are
 * labelled by role and joined, so the next turn can play one group's answer off
 * against another's, which is the entire point of running it with a room.
 */
async function runHistory(
  run: typeof simulationRunsTable.$inferSelect,
  groups: { id: string; name: string }[],
) {
  const rows = await db.select().from(simulationResponsesTable)
    .where(eq(simulationResponsesTable.runId, run.id))
    .orderBy(asc(simulationResponsesTable.createdAt));
  const label = new Map(groups.map((g) => [g.id, g.name]));

  const answersFor = (developmentId: string) =>
    rows.filter((row) => row.injectId === developmentId);

  const join = (rowsForOne: typeof rows) =>
    rowsForOne.length === 0
      ? null
      : rowsForOne.length === 1
        ? rowsForOne[0].body
        : rowsForOne.map((row) => `[${label.get(row.groupId) ?? row.groupId}]\n${row.body}`).join("\n\n");

  return {
    history: run.developments.map((development) => ({
      title: development.title,
      content: development.content,
      response: join(answersFor(development.id)),
    })),
    /** The answers to the development currently on the table, if there are any. */
    latest: run.currentDevelopment ? join(answersFor(run.currentDevelopment.id)) : null,
  };
}

router.get("/studio/access", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  res.json(GetStudioAccessResponse.parse(await studioAccess(user)));
});

router.post("/studio/access/redeem", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const body = RedeemStudioAccessBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }
  if ((await studioAccess(user)).allowed) {
    res.json(RedeemStudioAccessResponse.parse(await studioAccess(user)));
    return;
  }
  const hash = accessCodeHash(body.data.code);
  const redeemed = await db.transaction(async (tx) => {
    const [code] = await tx.select().from(studioAccessCodesTable)
      .where(and(eq(studioAccessCodesTable.codeHash, hash), isNull(studioAccessCodesTable.redeemedAt)))
      .for("update");
    if (!code) return false;
    const [updated] = await tx.update(studioAccessCodesTable)
      .set({ redeemedByUserId: user.id, redeemedAt: new Date() })
      .where(and(eq(studioAccessCodesTable.id, code.id), isNull(studioAccessCodesTable.redeemedAt)))
      .returning({ id: studioAccessCodesTable.id });
    return !!updated;
  });
  if (!redeemed) { res.status(404).json(message("This Studio access code is invalid or has already been used")); return; }
  res.json(RedeemStudioAccessResponse.parse(await studioAccess(user)));
});

router.post("/studio/access-codes", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!satisfiesRole(user.role, ["admin"])) { res.status(403).json(message("Only admins can create Studio access codes")); return; }
  const code = newAccessCode();
  await db.insert(studioAccessCodesTable).values({ codeHash: accessCodeHash(code), createdByUserId: user.id });
  res.status(201).json(CreateStudioAccessCodeResponse.parse({ code }));
});

router.get("/simulations", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const definitions = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.ownerId, user.id)).orderBy(asc(simulationDefinitionsTable.createdAt));
  res.json(ListSimulationsResponse.parse(definitions.map(definitionView)));
});

router.post("/simulations/generate", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const body = GenerateSimulationBody.safeParse(req.body);
  if (!body.success) { req.log.warn({ errors: body.error.message }, "Invalid simulation launch brief"); res.status(400).json(message(body.error.message)); return; }
  if (!simulationAiConfigured()) {
    res.status(503).json(message("The Studio needs an AI key on the server before it can write exercises."));
    return;
  }
  if (generationBudget.overBudget(`studio:${user.id}`)) {
    res.status(429).json(message("You have written a lot of exercises today. Try again tomorrow, or run one you already have."));
    return;
  }

  const generated = await generateScenario(body.data);
  if (!generated.ok) {
    req.log.error({ reason: generated.error, userId: user.id }, "Simulation generation failed");
    res.status(502).json(message(generated.error));
    return;
  }
  const scenario = generated.value;

  const [saved] = await db.insert(simulationDefinitionsTable).values({
    ownerId: user.id, mode: body.data.mode, title: scenario.title, context: body.data.sectorTopic,
    learningObjective: body.data.objective, difficulty: body.data.difficulty, durationMinutes: body.data.durationMinutes,
    participantPerspective: body.data.participantPerspective, openingBrief: scenario.openingBrief, groups: scenario.stakeholderGroups,
    injects: [{ ...scenario.initialDevelopment, responseMinutes: body.data.durationMinutes }], evaluationDimensions: scenario.evaluationDimensions,
    debriefQuestions: scenario.debriefQuestions, published: true,
  }).returning();
  req.log.info({ simulationId: saved.id }, "Generated standalone simulation");
  res.status(201).json(GenerateSimulationResponse.parse(definitionView(saved)));
});

router.get("/simulations/:simulationId", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = GetSimulationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [definition] = await db.select().from(simulationDefinitionsTable).where(and(eq(simulationDefinitionsTable.id, params.data.simulationId), eq(simulationDefinitionsTable.ownerId, user.id)));
  if (!definition) { res.status(404).json(message("Simulation not found")); return; }
  res.json(GetSimulationResponse.parse(definitionView(definition)));
});

router.post("/simulation-runs", requireStudioAccess, async (req, res): Promise<void> => {
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

router.post("/simulation-runs/join", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const body = JoinSimulationRunBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }
  const attemptKey = joinAttemptKey(user.id, req.ip ?? "unknown");
  if (isJoinThrottled(attemptKey)) { res.status(429).json(message("Too many join attempts. Try again later.")); return; }
  const typed = normaliseJoinCode(body.data.joinCode);
  if (typed.length !== JOIN_CODE_LENGTH) { recordFailedJoin(attemptKey); res.status(404).json(message("Facilitated room not found")); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.joinCode, typed));
  if (!run) { recordFailedJoin(attemptKey); res.status(404).json(message("Facilitated room not found")); return; }
  if (!mayJoinFacilitatedRun(run.mode as "autonomous" | "facilitated", run.status as "active" | "completed", !!run.joinCode)) { recordFailedJoin(attemptKey); res.status(409).json(message("This room cannot be joined")); return; }
  const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, run.definitionId));
  if (!definition?.groups[0]) { recordFailedJoin(attemptKey); res.status(409).json(message("This room has no participant role")); return; }
  // Spread arrivals across the roles the scenario defines, in turn. Putting
  // everybody in the first group would give a room one shared brief and one
  // shared answer, which is a queue rather than an exercise: the value of
  // running it with people is that the operator and the community are in the
  // room arguing from briefs that do not agree.
  const existing = await db.select({ id: simulationGroupAssignmentsTable.id })
    .from(simulationGroupAssignmentsTable)
    .where(eq(simulationGroupAssignmentsTable.runId, run.id));
  const nextGroup = definition.groups[existing.length % definition.groups.length];
  await db.insert(simulationGroupAssignmentsTable)
    .values({ runId: run.id, userId: user.id, groupId: nextGroup.id })
    .onConflictDoNothing();
  failedJoinAttempts.delete(attemptKey);
  res.json(JoinSimulationRunResponse.parse(await runView(run, user.id)));
});

router.get("/simulation-runs/:runId", requireStudioAccess, async (req, res): Promise<void> => {
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

router.post("/simulation-runs/:runId/response", requireStudioAccess, async (req, res): Promise<void> => {
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

router.post("/simulation-runs/:runId/advance", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = AdvanceSimulationRunParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, params.data.runId));
  const view = run ? await runView(run, user.id) : null;
  if (!run || !view) { res.status(403).json(message("Not a participant in this simulation run")); return; }
  if (!mayControlStudioRun(run.mode as "autonomous" | "facilitated", run.ownerId, user.id)) { res.status(403).json(message("Only the run owner can advance this simulation")); return; }
  if (!simulationAiConfigured()) { res.status(503).json(message("The Studio needs an AI key on the server before it can continue an exercise.")); return; }

  const claim = await claimOperation(run.id);
  if (!claim) { res.status(409).json(message("This run is busy. Try again shortly.")); return; }

  const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, claim.run.definitionId));
  const { history, latest } = await runHistory(claim.run, definition?.groups ?? []);

  // Somebody must have answered the development on the table. In an autonomous
  // run that is the owner themselves; in a room it is whoever is playing, and
  // the facilitator is not required to write an answer of their own before
  // moving the room on.
  if (!latest || !mayAdvanceStudioRun(claim.run.status as "active" | "completed", true) || !claim.run.currentDevelopment) {
    await releaseOperation(claim.run.id, claim.token);
    res.status(409).json(message("Nobody has answered the current development yet.")); return;
  }

  const next = await generateDevelopment({
    openingBrief: view.openingBrief,
    history,
    latestResponse: latest,
    perspective: definition?.participantPerspective ?? "the communications lead",
    turn: claim.run.developments.length + 1,
  });
  if (!next.ok) {
    await releaseOperation(claim.run.id, claim.token);
    req.log.error({ reason: next.error, runId: claim.run.id }, "Simulation advancement failed");
    res.status(502).json(message(next.error));
    return;
  }

  const [updated] = await db.update(simulationRunsTable)
    .set({ currentDevelopment: next.value, developments: [...claim.run.developments, next.value], operationToken: null, operationStartedAt: null })
    .where(and(eq(simulationRunsTable.id, claim.run.id), eq(simulationRunsTable.operationToken, claim.token), eq(simulationRunsTable.responseVersion, claim.run.responseVersion)))
    .returning();
  if (!updated) { await releaseOperation(claim.run.id, claim.token); res.status(409).json(message("Somebody answered while that was generating. Refresh and try again.")); return; }
  res.json(AdvanceSimulationRunResponse.parse(await runView(updated, user.id)));
});

router.post("/simulation-runs/:runId/complete", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = CompleteSimulationRunParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, params.data.runId));
  const view = run ? await runView(run, user.id) : null;
  if (!run || !view) { res.status(403).json(message("Not a participant in this simulation run")); return; }
  if (!mayControlStudioRun(run.mode as "autonomous" | "facilitated", run.ownerId, user.id)) { res.status(403).json(message("Only the run owner can complete this simulation")); return; }
  if (!simulationAiConfigured()) { res.status(503).json(message("The Studio needs an AI key on the server before it can write a debrief.")); return; }

  const claim = await claimOperation(run.id);
  if (!claim) { res.status(409).json(message("This run is busy. Try again shortly.")); return; }

  const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, claim.run.definitionId));
  const { history, latest } = await runHistory(claim.run, definition?.groups ?? []);
  if (!latest || !mayCompleteStudioRun(claim.run.status as "active" | "completed")) {
    await releaseOperation(claim.run.id, claim.token);
    res.status(409).json(message("Nobody has answered the current development yet.")); return;
  }

  const debrief = await generateDebrief({
    openingBrief: view.openingBrief,
    evaluationDimensions: definition?.evaluationDimensions ?? [],
    debriefQuestions: definition?.debriefQuestions ?? [],
    history,
  });
  if (!debrief.ok) {
    await releaseOperation(claim.run.id, claim.token);
    req.log.error({ reason: debrief.error, runId: claim.run.id }, "Simulation debrief failed");
    res.status(502).json(message(debrief.error));
    return;
  }

  const [updated] = await db.update(simulationRunsTable)
    .set({ status: "completed", debrief: debrief.value, endedAt: new Date(), operationToken: null, operationStartedAt: null })
    .where(and(eq(simulationRunsTable.id, claim.run.id), eq(simulationRunsTable.operationToken, claim.token), eq(simulationRunsTable.responseVersion, claim.run.responseVersion)))
    .returning();
  if (!updated) { await releaseOperation(claim.run.id, claim.token); res.status(409).json(message("Somebody answered while that was generating. Refresh and try again.")); return; }
  res.json(CompleteSimulationRunResponse.parse(await runView(updated, user.id)));
});

export default router;