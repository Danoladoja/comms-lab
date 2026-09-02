import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  db, enrollmentsTable, pendingInvitationsTable, programsTable, sessionsTable, simulationDefinitionsTable,
  simulationGroupAssignmentsTable, simulationResponsesTable, simulationRunsTable, studioAccessCodesTable, usersTable,
} from "@workspace/db";
import {
  AdvanceSimulationRunParams, AdvanceSimulationRunResponse, CompleteSimulationRunParams, CompleteSimulationRunResponse,
  CreateStudioAccessCodeResponse, GetStudioRecordResponse, GrantStudioAccessToProgrammeResponse,
  CreateSimulationRunBody, CreateSimulationRunResponse, GenerateSimulationBody, GenerateSimulationResponse,
  GetSimulationParams, GetSimulationResponse, GetSimulationRunParams, GetSimulationRunResponse,
  JoinSimulationRunBody, JoinSimulationRunResponse, ListSimulationsResponse, SubmitSimulationResponseBody,
  SubmitSimulationResponseParams, SubmitSimulationResponseResponse, GetStudioAccessResponse,
  RedeemStudioAccessBody, RedeemStudioAccessResponse,
} from "@workspace/api-zod";
import {
  JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, accessCodeCount, mayAdvanceStudioRun, mayCompleteStudioRun,
  mayControlStudioRun, mayEnterStudio, mayJoinFacilitatedRun, maySeeStudioSimulation, normaliseJoinCode,
  clampResponseSeconds, nextStudioStep, operationLeaseIsActive, plannedTurns, practiceRecord, runClock,
  satisfiesRole, studioInviteLetter, whatTheClockSays, type StudioProgrammeContext,
} from "@workspace/domain";
import { getCurrentUser } from "../lib/auth";
import { createBudget } from "../lib/rateBudget";
import { emailConfigured, sendEmail } from "../lib/email";
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
    programId: definition.programId, published: definition.published, ownerId: definition.ownerId,
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
    clock: clockFor(run, definition),
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

/* ---------- Programmes, and who is on them ---------- */

/** The programmes this person is enrolled on, for the visibility rule. */
async function enrolledProgramIds(userId: number): Promise<number[]> {
  const rows = await db.select({ programId: enrollmentsTable.programId })
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, userId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
  return rows.map((row) => row.programId);
}

/**
 * Everything the scenario writer should know about the cohort.
 *
 * The module titles come in the order the cohort meets them, because "the
 * thing taught in week three" is only a useful instruction if week three is
 * identifiable.
 */
async function programmeContext(programId: number): Promise<StudioProgrammeContext | null> {
  const [programme] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (!programme) return null;
  const modules = await db.select({ title: sessionsTable.title })
    .from(sessionsTable)
    .where(eq(sessionsTable.programId, programId))
    .orderBy(asc(sessionsTable.startsAt), asc(sessionsTable.id));
  return {
    title: programme.title,
    description: programme.description,
    tag: programme.tag,
    moduleTitles: modules.map((m) => m.title).filter(Boolean),
  };
}

/** Where the Studio lives, for a link in an email. */
function studioUrl(): string {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  return base ? `${base}/studio` : "https://energycommslab.africa/studio";
}
function labLogoUrl(): string | null {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  return base ? `${base}/logo-white.png` : null;
}

/**
 * Put a development on the table, with its deadline attached.
 *
 * The deadline becomes a timestamp here, at the moment it starts counting,
 * rather than a number the browser counts down from. A laptop that sleeps for
 * ten minutes wakes to a deadline that has passed, which is what would have
 * happened in the real thing.
 */
function withDeadline<T extends { responseSeconds?: number }>(development: T, now = new Date()): T & { dueAt: string } {
  const seconds = clampResponseSeconds(development.responseSeconds);
  return { ...development, responseSeconds: seconds, dueAt: new Date(now.getTime() + seconds * 1000).toISOString() };
}

/** The two clocks, for a run as it stands. */
function clockFor(
  run: typeof simulationRunsTable.$inferSelect,
  definition: { durationMinutes: number } | undefined,
  now = new Date(),
) {
  return runClock({
    startedAt: run.startedAt,
    durationMinutes: definition?.durationMinutes ?? 30,
    responseDueAt: run.currentDevelopment?.dueAt ?? null,
    status: run.status as "active" | "completed",
    now,
  });
}

/* ---------- Moving a run along ---------- */

