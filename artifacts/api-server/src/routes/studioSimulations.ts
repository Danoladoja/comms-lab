import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  db, assignmentsTable, enrollmentsTable, programsTable, sessionReadingsTable, sessionsTable,
  simulationDefinitionsTable,
  simulationGroupAssignmentsTable, simulationResponsesTable, simulationRunsTable, studioAccessCodesTable,
  studioGroupSessionsTable, studioInvitationsTable, usersTable,
} from "@workspace/db";
import {
  AdvanceSimulationRunParams, AdvanceSimulationRunResponse, CompleteSimulationRunParams, CompleteSimulationRunResponse,
  CreateStudioAccessCodeResponse, GetStudioRecordResponse, GrantStudioAccessToProgrammeResponse,
  CreateSimulationRunBody, CreateSimulationRunResponse, GenerateSimulationBody, GenerateSimulationResponse,
  GetSimulationParams, GetSimulationResponse, GetSimulationRunParams, GetSimulationRunResponse,
  JoinSimulationRunBody, JoinSimulationRunResponse, ListSimulationsResponse, SubmitSimulationResponseBody,
  SubmitSimulationResponseParams, SubmitSimulationResponseResponse, GetStudioAccessResponse,
  RedeemStudioAccessBody, RedeemStudioAccessResponse, CreateStudioAccessCodeBody,
  GetMyStudioExerciseResponse, BeginStudioExerciseResponse, GetMyGroupSessionResponse,
  InviteToStudioBody, InviteToStudioResponse,
  PlanGroupSessionBody, EditGroupSessionBody, GetGroupSessionResponse, ListGroupSessionsResponse,
} from "@workspace/api-zod";
import {
  JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, accessCodeCount, mayAdvanceStudioRun, mayCompleteStudioRun,
  mayControlStudioRun, mayEnterStudio, mayJoinFacilitatedRun, maySeeStudioSimulation, normaliseJoinCode,
  clampResponseSeconds, nextStudioStep, operationLeaseIsActive, plannedTurns, practiceRecord, runClock,
  satisfiesRole, studioInviteLetter, whatTheClockSays, type StudioProgrammeContext,
  inviteState, beginProblem, situationFor, situationBrief, situationSummary,
  objectiveFor, invitationProblem, invitationNote,
  steerProblem, standaloneProblem, validityProblem, exerciseSubject, durationProblem,
  groupSessionState, approvalProblem, mayEditSession, beatApprovalNote, GROUP_SESSION_MINUTES,
  developmentsForTeam, debriefForTeam, isUnattendedRoom, mayEnterRoom, startsInMinutes, cohortNote,
  minutesLeft, picksOwnExercise,
} from "@workspace/domain";
import { getCurrentUser } from "../lib/auth";
import { logger } from "../lib/logger";
import { createBudget } from "../lib/rateBudget";
import { emailConfigured, sendEmail } from "../lib/email";
import {
  generateDebrief, generateDevelopment, generateGroupPlan, generateScenario, simulationAiConfigured,
} from "../lib/simulationAi";

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
/**
 * May this person open the Studio, and how did they get in?
 *
 * The middle test used to be "has ever accepted an invitation to the Lab",
 * which admitted every learner on every cohort to a room that spends API
 * tokens. It is now "has been invited to the Studio" — a Studio invitation, or
 * a cohort grant recorded as one of those, or a code they typed.
 *
 * Any invitation counts, including a spent one: somebody who has finished
 * their exercise still belongs here, because their debrief and their practice
 * record live here. Whether they may start a *new* run is a different question,
 * answered by `beginProblem` against the invitation itself.
 */
async function studioAccess(user: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!user) return { allowed: false, isAdmin: false, source: null };
  if (satisfiesRole(user.role, ["admin"])) return { allowed: true, isAdmin: true, source: "admin" as const };
  const [[invitation], [code], session] = await Promise.all([
    db.select({ id: studioInvitationsTable.id }).from(studioInvitationsTable)
      .where(eq(studioInvitationsTable.userId, user.id)).limit(1),
    // The source matters as much as the row. A whole cohort let in by an admin
    // pressing "open the Studio to this programme" is recorded here too, and
    // reading that as "typed a code" hands an entire cohort the form the
    // invitation exists to take away.
    db.select({ id: studioAccessCodesTable.id, source: studioAccessCodesTable.source })
      .from(studioAccessCodesTable)
      .where(eq(studioAccessCodesTable.redeemedByUserId, user.id))
      .orderBy(sql`case when ${studioAccessCodesTable.source} = 'cohort' then 0 else 1 end`)
      .limit(1),
    cohortSessionFor(user.id),
  ]);
  if (mayEnterStudio(false, !!invitation, !!code, !!session)) {
    if (invitation) return { allowed: true, isAdmin: false, source: "invitation" as const };
    if (code) {
      return code.source === "cohort"
        ? { allowed: true, isAdmin: false, source: "cohort" as const }
        : { allowed: true, isAdmin: false, source: "access_code" as const };
    }
    return { allowed: true, isAdmin: false, source: "group_session" as const };
  }
  return { allowed: false, isAdmin: false, source: null };
}

/**
 * The group session this learner's cohort is turning up to, if there is one.
 *
 * Approved, not yet closed, on a programme they are enrolled in. This is what
 * stands in for an invitation: a group session invites nobody by name, so the
 * approval is the invitation and being on the cohort is the ticket.
 *
 * Newest first, because a cohort with two planned sessions is turning up to the
 * one that was planned most recently.
 */
