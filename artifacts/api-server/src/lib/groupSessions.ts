import {
  db, enrollmentsTable, simulationDefinitionsTable, simulationGroupAssignmentsTable,
  simulationResponsesTable, simulationRunsTable, studioGroupSessionsTable, usersTable,
  type SimulationDebrief, type SimulationDevelopment,
} from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  groupSessionState, whatTheTickerShouldDo, needsClosing, assignTeams, emptyTeams,
  publicRecord, minutesLeft, wentLiveNote, clampResponseSeconds, developmentsForTeam,
} from "@workspace/domain";
import {
  generateDebrief, generateSessionDebrief, generateTeamBeat, simulationAiConfigured,
} from "./simulationAi";
import { logger } from "./logger";

/**
 * The thing that runs a group session when nobody is running it.
 *
 * The facilitated mode this replaces needed a person to press "what happens
 * next" at every beat. That person was also the only one who could see
 * everything, so they were operating the exercise rather than watching it — and
 * a room without them stalled after the opening development.
 *
 * So a timer. Every pass it asks each session one question and does at most one
 * thing: start it, deliver what is due, or close it. At most one, because a
 * timer running every few seconds that could do two would eventually start a
 * session and end it in the same breath.
 *
 * Everything is decided from the session's own timestamps rather than from a
 * counter, so a server that restarts mid-session picks up where the clock says
 * it is rather than where a count had got to. That is not a nicety: Railway
 * restarts containers on deploy, and a cohort would be mid-exercise.
 */

const TICK_EVERY_MS = 20 * 1000;

export function startGroupSessionTicker(): void {
  setInterval(() => void tick(), TICK_EVERY_MS);
  logger.info("Group session ticker scheduled");
}

async function tick(): Promise<void> {
  try {
    // Only sessions that could possibly need something: approved, not closed.
    const sessions = await db
      .select()
      .from(studioGroupSessionsTable)
      .where(and(
        sql`${studioGroupSessionsTable.approvedAt} is not null`,
        isNull(studioGroupSessionsTable.endedAt),
      ));

    for (const session of sessions) {
      await advance(session).catch((err) => {
        // One bad session must not stop the others. A room whose scenario is
        // broken is a room that gets no developments; a ticker that throws is
        // every room in the Lab getting none.
        logger.error({ err, sessionId: session.id }, "Group session tick failed");
      });
    }
  } catch (err) {
    logger.error({ err }, "Group session ticker failed");
  }
}

type Session = typeof studioGroupSessionsTable.$inferSelect;

function facts(session: Session) {
  return {
    scheduledAt: session.scheduledAt?.toISOString() ?? null,
    approvedAt: session.approvedAt?.toISOString() ?? null,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    durationMinutes: session.durationMinutes,
  };
}

async function advance(session: Session): Promise<void> {
  const now = Date.now();

  // Closing is asked first and separately, because it is the expensive question
  // — a debrief per team plus a shared one — and the cheap one below should not
  // have to carry it.
  if (needsClosing(facts(session), now)) {
    await close(session);
    return;
  }

  const action = whatTheTickerShouldDo({
    facts: facts(session),
    beats: session.beats,
    delivered: session.deliveredBeatIds,
    nowMs: now,
  });

  if (action.do === "start") { await goLive(session); return; }
  if (action.do === "deliver") { await deliver(session, action.beats); return; }
}

/* ------------------------------------------------------------------ *
 * Starting
 * ------------------------------------------------------------------ */

/**
 * Put everybody in a team and open the room.
 *
 * The write that creates the run is conditional on `startedAt` still being
 * empty, so two containers ticking at the same second cannot both start the
 * same session — which would put every learner in two teams and deliver every
 * beat twice.
 */