type StepOutcome =
  | { ok: true; run: typeof simulationRunsTable.$inferSelect }
  | { ok: false; status: number; error: string };

/**
 * Write the next development and put it on the table.
 *
 * Pulled out of the route because a solo run now does this by itself the
 * moment an answer is in. Pressing a button called "what happens next" is not
 * something that happens in a crisis, and it gave every turn a pause where the
 * person stepped out of the exercise to operate the software.
 */
async function carryOn(
  runId: number,
  log: { error: (o: unknown, m: string) => void },
  allowSilence = false,
): Promise<StepOutcome> {
  const claim = await claimOperation(runId);
  if (!claim) return { ok: false, status: 409, error: "This run is busy. Try again shortly." };

  const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, claim.run.definitionId));
  const { history, latest } = await runHistory(claim.run, definition?.groups ?? []);
  if (!claim.run.currentDevelopment) {
    await releaseOperation(claim.run.id, claim.token);
    return { ok: false, status: 409, error: "There is nothing on the table to move on from." };
  }
  // `latest` may be empty on purpose: the deadline passed and nothing was
  // sent. The story still moves, which is the point of having a deadline.
  if (!latest && !allowSilence) {
    await releaseOperation(claim.run.id, claim.token);
    return { ok: false, status: 409, error: "Nobody has answered the current development yet." };
  }

  const next = await generateDevelopment({
    openingBrief: definition?.openingBrief ?? "",
    history,
    latestResponse: latest ?? "",
    perspective: definition?.participantPerspective ?? "the communications lead",
    turn: claim.run.developments.length + 1,
  });
  if (!next.ok) {
    await releaseOperation(claim.run.id, claim.token);
    log.error({ reason: next.error, runId }, "Simulation advancement failed");
    return { ok: false, status: 502, error: next.error };
  }

  const dated = withDeadline(next.value);
  const [updated] = await db.update(simulationRunsTable)
    .set({ currentDevelopment: dated, developments: [...claim.run.developments, dated], operationToken: null, operationStartedAt: null })
    .where(and(eq(simulationRunsTable.id, claim.run.id), eq(simulationRunsTable.operationToken, claim.token), eq(simulationRunsTable.responseVersion, claim.run.responseVersion)))
    .returning();
  if (!updated) {
    await releaseOperation(claim.run.id, claim.token);
    return { ok: false, status: 409, error: "Somebody answered while that was generating. Refresh and try again." };
  }
  return { ok: true, run: updated };
}

/** End it and write the debrief. */
async function finish(
  runId: number,
  log: { error: (o: unknown, m: string) => void },
  allowSilence = false,
): Promise<StepOutcome> {
  const claim = await claimOperation(runId);
  if (!claim) return { ok: false, status: 409, error: "This run is busy. Try again shortly." };

  const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, claim.run.definitionId));
  const { history, latest } = await runHistory(claim.run, definition?.groups ?? []);
  if (!latest && !allowSilence) {
    await releaseOperation(claim.run.id, claim.token);
    return { ok: false, status: 409, error: "Nobody has answered the current development yet." };
  }

  const debrief = await generateDebrief({
    openingBrief: definition?.openingBrief ?? "",
    evaluationDimensions: definition?.evaluationDimensions ?? [],
    debriefQuestions: definition?.debriefQuestions ?? [],
    history,
  });
  if (!debrief.ok) {
    await releaseOperation(claim.run.id, claim.token);
    log.error({ reason: debrief.error, runId }, "Simulation debrief failed");
    return { ok: false, status: 502, error: debrief.error };
  }

  const [updated] = await db.update(simulationRunsTable)
    .set({ status: "completed", debrief: debrief.value, endedAt: new Date(), operationToken: null, operationStartedAt: null })
    .where(and(eq(simulationRunsTable.id, claim.run.id), eq(simulationRunsTable.operationToken, claim.token), eq(simulationRunsTable.responseVersion, claim.run.responseVersion)))
    .returning();
  if (!updated) {
    await releaseOperation(claim.run.id, claim.token);
    return { ok: false, status: 409, error: "Somebody answered while that was generating. Refresh and try again." };
  }
  return { ok: true, run: updated };
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

/**
 * A handful of codes at once.
 *
 * A facilitator running a session for twenty people needs twenty codes, and
 * making them one at a time is twenty presses and twenty chances to lose one.
 * They are returned in clear exactly once, here; only a digest is kept, so
 * there is no screen anywhere that can show them again.
 */