async function cohortSessionFor(userId: number) {
  const [found] = await db
    .select({ session: studioGroupSessionsTable })
    .from(studioGroupSessionsTable)
    .innerJoin(enrollmentsTable, and(
      eq(enrollmentsTable.programId, studioGroupSessionsTable.programId),
      eq(enrollmentsTable.userId, userId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ))
    // A closed session still counts. The team's debrief lives on it, and a
    // learner shut out of the Studio the minute the exercise ends is a learner
    // who never reads what they were told about how they did.
    .where(sql`${studioGroupSessionsTable.approvedAt} is not null`)
    .orderBy(sql`${studioGroupSessionsTable.createdAt} desc`)
    .limit(1);
  return found?.session ?? null;
}

/** The four facts the invitation rules read, out of a full row. */
function inviteFacts(invite: {
  runId: number | null; startedAt: Date | null; completedAt: Date | null;
  /*
    Required rather than optional, which is the whole point of it being here.

    A caller that selects a few columns and forgets this one would get "ready"
    for an invitation that has not opened, and nothing would complain — the
    filters downstream only ask whether it is spent or expired, so the mistake
    would be invisible until a cohort started a week early. Making it required
    turns that into a compile error instead.
  */
  opensAt: Date | null; expiresAt: Date | null;
}) {
  return {
    runId: invite.runId,
    startedAt: invite.startedAt?.toISOString() ?? null,
    completedAt: invite.completedAt?.toISOString() ?? null,
    opensAt: invite.opensAt?.toISOString() ?? null,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
  };
}

async function moduleTitleFor(sessionId: number | null): Promise<string | null> {
  if (!sessionId) return null;
  const [found] = await db.select({ title: sessionsTable.title }).from(sessionsTable).where(eq(sessionsTable.id, sessionId));
  return found?.title ?? null;
}

/** The invitation this learner is currently working with, if they have one. */
async function openInvitationFor(userId: number) {
  const [invite] = await db
    .select()
    .from(studioInvitationsTable)
    .where(eq(studioInvitationsTable.userId, userId))
    // Newest first, so a learner sent a second invitation after finishing the
    // first is shown the one they can actually use.
    .orderBy(sql`${studioInvitationsTable.createdAt} desc`)
    .limit(1);
  return invite ?? null;
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

/**
 * Does this person fill in the form, or are they handed their exercise?
 *
 * Only an admin trying the Studio out, and somebody who typed a code because
 * they are on no programme at all. Everybody on a cohort is handed theirs —
 * that is what the invitation is — and writing your own is the spending the
 * invitation exists to govern.
 *
 * Three ways onto a cohort and all three were leaking in different ways: an
 * invited learner was stopped at run creation but not at generation; a whole
 * cohort let in by "open the Studio to this programme" was stopped nowhere,
 * because its admission is recorded as an access code; and a group session
 * admits people with no invitation at all.
 */
async function handedTheirExercise(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
): Promise<boolean> {
  /*
    One question, asked of how they got in.

    Worth noting what this already covers without a second check: somebody who
    redeems a workshop code is admitted as an access code, but the redemption
    mints them an invitation, and an invitation is what `studioAccess` reports
    from then on. So they are handed their exercise from the moment they have
    one, and are not also left the form to ignore.
  */
  return !picksOwnExercise((await studioAccess(user)).source);
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
    joinCode: isOwner ? run.joinCode : null, isOwner,
    currentDevelopment: run.currentDevelopment,
    /*
      A group session is one run carrying every team's feed, so a beat aimed at
      the regulator would otherwise appear on the operator's screen. Filtering
      here is the only thing between them. A development with no team is
      everybody's, which is what every run written before group sessions existed
      means by it — so nothing else changes.
    */
    developments: isOwner ? run.developments : developmentsForTeam(run.developments, participantGroupId),
    responses: (isOwner ? allResponses : allResponses.filter((item) => item.groupId === participantGroupId)).map(response),
    /*
      Each team is judged on the feed it actually had, so each team gets its own
      debrief. A solo run has none of these and `debrief` is the whole answer,
      which is also true of every run finished before group sessions existed.

      The owner of a group run is an admin who was not in any team. They are
      given the run's own debrief — which for a cohort session is empty — rather
      than one team's, because the cross-team read they actually want is on the
      session in the console, and showing them team one's verdict as though it
      were the room's would be a lie in the shape of an answer.
    */
    debrief: isOwner
      ? run.debrief
      : debriefForTeam(run.teamDebriefs, assignment?.groupId ?? null)?.debrief ?? run.debrief,
    /*
      Nobody is driving this one. The room screen used to tell participants to
      wait for the facilitator, which in a cohort session is a wait for somebody
      who does not exist.
    */
    unattended: isUnattendedRoom(run),
    teamName: definition.groups.find((group) => group.id === participantGroupId)?.name ?? null,
    openingBrief: definition.openingBrief, stakeholderGroups: safeGroups, participantGroupId,
    clock: clockFor(run, definition),
    // Something is being written right now. The browser uses this to keep
    // asking, and to say so, rather than leaving the person looking at a
    // screen that appears to have stopped.
    working: !!run.operationToken && operationLeaseIsActive(run.operationStartedAt, new Date(), operationLeaseMs),
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
/**
 * The whole programme, as the scenario writer should see it.
 *
 * Module titles alone were six or eight phrases — enough to place an exercise
 * vaguely in the right territory and no further. What a module taught is in its
 * description, what it asked for is in its written task, and what it pointed
 * people at is on its reading list, and all three are what turn "something
 * about energy communications" into something this cohort recognises.
 *
 * Class transcripts are deliberately left out. They are the largest thing
 * attached to a module and the least summarised, and a prompt that carries a
 * term's worth of them is paying for length rather than for relevance.
 */
async function programmeContext(programId: number): Promise<StudioProgrammeContext | null> {
  const [programme] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (!programme) return null;

  const modules = await db
    .select({ id: sessionsTable.id, title: sessionsTable.title, description: sessionsTable.description })
    .from(sessionsTable)
    .where(eq(sessionsTable.programId, programId))
    .orderBy(asc(sessionsTable.startsAt), asc(sessionsTable.id));

  const sessionIds = modules.map((m) => m.id).concat(-1);
  const [tasks, readings] = await Promise.all([
    // Posted tasks only. A draft is not something the cohort was asked for.
    db.select({ sessionId: assignmentsTable.sessionId, title: assignmentsTable.title })
      .from(assignmentsTable)
      .where(and(inArray(assignmentsTable.sessionId, sessionIds), eq(assignmentsTable.draft, false))),
    db.select({ sessionId: sessionReadingsTable.sessionId, title: sessionReadingsTable.title })
      .from(sessionReadingsTable)
      .where(inArray(sessionReadingsTable.sessionId, sessionIds))
      .orderBy(asc(sessionReadingsTable.sortOrder)),
  ]);

  const taskFor = new Map(tasks.map((a) => [a.sessionId, a.title]));
  const readingsFor = new Map<number, string[]>();
  for (const reading of readings) {
    const list = readingsFor.get(reading.sessionId) ?? [];
    list.push(reading.title);
    readingsFor.set(reading.sessionId, list);
  }

  return {
    title: programme.title,
    description: programme.description,
    tag: programme.tag,
    moduleTitles: modules.map((m) => m.title).filter(Boolean),
    modules: modules.filter((m) => m.title).map((m) => ({
      title: m.title,
      description: m.description,
      taskTitle: taskFor.get(m.id) ?? null,
      readings: readingsFor.get(m.id) ?? [],
    })),
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
/**
 * The opening development, as a stored inject.
 *
 * `responseMinutes` used to be set to the whole session duration here, in all
 * three places that write one. Nothing read it — a solo run's deadline comes
 * from `responseSeconds`, which the scenario sets per development — so it
 * changed nothing, and it read as though the first turn lasted the entire
 * exercise. A stored row that contradicts itself is a bug waiting for somebody
 * to trust it, so it now says the same thing the deadline does.
 */
function openingInject<T extends { responseSeconds?: number }>(development: T) {
  const seconds = clampResponseSeconds(development.responseSeconds);
  return { ...development, responseSeconds: seconds, responseMinutes: Math.round(seconds / 60) };
}

function withDeadline<T extends { responseSeconds?: number }>(development: T, now = new Date()): T & { dueAt: string; at: string } {
  const seconds = clampResponseSeconds(development.responseSeconds);
  return {
    ...development,
    responseSeconds: seconds,
    // When it landed, and when the answer is due. Both facts on the server.
    at: now.toISOString(),
    dueAt: new Date(now.getTime() + seconds * 1000).toISOString(),
  };
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
/**
 * Claim the run, answer straight away, and write in the background.
 *
 * Waiting for the model before answering made every turn feel broken. The
 * person had pressed Send, their words had vanished from the box, and nothing
 * happened for fifteen seconds. Now the lease is taken before we reply, so the
 * page comes back at once saying the newsroom is reacting, and the development
 * appears when it is ready.
 *
 * The lease is what makes this safe. It is claimed synchronously, so a second
 * request cannot start the same work, and it expires on its own, so a crash
 * mid-generation frees the run rather than wedging it forever.
 */
async function startStep(
  runId: number,
  kind: "carryOn" | "finish",
  log: { error: (o: unknown, m: string) => void },
): Promise<boolean> {
  const claim = await claimOperation(runId);
  if (!claim) return false;

  // Deliberately not awaited. Whatever happens is written to the run, and the
  // browser is already asking every couple of seconds.
  void (kind === "finish" ? finishWith(claim, log) : carryOnWith(claim, log))
    .catch((err) => {
      log.error({ err, runId }, "Studio step threw");
      return releaseOperation(runId, claim.token);
    });
  return true;
}



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
  return carryOnWith(claim, log, allowSilence);
}

type Claim = NonNullable<Awaited<ReturnType<typeof claimOperation>>>;

async function carryOnWith(
  claim: Claim,
  log: { error: (o: unknown, m: string) => void },
  allowSilence = true,
): Promise<StepOutcome> {
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
    log.error({ reason: next.error, runId: claim.run.id }, "Simulation advancement failed");
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

/* ------------------------------------------------------------------ *
 * Finishing a solo run that nobody is watching
 * ------------------------------------------------------------------ */

const SOLO_SWEEP_EVERY_MS = 60 * 1000;
/** How many to close per pass, so a backlog cannot become a burst of spending. */
const SOLO_SWEEP_BATCH = 5;

/**
 * Ends solo exercises whose time is up, with nobody asking.
 *
 * Until now the clocks only bit when a request arrived. The reasoning was that
 * an exercise nobody is watching is not one anybody is being timed on — which
 * is true of the timing and false of the debrief. A learner whose clock ran out
 * while the tab was closed, or hidden, or whose laptop shut, came back to an
 * exercise still sitting open at the last development, no debrief, and no way
 * to get one: the thing that writes it only ran when somebody looked, and
 * looking is exactly what they had stopped doing.
 *
 * Group sessions already had this and solo runs did not, which is the whole
 * bug. The same principle, applied to the other half of the Studio: it ends
 * itself.
 *
 * A few at a time on purpose. A backlog of stuck runs — after a deploy, or a
 * spell where generation was failing — must not become a burst of model calls
 * nobody budgeted for.
 */
export function startSoloRunSweep(): void {
  setInterval(() => void sweepFinishedSoloRuns(), SOLO_SWEEP_EVERY_MS);
  logger.info("Solo run sweep scheduled");
}

export async function sweepFinishedSoloRuns(): Promise<number> {
  let closed = 0;
  try {
    const candidates = await db
      .select()
      .from(simulationRunsTable)
      .where(and(
        eq(simulationRunsTable.status, "active"),
        eq(simulationRunsTable.mode, "autonomous"),
        sql`${simulationRunsTable.startedAt} is not null`,
      ))
      .orderBy(asc(simulationRunsTable.startedAt))
      .limit(50);

    for (const run of candidates) {
      if (closed >= SOLO_SWEEP_BATCH) break;
      const [definition] = await db.select().from(simulationDefinitionsTable)
        .where(eq(simulationDefinitionsTable.id, run.definitionId));
      const clock = clockFor(run, definition);
      if (!clock.sessionExpired) continue;
      // Somebody's browser may be finishing it this very second. Leave it be;
      // the next pass will pick it up if they did not.
      if (run.operationToken && operationLeaseIsActive(run.operationStartedAt, new Date(), operationLeaseMs)) continue;

      const outcome = await finish(run.id, logger, true);
      closed++;
      if (!outcome.ok) {
        logger.error({ runId: run.id, reason: outcome.error }, "Could not close an expired solo run");
      } else {
        logger.info({ runId: run.id }, "Closed an expired solo run and wrote its debrief");
      }
    }
  } catch (err) {
    logger.error({ err }, "Solo run sweep failed");
  }
  return closed;
}

/** End it and write the debrief. */
async function finish(
  runId: number,
  log: { error: (o: unknown, m: string) => void },
  allowSilence = false,
): Promise<StepOutcome> {
  const claim = await claimOperation(runId);
  if (!claim) return { ok: false, status: 409, error: "This run is busy. Try again shortly." };
  return finishWith(claim, log, allowSilence);
}

async function finishWith(
  claim: Claim,
  log: { error: (o: unknown, m: string) => void },
  allowSilence = true,
): Promise<StepOutcome> {
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
    log.error({ reason: debrief.error, runId: claim.run.id }, "Simulation debrief failed");
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

  // The invitation is spent at the moment the debrief exists, not at the moment
  // somebody navigates away. A run that ended because its clock ran out ends
  // the invitation too, which is the point: an exercise you can walk out of and
  // start again is not an exercise.
  await db.update(studioInvitationsTable)
    .set({ completedAt: new Date() })
    .where(and(eq(studioInvitationsTable.runId, updated.id), isNull(studioInvitationsTable.completedAt)));

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
    if (!updated) return false;

    /*
      The code was carrying an exercise, so they are handed it now.

      Inside the same transaction as the redemption. Redeeming a workshop code
      and not getting the exercise it was minted for would leave somebody
      admitted to a Studio with nothing in it and no way to ask for the thing
      they were promised — and the code is spent, so they cannot try again.

      Frozen onto the invitation exactly as a cohort's is, so an admin editing
      the batch later cannot change what somebody was already asked to do.
    */
    if (code.exercise) {
      await tx.insert(studioInvitationsTable).values({
        userId: user.id,
        programId: null,
        sessionId: null,
        objective: code.exercise.objective,
        subject: code.exercise.subject,
        steer: code.exercise.steer,
        situationSeed: `code:${code.id}:${user.id}:${randomBytes(4).toString("hex")}`,
        difficulty: code.exercise.difficulty,
        durationMinutes: code.exercise.durationMinutes,
        invitedByUserId: code.createdByUserId,
      });
    }
    return true;
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

  /*
    An exercise can travel with the codes.

    This is the standalone case: a partner workshop, a staff session, twenty
    people with no programme between them. The cohort invitation could not
    reach them — it starts from an enrolment — and a bare code left each of
    them filling in the same five-field form and practising twenty different
    things. Attaching one exercise to the batch makes it one workshop.
  */
  const asked = (req.body as { exercise?: unknown } | undefined)?.exercise;
  let exercise: {
    subject: string; objective: string; steer: string; difficulty: string; durationMinutes: number;
  } | null = null;

  if (asked) {
    const parsed = CreateStudioAccessCodeBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json(message(parsed.error.message)); return; }
    const wantedExercise = parsed.data.exercise;
    if (wantedExercise) {
      const bad = standaloneProblem({
        subject: wantedExercise.subject ?? "",
        objective: wantedExercise.objective ?? "",
      })
        ?? steerProblem(wantedExercise.steer)
        ?? durationProblem(wantedExercise.durationMinutes ?? 30);
      if (bad) { res.status(400).json(message(bad)); return; }
      exercise = {
        subject: wantedExercise.subject.trim(),
        objective: wantedExercise.objective.trim(),
        steer: (wantedExercise.steer ?? "").trim(),
        difficulty: wantedExercise.difficulty ?? "intermediate",
        durationMinutes: wantedExercise.durationMinutes ?? 30,
      };
    }
  }

  const codes: string[] = [];
  for (let i = 0; i < wanted; i++) codes.push(newAccessCode());

  await db.insert(studioAccessCodesTable)
    .values(codes.map((code) => ({
      codeHash: accessCodeHash(code), createdByUserId: user.id, source: "code", exercise,
    })))
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

/** One session, or nothing. */
async function groupSession(id: number) {
  if (!Number.isInteger(id)) return null;
  const [found] = await db.select().from(studioGroupSessionsTable).where(eq(studioGroupSessionsTable.id, id));
  return found ?? null;
}

/** The four dates the state machine reads, out of a full row. */
function sessionFacts(session: typeof studioGroupSessionsTable.$inferSelect) {
  return {
    scheduledAt: session.scheduledAt?.toISOString() ?? null,
    approvedAt: session.approvedAt?.toISOString() ?? null,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    durationMinutes: session.durationMinutes,
  };
}

/**
 * A session as the approval screen needs it.
 *
 * Each beat carries the sentence that says how far it was actually vetted. A
 * screen that showed every beat the same way would imply an admin had read
 * wording that cannot exist yet, because a team beat quotes a learner who has
 * not answered.
 */
async function groupSessionView(session: typeof studioGroupSessionsTable.$inferSelect) {
  const [definition] = await db.select().from(simulationDefinitionsTable)
    .where(eq(simulationDefinitionsTable.id, session.definitionId));
  const [{ learners }] = await db
    .select({ learners: sql<number>`count(*)::int` })
    .from(enrollmentsTable)
    .where(and(
      eq(enrollmentsTable.programId, session.programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));

  const state = groupSessionState(sessionFacts(session), Date.now());
  const teams = definition?.groups ?? [];

  return {
    id: session.id,
    programId: session.programId,
    title: session.title,
    state,
    openingBrief: definition?.openingBrief ?? "",
    objective: definition?.learningObjective ?? "",
    teams: teams.map((g) => ({ id: g.id, name: g.name, roleName: g.roleName })),
    objectives: session.objectives,
    beats: session.beats.map((beat) => ({ ...beat, approvalNote: beatApprovalNote(beat) })),
    scheduledAt: session.scheduledAt?.toISOString() ?? null,
    durationMinutes: session.durationMinutes,
    learners,
    mayEdit: mayEditSession(state),
    // Said on the screen rather than only on the press, so an admin can fix it
    // before they reach for the button.
    problem: state === "draft"
      ? approvalProblem({
        objectives: session.objectives,
        beats: session.beats,
        scheduledAt: session.scheduledAt?.toISOString() ?? null,
        durationMinutes: session.durationMinutes,
        nowMs: Date.now(),
        learners,
        teams: teams.length,
      })
      : null,
    runId: session.runId,
    // Only ever reaches an admin: this route is admin-only, and it is the one
    // view in the Studio that reads across teams.
    sessionDebrief: session.sessionDebrief,
  };
}

/* ------------------------------------------------------------------ *
 * Group sessions: written, then read, then live
 * ------------------------------------------------------------------ */

/**
 * Write a group session, and stop.
 *
 * The scenario and the running order are generated here and nothing else
 * happens. No learner can see it, no team exists, nothing is scheduled. It sits
 * in draft until an admin has read what it tests and what it does, which is the
 * whole point of having a gate: an unfacilitated session cannot be steered once
 * it starts, so the reading has to happen before rather than during.
 */
router.post("/admin/studio/group-sessions", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!satisfiesRole(user.role, ["admin"])) { res.status(403).json(message("Only admins can plan a group session")); return; }

  const body = PlanGroupSessionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }
  if (!simulationAiConfigured()) {
    res.status(503).json(message("The Studio needs an AI key on the server before it can plan a session."));
    return;
  }

  const programme = await programmeContext(body.data.programId);
  if (!programme) { res.status(404).json(message("Programme not found")); return; }

  const [row] = await db.select().from(programsTable).where(eq(programsTable.id, body.data.programId));
  const moduleTitles = programme.moduleTitles ?? [];
  const objective = objectiveFor({
    programmeTitle: row.title,
    programmeDescription: row.description,
    moduleTitles,
  });
  const durationMinutes = body.data.durationMinutes ?? GROUP_SESSION_MINUTES;

  // The situation is drawn the same way an individual's is, from a seed — so a
  // second session on the same programme is a different crisis rather than the
  // same one again.
  const seed = `group:${body.data.programId}:${randomBytes(6).toString("hex")}`;
  const situation = situationFor(seed);

  const scenario = await generateScenario({
    sectorTopic: situationBrief(situation),
    objective,
    participantPerspective: "Head of Communications",
    mode: "facilitated",
    difficulty: body.data.difficulty ?? "intermediate",
    durationMinutes,
    programme,
  });
  if (!scenario.ok) {
    req.log.error({ reason: scenario.error, by: user.id }, "Group scenario generation failed");
    res.status(502).json(message(scenario.error));
    return;
  }

  const plan = await generateGroupPlan({
    openingBrief: scenario.value.openingBrief,
    teams: scenario.value.stakeholderGroups.map((g) => ({ id: g.id, name: g.name, roleName: g.roleName })),
    objective,
    durationMinutes,
    programme,
  });
  if (!plan.ok) {
    req.log.error({ reason: plan.error, by: user.id }, "Group plan generation failed");
    res.status(502).json(message(plan.error));
    return;
  }

  const [definition] = await db.insert(simulationDefinitionsTable).values({
    ownerId: user.id, programId: body.data.programId,
    // Not published. A group scenario is not something a learner opens on their
    // own — they reach it only through the session, when it goes live.
    published: false,
    mode: "facilitated", title: scenario.value.title, context: situationBrief(situation),
    learningObjective: objective, difficulty: body.data.difficulty ?? "intermediate",
    durationMinutes, participantPerspective: "Head of Communications",
    openingBrief: scenario.value.openingBrief, groups: scenario.value.stakeholderGroups,
    injects: [openingInject(scenario.value.initialDevelopment)],
    evaluationDimensions: scenario.value.evaluationDimensions,
    debriefQuestions: scenario.value.debriefQuestions,
  }).returning();

  const [session] = await db.insert(studioGroupSessionsTable).values({
    programId: body.data.programId,
    definitionId: definition.id,
    title: scenario.value.title,
    objectives: plan.value.objectives,
    beats: plan.value.beats.map((b) => ({
      id: b.id, atMinute: b.atMinute, scope: b.scope, title: b.title,
      content: b.content, responsePrompt: b.responsePrompt, responseMinutes: b.responseMinutes,
    })),
    scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : null,
    durationMinutes,
    createdByUserId: user.id,
  }).returning();

  req.log.info({ sessionId: session.id, programId: body.data.programId, by: user.id }, "Group session drafted");
  res.status(201).json(GetGroupSessionResponse.parse(await groupSessionView(session)));
});

/** Read one, to approve it. */
router.get("/admin/studio/group-sessions/:id", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!satisfiesRole(user.role, ["admin"])) { res.status(403).json(message("Only admins can read a group session")); return; }

  const session = await groupSession(Number(req.params.id));
  if (!session) { res.status(404).json(message("Session not found")); return; }
  res.json(GetGroupSessionResponse.parse(await groupSessionView(session)));
});

/**
 * Change what it tests, or when it runs.
 *
 * Only while it is a draft. Once approved the cohort has been told what they are
 * turning up to, and editing the exercise underneath them is not an edit.
 */
router.patch("/admin/studio/group-sessions/:id", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!satisfiesRole(user.role, ["admin"])) { res.status(403).json(message("Only admins can edit a group session")); return; }

  const body = EditGroupSessionBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }

  const session = await groupSession(Number(req.params.id));
  if (!session) { res.status(404).json(message("Session not found")); return; }
  if (!mayEditSession(groupSessionState(sessionFacts(session), Date.now()))) {
    res.status(409).json(message(
      "This session has already been approved, and the cohort has been told what they are turning up "
      + "to. Cancel it and plan another rather than changing this one underneath them.",
    ));
    return;
  }

  const objectives = body.data.objectives
    ? session.objectives.map((existing) => {
      const edit = body.data.objectives!.find((o) => o.id === existing.id);
      return edit ? { ...existing, text: edit.text ?? existing.text, enabled: edit.enabled ?? existing.enabled } : existing;
    })
    : session.objectives;

  const [updated] = await db.update(studioGroupSessionsTable)
    .set({
      objectives,
      ...(body.data.scheduledAt !== undefined
        ? { scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : null }
        : {}),
    })
    .where(eq(studioGroupSessionsTable.id, session.id))
    .returning();

  res.json(GetGroupSessionResponse.parse(await groupSessionView(updated)));
});

