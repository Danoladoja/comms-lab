import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  simulationRunsTable,
  simulationDefinitionsTable,
  simulationGroupAssignmentsTable,
  simulationResponsesTable,
  teamRoomMessagesTable,
  teamRoomVotesTable,
  teamRoomDraftsTable,
  teamRoomNodsTable,
  usersTable,
} from "@workspace/db";
import {
  GetTeamRoomResponse, SendTeamRoomMessageBody, VoteForTeamLeaderBody,
  SaveTeamRoomDraftBody, NodTeamRoomDraftBody,
} from "@workspace/api-zod";
import {
  present, speaksForTeam, tally, electionIsOpen, electionMinutesLeft,
  nodsNeeded, standingNods, postCheck, messageProblem, roomStanding,
  type RoomMember,
} from "@workspace/domain";
import { getCurrentUser } from "../lib/auth";

/**
 * The room a team argues in, before it says anything to anybody else.
 *
 * Its own file rather than another thousand lines in studioSimulations.ts,
 * because everything here answers one question — what may this team say, and
 * who may say it — and that question is worth being able to read in one sitting.
 *
 * ## One rule holds this together
 *
 * Every write goes through `roomFor`, which reads the whole room and works out
 * the standings from scratch, and every write answers with the same room the
 * reader would have got from a plain GET. No endpoint here returns a fragment
 * and no browser is trusted to stitch one together: the gate that decides
 * whether a team may speak is computed on this side, from the same domain
 * functions the button uses, so the two cannot drift apart and disagree in
 * front of a cohort.
 *
 * ## What is never served
 *
 * Another team's room. Not during, not after, not to a participant. What a
 * team says to each other on the way to an answer is not part of the exercise
 * anybody else is in, and a leak of it would change how people talk in here —
 * which is the one thing the room is for.
 */

const router = Router();

const message = (error: string) => ({ error });

type Loaded = {
  run: typeof simulationRunsTable.$inferSelect;
  groupId: string;
  teamName: string;
  members: RoomMember[];
  names: Map<number, string>;
};

/**
 * Who is in this team, and what they are called.
 *
 * Refuses anybody without an assignment on this run, which is the whole of the
 * access rule: you are in exactly one team's room, the one you were put in.
 */
async function loadTeam(runId: number, userId: number): Promise<Loaded | "no-run" | "not-mine"> {
  const [run] = await db.select().from(simulationRunsTable).where(eq(simulationRunsTable.id, runId));
  if (!run) return "no-run";

  const [mine] = await db.select().from(simulationGroupAssignmentsTable).where(and(
    eq(simulationGroupAssignmentsTable.runId, runId),
    eq(simulationGroupAssignmentsTable.userId, userId),
  ));
  if (!mine) return "not-mine";

  const rows = await db
    .select({
      userId: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      enteredAt: simulationGroupAssignmentsTable.enteredAt,
    })
    .from(simulationGroupAssignmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, simulationGroupAssignmentsTable.userId))
    .where(and(
      eq(simulationGroupAssignmentsTable.runId, runId),
      eq(simulationGroupAssignmentsTable.groupId, mine.groupId),
    ));

  const [definition] = await db.select().from(simulationDefinitionsTable)
    .where(eq(simulationDefinitionsTable.id, run.definitionId));
  const team = (definition?.groups ?? []).find((g) => g.id === mine.groupId);

  const members: RoomMember[] = rows.map((r) => ({
    userId: r.userId,
    // A name, or the part of an email before the @ — never a bare id. People
    // are about to vote for each other.
    name: r.name?.trim() || r.email.split("@")[0],
    enteredAt: r.enteredAt?.toISOString() ?? null,
  }));

  return {
    run,
    groupId: mine.groupId,
    teamName: team?.name ?? "Your team",
    members,
    names: new Map(members.map((m) => [m.userId, m.name])),
  };
}

/**
 * When this room started counting its five minutes.
 *
 * The run's start, not the first message: a team that sat in silence for four
 * minutes has used four of its five, and a clock that starts when somebody
 * speaks rewards saying nothing.
 */