router.post("/studio/access-codes", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!satisfiesRole(user.role, ["admin"])) { res.status(403).json(message("Only admins can create Studio access codes")); return; }

  const wanted = accessCodeCount((req.body as { count?: unknown } | undefined)?.count ?? 1);
  const codes: string[] = [];
  for (let i = 0; i < wanted; i++) codes.push(newAccessCode());

  await db.insert(studioAccessCodesTable)
    .values(codes.map((code) => ({ codeHash: accessCodeHash(code), createdByUserId: user.id, source: "code" })))
    .onConflictDoNothing();

  req.log.info({ count: codes.length, by: user.id }, "Created Studio access codes");
  res.status(201).json(CreateStudioAccessCodeResponse.parse({ code: codes[0], codes }));
});

/**
 * Open the Studio to a whole cohort, in one press.
 *
 * The alternative was an admin making forty codes and pasting them into forty
 * messages, which is how a good feature quietly never gets used.
 *
 * A grant is stored in the same table as a code, already redeemed against the
 * person, so that "may this person use the Studio" still has one answer in one
 * place rather than two that can disagree. Anyone who already has access is
 * skipped rather than granted twice.
 *
 * The email is sent after the access is recorded, and a send that fails does
 * not take the access with it: somebody who can use the Studio but did not
 * hear about it is a smaller problem than the reverse.
 */
router.post("/studio/access/programme/:programId", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!satisfiesRole(user.role, ["admin"])) { res.status(403).json(message("Only admins can open the Studio to a cohort")); return; }

  const programId = Number(req.params.programId);
  if (!Number.isInteger(programId) || programId < 1) { res.status(400).json(message("That is not a programme")); return; }
  const [programme] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (!programme) { res.status(404).json(message("Programme not found")); return; }

  const learners = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(enrollmentsTable.userId, usersTable.id))
    .where(and(eq(enrollmentsTable.programId, programId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));

  const already = new Set(
    (await db.select({ userId: studioAccessCodesTable.redeemedByUserId })
      .from(studioAccessCodesTable)
      .where(sql`${studioAccessCodesTable.redeemedByUserId} is not null`))
      .map((row) => row.userId),
  );

  const newcomers = learners.filter((learner) => !already.has(learner.id));
  if (newcomers.length > 0) {
    await db.insert(studioAccessCodesTable).values(newcomers.map((learner) => ({
      source: "cohort",
      codeHash: accessCodeHash(newAccessCode() + String(learner.id)),
      createdByUserId: user.id,
      redeemedByUserId: learner.id,
      redeemedAt: new Date(),
    }))).onConflictDoNothing();
  }

  let emailed = 0;
  const failed: string[] = [];
  if (emailConfigured()) {
    const letter = studioInviteLetter({ programmeTitle: programme.title, url: studioUrl(), logoUrl: labLogoUrl() });
    for (const learner of newcomers) {
      if (!learner.email) continue;
      try {
        const personal = studioInviteLetter({ name: learner.name, programmeTitle: programme.title, url: studioUrl(), logoUrl: labLogoUrl() });
        await sendEmail({
          to: { email: learner.email, name: (learner.name ?? "").trim() || learner.email },
          subject: letter.subject, html: personal.html, text: personal.text,
        });
        emailed++;
      } catch (err) {
        req.log.error({ err, userId: learner.id }, "Could not tell a learner the Studio is open");
        failed.push(learner.email);
      }
    }
  }

  req.log.info({ programId, granted: newcomers.length, emailed }, "Opened the Studio to a cohort");
  res.json(GrantStudioAccessToProgrammeResponse.parse({
    programmeTitle: programme.title,
    enrolled: learners.length,
    granted: newcomers.length,
    alreadyHadAccess: learners.length - newcomers.length,
    emailed,
    emailFailed: failed.length,
    emailConfigured: emailConfigured(),
  }));
});

/**
 * What this person can open: their own, plus anything published for a
 * programme they are on. An administrator sees the lot.
 */