/**
 * Make it live.
 *
 * The one irreversible press on this screen, so everything that could refuse it
 * refuses here rather than after the cohort has been told.
 */
router.post("/admin/studio/group-sessions/:id/approve", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!satisfiesRole(user.role, ["admin"])) { res.status(403).json(message("Only admins can approve a group session")); return; }

  const session = await groupSession(Number(req.params.id));
  if (!session) { res.status(404).json(message("Session not found")); return; }
  if (groupSessionState(sessionFacts(session), Date.now()) !== "draft") {
    res.status(409).json(message("This session has already been approved.")); return;
  }

  const [definition] = await db.select().from(simulationDefinitionsTable)
    .where(eq(simulationDefinitionsTable.id, session.definitionId));
  const [{ learners }] = await db
    .select({ learners: sql<number>`count(*)::int` })
    .from(enrollmentsTable)
    .where(and(
      eq(enrollmentsTable.programId, session.programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));

  const problem = approvalProblem({
    objectives: session.objectives,
    beats: session.beats,
    scheduledAt: session.scheduledAt?.toISOString() ?? null,
    durationMinutes: session.durationMinutes,
    nowMs: Date.now(),
    learners,
    teams: definition?.groups.length ?? 0,
  });
  if (problem) { res.status(400).json(message(problem)); return; }

  const [approved] = await db.update(studioGroupSessionsTable)
    .set({ approvedByUserId: user.id, approvedAt: new Date() })
    .where(and(eq(studioGroupSessionsTable.id, session.id), isNull(studioGroupSessionsTable.approvedAt)))
    .returning();
  if (!approved) { res.status(409).json(message("Somebody approved this a moment ago.")); return; }

  req.log.info({ sessionId: session.id, by: user.id }, "Group session approved");
  res.json(GetGroupSessionResponse.parse(await groupSessionView(approved)));
});