function openedAt(run: typeof simulationRunsTable.$inferSelect): string {
  return (run.startedAt ?? run.createdAt).toISOString();
}

/** Everything one participant may see of their own room. */
async function roomFor(loaded: Loaded, userId: number) {
  const { run, groupId, members } = loaded;
  const injectId = run.currentDevelopment?.id ?? "";
  const nowMs = Date.now();

  const [messages, votes, drafts] = await Promise.all([
    db.select().from(teamRoomMessagesTable)
      .where(and(eq(teamRoomMessagesTable.runId, run.id), eq(teamRoomMessagesTable.groupId, groupId)))
      .orderBy(asc(teamRoomMessagesTable.createdAt))
      .limit(500),
    db.select().from(teamRoomVotesTable)
      .where(and(eq(teamRoomVotesTable.runId, run.id), eq(teamRoomVotesTable.groupId, groupId))),
    injectId
      ? db.select().from(teamRoomDraftsTable).where(and(
        eq(teamRoomDraftsTable.runId, run.id),
        eq(teamRoomDraftsTable.groupId, groupId),
        eq(teamRoomDraftsTable.injectId, injectId),
      ))
      : Promise.resolve([]),
  ]);

  const draftRow = drafts[0];
  const nodRows = draftRow
    ? await db.select().from(teamRoomNodsTable).where(eq(teamRoomNodsTable.draftId, draftRow.id))
    : [];

  const draft = draftRow
    ? { body: draftRow.body, version: draftRow.version, authorId: draftRow.authorId }
    : null;
  const nods = nodRows.map((n) => ({ userId: n.userId, version: n.version }));

  const leaderId = speaksForTeam({
    members, votes: votes.map((v) => ({ voterId: v.voterId, forUserId: v.forUserId })),
    openedAt: openedAt(run), nowMs,
  });
  const standings = tally(members, votes.map((v) => ({ voterId: v.voterId, forUserId: v.forUserId })));
  const votesFor = new Map(standings.map((s) => [s.userId, s.votes]));
  const behind = new Set(draft ? standingNods(nods, draft, members) : []);

  // Already answered. Checked rather than inferred from the draft, because a
  // team that answered before this feature existed has a response and no draft.
  const posted = injectId
    ? (await db.select({ id: simulationResponsesTable.id }).from(simulationResponsesTable).where(and(
      eq(simulationResponsesTable.runId, run.id),
      eq(simulationResponsesTable.groupId, groupId),
      eq(simulationResponsesTable.injectId, injectId),
    ))).length > 0
    : false;

  const gate = postCheck({
    members, draft, nods, leaderId, byUserId: userId,
    stillOpen: run.status === "active" && injectId !== "" && !posted,
  });

  return {
    groupId,
    teamName: loaded.teamName,
    members: members.map((m) => ({
      userId: m.userId,
      name: m.name,
      present: m.enteredAt !== null,
      votes: votesFor.get(m.userId) ?? 0,
      nodded: behind.has(m.userId),
    })),
    messages: messages.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: loaded.names.get(m.userId) ?? "Somebody",
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      mine: m.userId === userId,
    })),
    standing: roomStanding({
      members, leaderId, leaderName: leaderId ? loaded.names.get(leaderId) ?? null : null,
      openedAt: openedAt(run), nowMs, draft, nods,
    }),
    electionOpen: electionIsOpen(openedAt(run), nowMs),
    electionMinutesLeft: electionMinutesLeft(openedAt(run), nowMs),
    leaderId,
    leaderName: leaderId ? loaded.names.get(leaderId) ?? null : null,
    iAmLeader: leaderId === userId,
    myVoteFor: votes.find((v) => v.voterId === userId)?.forUserId ?? null,
    draft: draft?.body ?? "",
    draftVersion: draft?.version ?? 0,
    nodsHave: gate.have,
    nodsNeeded: gate.needed === 0 ? nodsNeeded(present(members).length) : gate.needed,
    iHaveNodded: behind.has(userId),
    mayPost: gate.may,
    waitingOn: gate.waitingOn,
    posted,
  };
}