router.get("/simulations", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const isAdmin = satisfiesRole(user.role, ["admin"]);
  const programIds = isAdmin ? [] : await enrolledProgramIds(user.id);

  const definitions = await db.select().from(simulationDefinitionsTable).orderBy(asc(simulationDefinitionsTable.createdAt));
  const visible = definitions.filter((definition) =>
    maySeeStudioSimulation(definition, { id: user.id, isAdmin, enrolledProgramIds: programIds }));

  res.json(ListSimulationsResponse.parse(visible.map(definitionView)));
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

  // A programme turns a competent generic exercise into one the cohort
  // recognises, so it is looked up before the scenario is written, not after.
  const programme = body.data.programId ? await programmeContext(body.data.programId) : null;
  if (body.data.programId && !programme) { res.status(404).json(message("Programme not found")); return; }

  const generated = await generateScenario({ ...body.data, programme });
  if (!generated.ok) {
    req.log.error({ reason: generated.error, userId: user.id }, "Simulation generation failed");
    res.status(502).json(message(generated.error));
    return;
  }
  const scenario = generated.value;

  const [saved] = await db.insert(simulationDefinitionsTable).values({
    ownerId: user.id, programId: body.data.programId ?? null, published: !!body.data.programId,
    mode: body.data.mode, title: scenario.title, context: body.data.sectorTopic,
    learningObjective: body.data.objective, difficulty: body.data.difficulty, durationMinutes: body.data.durationMinutes,
    participantPerspective: body.data.participantPerspective, openingBrief: scenario.openingBrief, groups: scenario.stakeholderGroups,
    injects: [{ ...scenario.initialDevelopment, responseMinutes: body.data.durationMinutes }], evaluationDimensions: scenario.evaluationDimensions,
    debriefQuestions: scenario.debriefQuestions,
  }).returning();
  req.log.info({ simulationId: saved.id }, "Generated standalone simulation");
  res.status(201).json(GenerateSimulationResponse.parse(definitionView(saved)));
});

router.get("/simulations/:simulationId", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = GetSimulationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, params.data.simulationId));
  const isAdmin = satisfiesRole(user.role, ["admin"]);
  const programIds = isAdmin ? [] : await enrolledProgramIds(user.id);
  if (!definition || !maySeeStudioSimulation(definition, { id: user.id, isAdmin, enrolledProgramIds: programIds })) {
    res.status(404).json(message("Simulation not found")); return;
  }
  res.json(GetSimulationResponse.parse(definitionView(definition)));
});

router.post("/simulation-runs", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const body = CreateSimulationRunBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }
  const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, body.data.simulationId));
  const runnerIsAdmin = satisfiesRole(user.role, ["admin"]);
  const runnerProgrammes = runnerIsAdmin ? [] : await enrolledProgramIds(user.id);
  // A cohort exercise is the cohort's to run, each on their own copy. The run
  // belongs to whoever started it, so one learner's answers never meet another's.
  if (!definition || !maySeeStudioSimulation(definition, { id: user.id, isAdmin: runnerIsAdmin, enrolledProgramIds: runnerProgrammes })) {
    res.status(403).json(message("That exercise is not open to you")); return;
  }
  const initial = definition.injects[0];
  if (!initial || definition.groups.length === 0) { res.status(400).json(message("Simulation has no initial development or stakeholder group")); return; }
  // The clock starts here, and every deadline after this is measured from it.
  const startedAt = new Date();
  const [run] = await db.insert(simulationRunsTable).values({
    ownerId: user.id, definitionId: definition.id, mode: definition.mode, status: "active",
    joinCode: definition.mode === "facilitated" ? joinCode() : null,
    currentDevelopment: withDeadline(initial, startedAt),
    developments: [withDeadline(initial, startedAt)], startedAt,
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

/**
 * Reading a run is when the clocks bite.
 *
 * There is no background job watching every exercise, and there does not need
 * to be: an exercise nobody is looking at is not one anybody is being timed
 * on. The moment somebody opens it, the server works out what time it is and
 * does what the clock says: end the exercise and write the debrief, or move a
 * solo run past a deadline that went by while nothing was sent.
 */
router.get("/simulation-runs/:runId", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = GetSimulationRunParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [found] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, params.data.runId));
  if (!found) { res.status(404).json(message("Simulation run not found")); return; }
  if (!(await runView(found, user.id))) { res.status(403).json(message("Not a participant in this simulation run")); return; }

  let run = found;
  if (run.status === "active" && simulationAiConfigured()) {
    const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, run.definitionId));
    const says = whatTheClockSays(clockFor(run, definition), run.mode as "autonomous" | "facilitated");
    if (says === "finish") {
      const ended = await finish(run.id, req.log, true);
      if (ended.ok) run = ended.run;
    } else if (says === "moveOn") {
      const moved = await carryOn(run.id, req.log, true);
      if (moved.ok) run = moved.run;
    }
    // A failure here is deliberately quiet. The person asked to see their
    // exercise, and showing it with the clock still running beats an error.
  }

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

  /*
   * A solo exercise carries itself.
   *
   * The answer is in, so the next thing happens now: another development, or,
   * once the exercise has run its length, the debrief. Nobody presses
   * anything. A room is different, because everybody has to be on the same
   * development at the same time and only the facilitator knows when the
   * discussion has finished.
   *
   * The answer is already saved before any of this. If writing the next
   * development fails, the person is told why and can try again, and what they
   * wrote is still there.
   */
  const saved = outcome.run;
  if (saved.mode === "autonomous" && saved.ownerId === user.id) {
    const [definition] = await db.select().from(simulationDefinitionsTable).where(eq(simulationDefinitionsTable.id, saved.definitionId));
    const planned = plannedTurns(definition?.durationMinutes ?? 30);
    const step = nextStudioStep(saved.developments.length, planned);
    const moved = step === "finish" ? await finish(saved.id, req.log) : await carryOn(saved.id, req.log);
    if (!moved.ok) { res.status(moved.status).json(message(moved.error)); return; }
    res.json(SubmitSimulationResponseResponse.parse(await runView(moved.run, user.id)));
    return;
  }

  res.json(SubmitSimulationResponseResponse.parse(await runView(saved, user.id)));
});