/** Every session on a programme, newest first. */
router.get("/admin/studio/group-sessions", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!satisfiesRole(user.role, ["admin"])) { res.status(403).json(message("Only admins can list group sessions")); return; }

  const sessions = await db.select().from(studioGroupSessionsTable)
    .orderBy(sql`${studioGroupSessionsTable.createdAt} desc`)
    .limit(30);
  res.json(ListGroupSessionsResponse.parse(await Promise.all(sessions.map(groupSessionView))));
});

/* ------------------------------------------------------------------ *
 * The cohort's group session, as a learner sees it
 * ------------------------------------------------------------------ */

/**
 * What my cohort is turning up to, and whether the door is open yet.
 *
 * A group session has no join code and no individual invitation, which is the
 * whole design: the cohort is the room. That leaves one problem this route
 * exists to solve — nothing anywhere told the learner. The ticker was putting
 * people in teams at three o'clock and none of them had a way to find out.
 *
 * Deliberately says almost nothing before it starts. Not the crisis, not the
 * teams, not what it is testing: a cohort that reads the brief the night before
 * is not being tested on composure, it is being tested on preparation, which is
 * a different exercise and one they can already practise alone.
 */
router.get("/studio/my-group-session", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }

  const session = await cohortSessionFor(user.id);
  if (!session) { res.json(GetMyGroupSessionResponse.parse({ hasSession: false })); return; }

  const now = Date.now();
  const state = groupSessionState(sessionFacts(session), now);
  // Draft never reaches here — `cohortSessionFor` asks for approved ones — but
  // if it ever did, a learner must not be shown a session nobody has read.
  if (state === "draft") { res.json(GetMyGroupSessionResponse.parse({ hasSession: false })); return; }

  // Which team they are on, once the ticker has decided. Before it starts there
  // is no answer, because the teams are made from who is actually enrolled at
  // the moment it begins rather than from who was enrolled when it was planned.
  let teamName: string | null = null;
  if (session.runId) {
    const [assignment] = await db
      .select({ groupId: simulationGroupAssignmentsTable.groupId })
      .from(simulationGroupAssignmentsTable)
      .where(and(
        eq(simulationGroupAssignmentsTable.runId, session.runId),
        eq(simulationGroupAssignmentsTable.userId, user.id),
      ));
    if (assignment) {
      const [definition] = await db.select({ groups: simulationDefinitionsTable.groups })
        .from(simulationDefinitionsTable)
        .where(eq(simulationDefinitionsTable.id, session.definitionId));
      teamName = definition?.groups.find((g) => g.id === assignment.groupId)?.name ?? null;
    }
  }

  const left = session.startedAt
    ? minutesLeft({
      startedAtMs: session.startedAt.getTime(),
      durationMinutes: session.durationMinutes,
      nowMs: now,
    })
    : null;

  res.json(GetMyGroupSessionResponse.parse({
    hasSession: true,
    id: session.id,
    title: session.title,
    state,
    scheduledAt: session.scheduledAt?.toISOString() ?? null,
    durationMinutes: session.durationMinutes,
    teamName,
    // The room, whenever there is one. Before the session starts there is no
    // run at all, so there is nothing to withhold; afterwards this is where the
    // team's debrief lives, which is the only reason to go back.
    runId: session.runId,
    // Whether the door is open, which is a different question. A finished
    // session still has a run, and "Go in" on a session that ended an hour ago
    // is the kind of small lie a screen never recovers from.
    mayEnter: mayEnterRoom(state) && !!session.runId,
    note: cohortNote({
      state,
      startsIn: startsInMinutes(session.scheduledAt?.toISOString() ?? null, now),
      teamName,
      durationMinutes: session.durationMinutes,
      minutesLeft: left,
    }),
  }));
});