type Opened =
  | { kind: "refused"; code: number; said: string }
  | { kind: "ok"; user: { id: number }; loaded: Loaded };

/** Load, refuse, or hand back the room — the opening of every route below. */
async function open(req: Parameters<typeof getCurrentUser>[0], runId: number): Promise<Opened> {
  const user = await getCurrentUser(req);
  if (!user) return { kind: "refused", code: 401, said: "Unauthorized" };
  const loaded = await loadTeam(runId, user.id);
  if (loaded === "no-run") return { kind: "refused", code: 404, said: "That exercise is not there." };
  if (loaded === "not-mine") {
    return { kind: "refused", code: 403, said: "You are not in a team on this exercise." };
  }
  return { kind: "ok", user, loaded };
}

router.get("/simulation-runs/:runId/room", async (req, res): Promise<void> => {
  const got = await open(req, Number(req.params.runId));
  if (got.kind === "refused") { res.status(got.code).json(message(got.said)); return; }
  res.json(GetTeamRoomResponse.parse(await roomFor(got.loaded, got.user.id)));
});

router.post("/simulation-runs/:runId/room/messages", async (req, res): Promise<void> => {
  const got = await open(req, Number(req.params.runId));
  if (got.kind === "refused") { res.status(got.code).json(message(got.said)); return; }

  const body = SendTeamRoomMessageBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }
  const problem = messageProblem(body.data.body);
  if (problem) { res.status(400).json(message(problem)); return; }

  await db.insert(teamRoomMessagesTable).values({
    runId: got.loaded.run.id, groupId: got.loaded.groupId,
    userId: got.user.id, body: body.data.body.trim(),
  });
  res.json(GetTeamRoomResponse.parse(await roomFor(got.loaded, got.user.id)));
});

router.post("/simulation-runs/:runId/room/leader", async (req, res): Promise<void> => {
  const got = await open(req, Number(req.params.runId));
  if (got.kind === "refused") { res.status(got.code).json(message(got.said)); return; }

  const body = VoteForTeamLeaderBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }

  if (!electionIsOpen(openedAt(got.loaded.run), Date.now())) {
    res.status(409).json(message("The five minutes are up — your team has already chosen."));
    return;
  }
  // Electing somebody who never opened the room is electing an empty chair.
  const here = new Set(present(got.loaded.members).map((m) => m.userId));
  if (!here.has(body.data.forUserId)) {
    res.status(409).json(message("They have not opened the room, so they cannot speak for the team."));
    return;
  }

  await db.insert(teamRoomVotesTable).values({
    runId: got.loaded.run.id, groupId: got.loaded.groupId,
    voterId: got.user.id, forUserId: body.data.forUserId,
  }).onConflictDoUpdate({
    target: [teamRoomVotesTable.runId, teamRoomVotesTable.groupId, teamRoomVotesTable.voterId],
    set: { forUserId: body.data.forUserId, updatedAt: new Date() },
  });

  res.json(GetTeamRoomResponse.parse(await roomFor(got.loaded, got.user.id)));
});

router.put("/simulation-runs/:runId/room/draft", async (req, res): Promise<void> => {
  const got = await open(req, Number(req.params.runId));
  if (got.kind === "refused") { res.status(got.code).json(message(got.said)); return; }

  const body = SaveTeamRoomDraftBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }

  const injectId = got.loaded.run.currentDevelopment?.id;
  if (!injectId) { res.status(409).json(message("There is nothing to answer yet.")); return; }

  const room = await roomFor(got.loaded, got.user.id);
  if (!room.iAmLeader) {
    res.status(403).json(message("Only the person your team chose can write the reply."));
    return;
  }

  /*
    The edit, and every nod it invalidates.

    In one transaction, because the half-done version of this — new words with
    the old approvals still counted — is precisely the thing the rule exists to
    prevent. The old nods are left in place rather than deleted: they record,
    truthfully, that somebody agreed to something that has since changed.
  */
  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(teamRoomDraftsTable).where(and(
      eq(teamRoomDraftsTable.runId, got.loaded.run.id),
      eq(teamRoomDraftsTable.groupId, got.loaded.groupId),
      eq(teamRoomDraftsTable.injectId, injectId),
    ));

    if (!existing) {
      await tx.insert(teamRoomDraftsTable).values({
        runId: got.loaded.run.id, groupId: got.loaded.groupId, injectId,
        body: body.data.body, version: 1, authorId: got.user.id,
      });
      return;
    }
    // Same words, same version: a leader who saves twice has not changed
    // anything, and bumping the version would throw away the room's agreement
    // for nothing.
    if (existing.body === body.data.body) return;

    await tx.update(teamRoomDraftsTable)
      .set({ body: body.data.body, version: existing.version + 1, authorId: got.user.id })
      .where(eq(teamRoomDraftsTable.id, existing.id));
  });

  res.json(GetTeamRoomResponse.parse(await roomFor(got.loaded, got.user.id)));
});