async function goLive(session: Session): Promise<void> {
  const [definition] = await db.select().from(simulationDefinitionsTable)
    .where(eq(simulationDefinitionsTable.id, session.definitionId));
  if (!definition || definition.groups.length === 0) {
    logger.error({ sessionId: session.id }, "Group session has no teams; not starting");
    return;
  }

  const learners = await db
    .select({ id: usersTable.id })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
    .where(and(
      eq(enrollmentsTable.programId, session.programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ))
    .orderBy(asc(enrollmentsTable.id));

  const startedAt = new Date();
  const opening = definition.injects[0];

  const [run] = await db.insert(simulationRunsTable).values({
    ownerId: session.createdByUserId,
    definitionId: definition.id,
    mode: "facilitated",
    status: "active",
    // No join code. Nobody types their way into this one — the cohort is the
    // room, and a code would be a way in for somebody who is not on it.
    joinCode: null,
    currentDevelopment: opening ? withTeam(opening, null, startedAt, session.durationMinutes) : null,
    developments: opening ? [withTeam(opening, null, startedAt, session.durationMinutes)] : [],
    startedAt,
  }).returning();

  const claimed = await db.update(studioGroupSessionsTable)
    .set({ runId: run.id, startedAt })
    .where(and(eq(studioGroupSessionsTable.id, session.id), isNull(studioGroupSessionsTable.startedAt)))
    .returning({ id: studioGroupSessionsTable.id });

  if (claimed.length === 0) {
    // Another container got there first. Undo ours rather than leaving an
    // orphan run that nobody is in and nothing will ever end.
    await db.delete(simulationRunsTable).where(eq(simulationRunsTable.id, run.id));
    return;
  }

  const teamIds = definition.groups.map((g) => g.id);
  const filled = assignTeams(learners.map((l) => l.id), teamIds);
  const rows = [...filled.entries()].flatMap(([groupId, members]) =>
    members.map((userId) => ({ runId: run.id, userId, groupId })));
  if (rows.length > 0) {
    await db.insert(simulationGroupAssignmentsTable).values(rows).onConflictDoNothing();
  }

  const empty = emptyTeams(filled)
    .map((id) => definition.groups.find((g) => g.id === id)?.name ?? id);

  logger.info(
    {
      sessionId: session.id, runId: run.id, learners: learners.length,
      teams: teamIds.length, empty,
    },
    wentLiveNote({
      learners: learners.length, teams: teamIds.length, empty,
      durationMinutes: session.durationMinutes,
    }),
  );
}

function withTeam(
  development: { id: string; title: string; content: string; responsePrompt: string; responseSeconds?: number },
  teamId: string | null,
  at: Date,
  durationMinutes: number,
): SimulationDevelopment {
  const seconds = clampResponseSeconds(development.responseSeconds ?? durationMinutes * 60);
  return {
    id: development.id,
    title: development.title,
    content: development.content,
    responsePrompt: development.responsePrompt,
    responseSeconds: seconds,
    dueAt: new Date(at.getTime() + seconds * 1000).toISOString(),
    at: at.toISOString(),
    ...(teamId ? { teamId } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Delivering
 * ------------------------------------------------------------------ */

async function deliver(session: Session, beats: { id: string; scope: "all" | "team"; title: string; content: string; responsePrompt: string; responseMinutes: number }[]): Promise<void> {
  if (!session.runId || !session.startedAt) return;

  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, session.runId));
  if (!run || run.status !== "active") return;

  const [definition] = await db.select().from(simulationDefinitionsTable)
    .where(eq(simulationDefinitionsTable.id, session.definitionId));
  if (!definition) return;

  const now = new Date();
  const left = minutesLeft({
    startedAtMs: session.startedAt.getTime(),
    durationMinutes: session.durationMinutes,
    nowMs: now.getTime(),
  });

  const added: SimulationDevelopment[] = [];

  for (const beat of beats) {
    if (beat.scope === "all") {
      added.push(withTeam(
        { ...beat, responseSeconds: beat.responseMinutes * 60 }, null, now, session.durationMinutes,
      ));
      continue;
    }

    // A team beat, which needs writing from what actually happened. Without a
    // key there is nothing to write it with, so the beat is skipped rather than
    // delivered empty — an approved intent with no words in it would read to a
    // team as the exercise breaking.
    if (!simulationAiConfigured()) continue;

    const team = pickTeam(definition.groups, run.id, beat.id);
    if (!team) continue;

    const answers = await db
      .select({ groupId: simulationResponsesTable.groupId, body: simulationResponsesTable.body })
      .from(simulationResponsesTable)
      .where(eq(simulationResponsesTable.runId, run.id))
      .orderBy(asc(simulationResponsesTable.createdAt));

    const written = await generateTeamBeat({
      beatId: beat.id,
      openingBrief: definition.openingBrief,
      teamName: team.name,
      teamRole: team.roleName,
      intent: beat.content,
      responsePrompt: beat.responsePrompt,
      ownAnswers: answers.filter((a) => a.groupId === team.id).map((a) => a.body),
      published: publicRecord(
        answers.map((a) => ({ teamId: a.groupId, body: a.body })), team.id,
      ).map((a) => ({
        teamName: definition.groups.find((g) => g.id === a.teamId)?.name ?? a.teamId,
        body: a.body,
      })),
      minutesLeft: left,
    });
    if (!written.ok) {
      logger.error({ sessionId: session.id, beatId: beat.id, reason: written.error }, "Team beat failed");
      continue;
    }

    added.push(withTeam(
      { ...written.value, responseSeconds: beat.responseMinutes * 60 },
      team.id, now, session.durationMinutes,
    ));
  }

  if (added.length === 0) return;

  await db.update(simulationRunsTable)
    .set({
      developments: [...run.developments, ...added],
      // The shared beat is what everybody's clock reads from, so a team beat
      // does not become the room's current one.
      currentDevelopment: added.find((d) => !d.teamId) ?? run.currentDevelopment,
    })
    .where(eq(simulationRunsTable.id, run.id));

  await db.update(studioGroupSessionsTable)
    .set({ deliveredBeatIds: [...session.deliveredBeatIds, ...added.map((d) => d.id)] })
    .where(eq(studioGroupSessionsTable.id, session.id));

  logger.info({ sessionId: session.id, delivered: added.map((d) => d.id) }, "Group session beats delivered");
}

/**
 * Which team a beat lands on.
 *
 * The plan names one, but a model can name a team that does not exist, and a
 * beat aimed at nobody is a beat nobody gets. Falling back to a stable choice
 * from the beat's own id keeps the session moving and keeps it deterministic —
 * the same beat lands on the same team however many times this runs.
 */
function pickTeam(
  groups: readonly { id: string; name: string; roleName: string }[],
  runId: number,
  beatId: string,
): { id: string; name: string; roleName: string } | null {
  if (groups.length === 0) return null;
  let hash = 0;
  for (const ch of `${runId}:${beatId}`) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return groups[hash % groups.length];
}

/* ------------------------------------------------------------------ *
 * Closing
 * ------------------------------------------------------------------ */

/**
 * End it, and write the debriefs: one per team, and one across the room.
 *
 * The shared one is the only view in the Studio that reads across teams. It is
 * an admin's alone, and it is the genuinely new thing a group exercise
 * produces: each team only ever saw its own side, so where two teams' versions
 * of events failed to line up is invisible to every person who was in it.
 */
async function close(session: Session): Promise<void> {
  const endedAt = new Date();

  // Claim it first. Writing a debrief per team is slow, and a second container
  // arriving mid-write would produce a second set and overwrite the first.
  const claimed = await db.update(studioGroupSessionsTable)
    .set({ endedAt })
    .where(and(eq(studioGroupSessionsTable.id, session.id), isNull(studioGroupSessionsTable.endedAt)))
    .returning({ id: studioGroupSessionsTable.id });
  if (claimed.length === 0) return;

  if (!session.runId) return;
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, session.runId));
  const [definition] = await db.select().from(simulationDefinitionsTable)
    .where(eq(simulationDefinitionsTable.id, session.definitionId));
  if (!run || !definition) return;

  await db.update(simulationRunsTable)
    .set({ status: "completed", endedAt })
    .where(eq(simulationRunsTable.id, run.id));

  if (!simulationAiConfigured()) {
    logger.warn({ sessionId: session.id }, "Group session ended with no AI key, so no debriefs");
    return;
  }

  const answers = await db
    .select({
      groupId: simulationResponsesTable.groupId,
      injectId: simulationResponsesTable.injectId,
      body: simulationResponsesTable.body,
    })
    .from(simulationResponsesTable)
    .where(eq(simulationResponsesTable.runId, run.id))
    .orderBy(asc(simulationResponsesTable.createdAt));

  /*
   * A debrief per team, written before the shared one.
   *
   * This order is on purpose. The teams are the people actually waiting — the
   * admin's cross-team read can arrive a minute later — and if the shared one
   * fails, everybody who was in the room still has theirs.
   *
   * Each team is judged on the feed it actually had: the beats everybody got,
   * plus the ones aimed at it, and nothing aimed at anybody else. Marking a
   * team on a development it never saw would be marking it on somebody else's
   * exercise.
   */
  const teamDebriefs: { teamId: string; debrief: SimulationDebrief }[] = [];
  for (const group of definition.groups) {
    const theirs = developmentsForTeam(run.developments, group.id);
    const debrief = await generateDebrief({
      openingBrief: definition.openingBrief,
      evaluationDimensions: definition.evaluationDimensions,
      debriefQuestions: definition.debriefQuestions,
      history: theirs.map((development) => ({
        title: development.title,
        content: development.content,
        // Silence is an answer in this exercise, and the debrief has to see it
        // as one rather than as a development that never happened.
        response: answers.find(
          (a) => a.groupId === group.id && a.injectId === development.id,
        )?.body ?? null,
      })),
    });
    if (!debrief.ok) {
      logger.error(
        { sessionId: session.id, teamId: group.id, reason: debrief.error },
        "Team debrief failed",
      );
      continue;
    }
    teamDebriefs.push({ teamId: group.id, debrief: debrief.value });
  }

  if (teamDebriefs.length > 0) {
    await db.update(simulationRunsTable)
      .set({ teamDebriefs, debriefAt: new Date() })
      .where(eq(simulationRunsTable.id, run.id));
  }

  const written = await generateSessionDebrief({
    openingBrief: definition.openingBrief,
    objectives: session.objectives.filter((o) => o.enabled).map((o) => o.text),
    teams: definition.groups.map((group) => ({
      name: group.name,
      roleName: group.roleName,
      answers: answers.filter((a) => a.groupId === group.id).map((a) => a.body),
    })),
    durationMinutes: session.durationMinutes,
  });

  if (!written.ok) {
    logger.error({ sessionId: session.id, reason: written.error }, "Session debrief failed");
    return;
  }

  await db.update(studioGroupSessionsTable)
    .set({ sessionDebrief: written.value })
    .where(eq(studioGroupSessionsTable.id, session.id));

  logger.info({ sessionId: session.id }, "Group session closed and debriefed");
}

/** Exported for the live tests, which drive the clock rather than waiting for it. */
export const groupSessionInternals = { tick, advance, goLive, close };
export { groupSessionState };