/* ------------------------------------------------------------------ *
 * The invited learner's own exercise
 * ------------------------------------------------------------------ */

/**
 * Everything a learner needs to see before they begin, and nothing to fill in.
 *
 * The Studio used to open on a form: a subject, an objective, a perspective, a
 * difficulty, a length. Five decisions asked of the person least placed to make
 * them, each one a chance to practise the wrong thing, and every submission a
 * model call. The objective now comes from the programme, and the situation
 * from their invitation, so there is one button.
 */
router.get("/studio/my-exercise", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }

  const invite = await openInvitationFor(user.id);
  if (!invite) {
    /*
      No invitation, but on a cohort: they are waiting for one rather than
      choosing. Said out loud, because the alternative is an empty Studio that
      looks broken — which is what a learner on a granted cohort was getting the
      moment the form was taken away from them.
    */
    res.json(GetMyStudioExerciseResponse.parse({
      hasInvitation: false,
      awaiting: await handedTheirExercise(user),
    }));
    return;
  }

  const facts = inviteFacts(invite);
  const situation = situationFor(invite.situationSeed);
  const state = inviteState(facts, Date.now());

  res.json(GetMyStudioExerciseResponse.parse({
    hasInvitation: true,
    state,
    objective: invite.objective,
    // On a programme the situation is drawn, so that no two people on a cohort
    // get the same crisis. On a standalone there is no cohort to differentiate,
    // and the admin's own words are the only thing that says what this is.
    /*
      The steer is not shown. It is the admin's instruction to the model, and a
      learner reading "make them face a community meeting" has been told what
      the crisis will turn on before it turns.
    */
    situation: invite.subject.trim() || situationSummary(situation),
    moduleTitle: await moduleTitleFor(invite.sessionId),
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    opensAt: invite.opensAt?.toISOString() ?? null,
    durationMinutes: invite.durationMinutes,
    difficulty: invite.difficulty,
    runId: invite.runId,
    problem: state === "ready" ? null : beginProblem(facts, Date.now()),
  }));
});