router.post("/simulation-runs/:runId/room/nod", async (req, res): Promise<void> => {
  const got = await open(req, Number(req.params.runId));
  if (got.kind === "refused") { res.status(got.code).json(message(got.said)); return; }

  const body = NodTeamRoomDraftBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }

  const injectId = got.loaded.run.currentDevelopment?.id;
  if (!injectId) { res.status(409).json(message("There is nothing to agree to yet.")); return; }

  const [draft] = await db.select().from(teamRoomDraftsTable).where(and(
    eq(teamRoomDraftsTable.runId, got.loaded.run.id),
    eq(teamRoomDraftsTable.groupId, got.loaded.groupId),
    eq(teamRoomDraftsTable.injectId, injectId),
  ));
  if (!draft) { res.status(409).json(message("There is nothing drafted yet.")); return; }

  // The version is the point. A nod sent against wording that has since
  // changed is refused rather than quietly counted against the new words.
  if (draft.version !== body.data.version) {
    res.status(409).json(message("That changed while you were reading it. Read it again, then agree."));
    return;
  }

  await db.insert(teamRoomNodsTable)
    .values({ draftId: draft.id, userId: got.user.id, version: draft.version })
    .onConflictDoNothing();

  res.json(GetTeamRoomResponse.parse(await roomFor(got.loaded, got.user.id)));
});

/**
 * Send it.
 *
 * The gate is checked here, against the database, after everything else has
 * been read — not because the browser is dishonest but because the browser is
 * one of several, each holding a view of the room that was true a few seconds
 * ago. Two people pressing at once, a nod withdrawn, an edit landing between
 * the render and the press: all of those end here, and here is where they have
 * to be settled.
 */
router.post("/simulation-runs/:runId/room/post", async (req, res): Promise<void> => {
  const got = await open(req, Number(req.params.runId));
  if (got.kind === "refused") { res.status(got.code).json(message(got.said)); return; }

  const injectId = got.loaded.run.currentDevelopment?.id;
  if (!injectId) { res.status(409).json(message("There is nothing to answer.")); return; }

  const room = await roomFor(got.loaded, got.user.id);
  if (!room.mayPost) {
    res.status(409).json(message(room.waitingOn ?? "That cannot be sent yet."));
    return;
  }

  await db.transaction(async (tx) => {
    await tx.insert(simulationResponsesTable).values({
      runId: got.loaded.run.id, groupId: got.loaded.groupId,
      injectId, body: room.draft, authorId: got.user.id,
    }).onConflictDoUpdate({
      target: [simulationResponsesTable.runId, simulationResponsesTable.groupId, simulationResponsesTable.injectId],
      set: { body: room.draft, authorId: got.user.id, updatedAt: new Date() },
    });
    await tx.update(teamRoomDraftsTable)
      .set({ postedAt: new Date() })
      .where(and(
        eq(teamRoomDraftsTable.runId, got.loaded.run.id),
        eq(teamRoomDraftsTable.groupId, got.loaded.groupId),
        eq(teamRoomDraftsTable.injectId, injectId),
      ));
  });

  res.json(GetTeamRoomResponse.parse(await roomFor(got.loaded, got.user.id)));
});

export default router;