/**
 * Move a room on. Solo runs no longer come through here, because they move
 * themselves, but a facilitator still decides when a room has finished talking.
 */
router.post("/simulation-runs/:runId/advance", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = AdvanceSimulationRunParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, params.data.runId));
  const view = run ? await runView(run, user.id) : null;
  if (!run || !view) { res.status(403).json(message("Not a participant in this simulation run")); return; }
  if (!mayControlStudioRun(run.mode as "autonomous" | "facilitated", run.ownerId, user.id)) { res.status(403).json(message("Only the run owner can advance this simulation")); return; }
  if (!mayAdvanceStudioRun(run.status as "active" | "completed", true)) { res.status(409).json(message("This run has finished")); return; }
  if (!simulationAiConfigured()) { res.status(503).json(message("The Studio needs an AI key on the server before it can continue an exercise.")); return; }

  const moved = await carryOn(run.id, req.log);
  if (!moved.ok) { res.status(moved.status).json(message(moved.error)); return; }
  res.json(AdvanceSimulationRunResponse.parse(await runView(moved.run, user.id)));
});

/** End it early, or end a room. */
router.post("/simulation-runs/:runId/complete", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const params = CompleteSimulationRunParams.safeParse(req.params);
  if (!params.success) { res.status(400).json(message(params.error.message)); return; }
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, params.data.runId));
  const view = run ? await runView(run, user.id) : null;
  if (!run || !view) { res.status(403).json(message("Not a participant in this simulation run")); return; }
  if (!mayControlStudioRun(run.mode as "autonomous" | "facilitated", run.ownerId, user.id)) { res.status(403).json(message("Only the run owner can complete this simulation")); return; }
  if (!mayCompleteStudioRun(run.status as "active" | "completed")) { res.status(409).json(message("This run has already finished")); return; }
  if (!simulationAiConfigured()) { res.status(503).json(message("The Studio needs an AI key on the server before it can write a debrief.")); return; }

  const ended = await finish(run.id, req.log);
  if (!ended.ok) { res.status(ended.status).json(message(ended.error)); return; }
  res.json(CompleteSimulationRunResponse.parse(await runView(ended.run, user.id)));
});

/**
 * What this person has done in the Studio.
 *
 * Private to them by construction: it reads only their own completed runs, and
 * there is no endpoint anywhere that returns anybody else's.
 */
router.get("/studio/record", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }

  const runs = await db
    .select({
      endedAt: simulationRunsTable.endedAt,
      debrief: simulationRunsTable.debrief,
      title: simulationDefinitionsTable.title,
      minutes: simulationDefinitionsTable.durationMinutes,
    })
    .from(simulationRunsTable)
    .innerJoin(simulationDefinitionsTable, eq(simulationRunsTable.definitionId, simulationDefinitionsTable.id))
    .where(and(eq(simulationRunsTable.ownerId, user.id), eq(simulationRunsTable.status, "completed")));

  res.json(GetStudioRecordResponse.parse(practiceRecord(
    runs
      .filter((row) => row.debrief)
      .map((row) => ({
        endedAt: row.endedAt,
        title: row.title,
        score: row.debrief!.score,
        ratings: row.debrief!.ratings ?? [],
        minutes: row.minutes,
      })),
  )));
});

export default router;