/**
 * Begin — or, if they have already begun, go back to where they were.
 *
 * Two things this must never do. It must never mint a second run from one
 * invitation: closing the tab is not a way to start again with a fresh clock,
 * and an exercise you can restart is not an exercise. And it must never ask the
 * model twice for the same invitation, because that is somebody's money.
 *
 * So the invitation is claimed first, in its own small write, before anything
 * slow happens. Whoever wins the claim generates; anybody else — a second tab,
 * a double press, an impatient refresh — reads "already started" and is sent to
 * the run. If the generation then fails, the claim is released, because an
 * invitation spent on a scenario that never existed is a learner who cannot
 * practise and an admin who cannot see why.
 */
router.post("/studio/my-exercise/begin", requireStudioAccess, async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }

  const invite = await openInvitationFor(user.id);
  if (!invite) { res.status(403).json(message("You have not been invited to run an exercise.")); return; }

  const now = Date.now();
  const state = inviteState(inviteFacts(invite), now);

  // Already running: hand back the same run. This is the ordinary path for
  // somebody whose laptop died, and it must be indistinguishable from never
  // having left.
  if (state === "in-progress" && invite.runId) {
    res.json(BeginStudioExerciseResponse.parse({ runId: invite.runId, resumed: true }));
    return;
  }
  if (state !== "ready") {
    res.status(409).json(message(beginProblem(inviteFacts(invite), now) ?? "This invitation cannot be used."));
    return;
  }

  if (!simulationAiConfigured()) {
    res.status(503).json(message("The Studio needs an AI key on the server before it can write exercises."));
    return;
  }

  // Claim it. Conditional on nobody else having done so, so two presses cannot
  // both pass.
  const [claimed] = await db
    .update(studioInvitationsTable)
    .set({ startedAt: new Date() })
    .where(and(
      eq(studioInvitationsTable.id, invite.id),
      isNull(studioInvitationsTable.startedAt),
      isNull(studioInvitationsTable.runId),
    ))
    .returning({ id: studioInvitationsTable.id });
  if (!claimed) {
    const fresh = await openInvitationFor(user.id);
    if (fresh?.runId) { res.json(BeginStudioExerciseResponse.parse({ runId: fresh.runId, resumed: true })); return; }
    res.status(409).json(message("This exercise is already starting. Give it a moment and refresh."));
    return;
  }

  const releaseClaim = async () => {
    await db.update(studioInvitationsTable)
      .set({ startedAt: null })
      .where(and(eq(studioInvitationsTable.id, invite.id), isNull(studioInvitationsTable.runId)));
  };

  try {
    const situation = situationFor(invite.situationSeed);
    // Null on a standalone exercise, which has no programme behind it at all.
    const programme = invite.programId ? await programmeContext(invite.programId) : null;

    const generated = await generateScenario({
      sectorTopic: exerciseSubject({
        subject: invite.subject,
        drawn: situationBrief(situation),
        hasProgramme: !!invite.programId,
      }),
      objective: invite.objective,
      participantPerspective: "Head of Communications",
      mode: "autonomous",
      difficulty: invite.difficulty as "foundation" | "intermediate" | "advanced",
      durationMinutes: invite.durationMinutes,
      steer: invite.steer,
      programme,
    });
    if (!generated.ok) {
      await releaseClaim();
      req.log.error({ reason: generated.error, userId: user.id, inviteId: invite.id }, "Studio exercise generation failed");
      res.status(502).json(message(generated.error));
      return;
    }
    const scenario = generated.value;

    // Theirs alone: not published, so no one else on the cohort can open the
    // crisis they were given. That is what makes forty-five different
    // situations worth generating in the first place.
    const [definition] = await db.insert(simulationDefinitionsTable).values({
      ownerId: user.id, programId: invite.programId, published: false, mode: "autonomous",
      title: scenario.title, context: situationBrief(situation), learningObjective: invite.objective,
      difficulty: invite.difficulty, durationMinutes: invite.durationMinutes,
      participantPerspective: "Head of Communications", openingBrief: scenario.openingBrief,
      groups: scenario.stakeholderGroups,
      injects: [openingInject(scenario.initialDevelopment)],
      evaluationDimensions: scenario.evaluationDimensions, debriefQuestions: scenario.debriefQuestions,
    }).returning();

    const initial = definition.injects[0];
    if (!initial || definition.groups.length === 0) {
      await releaseClaim();
      res.status(502).json(message("The exercise came back without an opening. Press Begin again."));
      return;
    }

    const startedAt = new Date();
    const [run] = await db.insert(simulationRunsTable).values({
      ownerId: user.id, definitionId: definition.id, mode: "autonomous", status: "active",
      joinCode: null,
      currentDevelopment: withDeadline(initial, startedAt),
      developments: [withDeadline(initial, startedAt)], startedAt,
    }).returning();
    await db.insert(simulationGroupAssignmentsTable)
      .values({ runId: run.id, userId: user.id, groupId: definition.groups[0].id });

    await db.update(studioInvitationsTable)
      .set({ definitionId: definition.id, runId: run.id })
      .where(eq(studioInvitationsTable.id, invite.id));

    req.log.info({ inviteId: invite.id, runId: run.id, userId: user.id }, "Invited learner began their exercise");
    res.status(201).json(BeginStudioExerciseResponse.parse({ runId: run.id, resumed: false }));
  } catch (err) {
    await releaseClaim();
    throw err;
  }
});

/**
 * Invite a module's learners to run it, once each.
 *
 * The objective is read from the module now and written onto every invitation,
 * rather than looked up when each learner presses Begin. Somebody asked on
 * Monday to practise one thing must not be judged on Thursday against a
 * different one because a description was tidied up in between.
 */
router.post("/admin/studio/invitations", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!satisfiesRole(user.role, ["admin"])) { res.status(403).json(message("Only admins can invite learners to the Studio")); return; }

  const body = InviteToStudioBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }

  // The dials, checked before anything is written. Said back in the admin's
  // own terms rather than as a validation error, because these are choices
  // rather than mistakes.
  const badSteer = steerProblem(body.data.steer);
  if (badSteer) { res.status(400).json(message(badSteer)); return; }
  const badLength = durationProblem(body.data.durationMinutes ?? 30);
  if (badLength) { res.status(400).json(message(badLength)); return; }
  const badWindow = validityProblem({
    opensAt: body.data.opensAt?.toISOString() ?? null,
    expiresAt: body.data.expiresAt?.toISOString() ?? null,
  }, Date.now());
  if (badWindow) { res.status(400).json(message(badWindow)); return; }

  const [programme] = await db.select().from(programsTable).where(eq(programsTable.id, body.data.programId));
  if (!programme) { res.status(404).json(message("Programme not found")); return; }

  /*
    The objective is the programme's, not a module's.

    A communicator's job is not divided into weeks: handling a tariff
    announcement wants what one module said about explaining a price, what
    another said about the regulator, and whatever the first one said about
    saying the thing plainly. Pinning the exercise to the most recent module
    rehearsed the timetable rather than the work.

    `sessionId` is still accepted so that an existing caller does not break, and
    it is recorded on the invitation as a note of what prompted it — but it no
    longer decides what anybody practises.
  */
  let module: typeof sessionsTable.$inferSelect | null = null;
  if (body.data.sessionId) {
    const [found] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, body.data.sessionId));
    if (!found || found.programId !== programme.id) {
      res.status(404).json(message("That module is not on this programme")); return;
    }
    module = found;
  }

  const moduleTitles = (await db
    .select({ title: sessionsTable.title })
    .from(sessionsTable)
    .where(eq(sessionsTable.programId, programme.id))
    .orderBy(asc(sessionsTable.startsAt), asc(sessionsTable.id)))
    .map((m) => m.title)
    .filter(Boolean);

  const objective = objectiveFor({
    programmeTitle: programme.title,
    programmeDescription: programme.description,
    moduleTitles,
  });

  const learners = await db
    .select({ id: usersTable.id })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(enrollmentsTable.userId, usersTable.id))
    .where(and(
      eq(enrollmentsTable.programId, programme.id),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));

  // Who is already holding one they have not used. Re-inviting them would hand
  // out a second run, and the quiet version of that is a token bill nobody can
  // account for.
  const open = await db
    .select({
      userId: studioInvitationsTable.userId, runId: studioInvitationsTable.runId,
      startedAt: studioInvitationsTable.startedAt, completedAt: studioInvitationsTable.completedAt,
      opensAt: studioInvitationsTable.opensAt, expiresAt: studioInvitationsTable.expiresAt,
    })
    .from(studioInvitationsTable)
    .where(eq(studioInvitationsTable.programId, programme.id));
  const holdsOne = new Set(
    open.filter((o) => inviteState(inviteFacts(o), Date.now()) !== "spent"
      && inviteState(inviteFacts(o), Date.now()) !== "expired").map((o) => o.userId),
  );

  const toInvite = learners.filter((l) => !holdsOne.has(l.id));
  const refusal = invitationProblem({ objective, hasOpenInvitation: false, enrolled: true });
  if (refusal) { res.status(400).json(message(refusal)); return; }

  if (toInvite.length > 0) {
    await db.insert(studioInvitationsTable).values(toInvite.map((l) => ({
      userId: l.id,
      programId: programme.id,
      sessionId: module?.id ?? null,
      objective,
      // Unique per learner per invitation, so two people on the same module
      // get different crises and one person re-invited later gets a new one.
      situationSeed: `${programme.id}:${module?.id ?? 0}:${l.id}:${randomBytes(4).toString("hex")}`,
      steer: (body.data.steer ?? "").trim(),
      difficulty: body.data.difficulty ?? "intermediate",
      durationMinutes: body.data.durationMinutes ?? 30,
      invitedByUserId: user.id,
      opensAt: body.data.opensAt ? new Date(body.data.opensAt) : null,
      expiresAt: body.data.expiresAt ? new Date(body.data.expiresAt) : null,
    })));
  }

  req.log.info({ programId: programme.id, sessionId: module?.id ?? null, invited: toInvite.length, by: user.id }, "Invited learners to the Studio");
  res.status(201).json(InviteToStudioResponse.parse({
    invited: toInvite.length,
    alreadyHad: learners.length - toInvite.length,
    objective,
    note: invitationNote({
      invited: toInvite.length,
      alreadyHad: learners.length - toInvite.length,
      moduleTitle: programme.title,
    }),
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
  // On a cohort, so their exercise is chosen for them rather than written to
  // order. This is the expensive door: every submission of that form is a model
  // call on somebody else's meter.
  if (await handedTheirExercise(user)) {
    res.status(403).json(message(
      "Your exercises come from your programme. Your facilitator sends them; there is nothing to fill in.",
    ));
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
    injects: [openingInject(scenario.initialDevelopment)], evaluationDimensions: scenario.evaluationDimensions,
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
  /*
    An invited learner does not start runs from here.

    Their exercise is the one their invitation names, begun once through
    /studio/my-exercise/begin. Without this, the invitation would govern nothing
    — anybody could open a published cohort exercise and run it as often as they
    liked, which is the spending and the unbounded practice the invitation
    exists to end. Admins still use this route to try exercises out, and so do
    people who got in on an access code, who are not on a programme and have no
    invitation to honour.
  */
  if (!runnerIsAdmin) {
    const invite = await openInvitationFor(user.id);
    if (invite) {
      res.status(403).json(message(
        "Your exercise is the one you were invited to. Open the Studio and press Begin.",
      ));
      return;
    }
    // Same reason, one door along. Somebody on a cohort runs the exercise they
    // were sent, not one they picked off the shelf.
    if (await handedTheirExercise(user)) {
      res.status(403).json(message(
        "Your exercises come from your programme. Open the Studio and it will be waiting.",
      ));
      return;
    }
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
    if (says !== "nothing") {
      // Started rather than waited for: the person asked to see their
      // exercise, and they should see it now, with a note that something is
      // being written. It arrives on the next poll, a second or two later.
      await startStep(run.id, says === "finish" ? "finish" : "carryOn", req.log);
      const [fresh] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, run.id));
      if (fresh) run = fresh;
    }
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
    // Started, not awaited. The answer is saved and the page comes straight
    // back; whatever happens next arrives on the next poll.
    await startStep(saved.id, step === "finish" ? "finish" : "carryOn", req.log);
    const [fresh] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, saved.id));
    res.json(SubmitSimulationResponseResponse.parse(await runView(fresh ?? saved, user.id)));
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