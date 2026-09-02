import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { db, liveSessionRegistrationsTable, liveSessionsTable, usersTable } from "@workspace/db";
import {
  canRegisterForLiveSession,
  isLiveSessionStatus,
  liveSessionState,
  mayJoinLiveSession,
  maySeeLiveSessionRecording,
  satisfiesRole,
  showsInLiveSessionList,
} from "@workspace/domain";
import { getCurrentUser } from "../lib/auth";

/**
 * Live Sessions: the standalone evenings.
 *
 * Not the classes inside a programme. One subject, one speaker, open to anyone
 * with an account, finished when it is finished.
 *
 * The rule that shapes every route here: **the joining link and the recording
 * are never in a listing.** They are handed out one person at a time, by an
 * endpoint that has checked that this person registered and, for the link,
 * that the room is actually open. A public page that carries a Meet link is a
 * public Meet link, whatever the page says above it.
 */

const router: IRouter = Router();

function message(error: string) { return { error }; }

/** What anybody may see: everything except the two things worth guarding. */
function publicView(
  session: typeof liveSessionsTable.$inferSelect,
  extras: { registered: boolean; registeredCount: number },
) {
  return {
    id: session.id,
    title: session.title,
    summary: session.summary,
    description: session.description,
    topic: session.topic,
    startsAt: session.startsAt,
    durationMins: session.durationMins,
    speaker: session.speaker,
    speakerTitle: session.speakerTitle,
    status: session.status,
    capacity: session.capacity,
    state: liveSessionState(session),
    registered: extras.registered,
    registeredCount: extras.registeredCount,
    /** Whether there is a recording at all, without saying where it is. */
    hasRecording: !!session.recordingUrl,
  };
}

async function registrationsFor(sessionIds: number[], userId: number | null) {
  if (sessionIds.length === 0) return { counts: new Map<number, number>(), mine: new Set<number>() };

  const counts = await db
    .select({ id: liveSessionRegistrationsTable.liveSessionId, n: count() })
    .from(liveSessionRegistrationsTable)
    .where(sql`${liveSessionRegistrationsTable.liveSessionId} in ${sessionIds}`)
    .groupBy(liveSessionRegistrationsTable.liveSessionId);

  const mine = userId === null ? [] : await db
    .select({ id: liveSessionRegistrationsTable.liveSessionId })
    .from(liveSessionRegistrationsTable)
    .where(and(
      eq(liveSessionRegistrationsTable.userId, userId),
      sql`${liveSessionRegistrationsTable.liveSessionId} in ${sessionIds}`,
    ));

  return {
    counts: new Map(counts.map((row) => [row.id, Number(row.n)])),
    mine: new Set(mine.map((row) => row.id)),
  };
}

/** The public list. Signed out is fine: this is how people find the Lab. */
router.get("/live-sessions", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req).catch(() => null);
  const isAdmin = satisfiesRole(user?.role ?? null, ["admin"]);

  const all = await db.select().from(liveSessionsTable).orderBy(desc(liveSessionsTable.startsAt));
  // An admin sees drafts, because they are the person writing them.
  const visible = all.filter((s) => isAdmin || showsInLiveSessionList(s.status));

  const { counts, mine } = await registrationsFor(visible.map((s) => s.id), user?.id ?? null);
  res.json(visible.map((s) => publicView(s, {
    registered: mine.has(s.id),
    registeredCount: counts.get(s.id) ?? 0,
  })));
});

router.get("/live-sessions/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json(message("That is not a session")); return; }

  const user = await getCurrentUser(req).catch(() => null);
  const isAdmin = satisfiesRole(user?.role ?? null, ["admin"]);
  const [session] = await db.select().from(liveSessionsTable).where(eq(liveSessionsTable.id, id));
  if (!session || (!isAdmin && !showsInLiveSessionList(session.status))) {
    res.status(404).json(message("Session not found")); return;
  }

  const { counts, mine } = await registrationsFor([session.id], user?.id ?? null);
  const registered = mine.has(session.id);

  res.json({
    ...publicView(session, { registered, registeredCount: counts.get(session.id) ?? 0 }),
    // Handed out here and nowhere else, to this person, having checked.
    joinUrl: mayJoinLiveSession(session, registered) ? session.meetUrl : null,
    recordingUrl: maySeeLiveSessionRecording(session, registered) ? session.recordingUrl : null,
  });
});

/**
 * Put your name down.
 *
 * Open from the moment it is published until the moment it ends, because
 * people find these an hour before they start and turning them away at the
 * door to protect a number would be perverse.
 */
router.post("/live-sessions/:id/register", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Sign in to register")); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json(message("That is not a session")); return; }

  const [session] = await db.select().from(liveSessionsTable).where(eq(liveSessionsTable.id, id));
  if (!session) { res.status(404).json(message("Session not found")); return; }

  const { counts, mine } = await registrationsFor([session.id], user.id);
  const outcome = canRegisterForLiveSession(session, counts.get(session.id) ?? 0, mine.has(session.id));
  if (!outcome.allowed) {
    // Already registered is not a failure worth an error page.
    if (mine.has(session.id)) { res.json({ registered: true }); return; }
    res.status(409).json(message(outcome.reason ?? "You cannot register for this session."));
    return;
  }

  await db.insert(liveSessionRegistrationsTable)
    .values({ liveSessionId: session.id, userId: user.id })
    .onConflictDoNothing();

  req.log.info({ liveSessionId: session.id, userId: user.id }, "Registered for a live session");
  res.status(201).json({ registered: true });
});

router.delete("/live-sessions/:id/register", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json(message("That is not a session")); return; }

  await db.delete(liveSessionRegistrationsTable).where(and(
    eq(liveSessionRegistrationsTable.liveSessionId, id),
    eq(liveSessionRegistrationsTable.userId, user.id),
  ));
  res.status(204).end();
});

/**
 * Opening the room.
 *
 * Separate from reading the page so that turning up is recorded: registered
 * and came are different questions, and the second one is the one worth
 * knowing when deciding whether to run another.
 */
router.post("/live-sessions/:id/join", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Sign in to join")); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json(message("That is not a session")); return; }

  const [session] = await db.select().from(liveSessionsTable).where(eq(liveSessionsTable.id, id));
  if (!session) { res.status(404).json(message("Session not found")); return; }

  const [registration] = await db.select().from(liveSessionRegistrationsTable).where(and(
    eq(liveSessionRegistrationsTable.liveSessionId, session.id),
    eq(liveSessionRegistrationsTable.userId, user.id),
  ));
  if (!registration) { res.status(403).json(message("Register first, then the joining link appears here.")); return; }
  if (!mayJoinLiveSession(session, true)) {
    res.status(409).json(message("The room is not open yet. It opens ten minutes before the start."));
    return;
  }
  if (!session.meetUrl) { res.status(409).json(message("No joining link has been added to this session yet.")); return; }

  if (!registration.attendedAt) {
    await db.update(liveSessionRegistrationsTable)
      .set({ attendedAt: new Date() })
      .where(eq(liveSessionRegistrationsTable.id, registration.id));
  }
  res.json({ joinUrl: session.meetUrl });
});

/* ---------- Running them ---------- */

function adminOnly(role: string | null | undefined): boolean {
  return satisfiesRole(role ?? null, ["admin"]);
}

router.post("/admin/live-sessions", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!adminOnly(user.role)) { res.status(403).json(message("Only admins can create live sessions")); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const title = String(body.title ?? "").trim();
  if (!title) { res.status(400).json(message("A session needs a title")); return; }

  const [saved] = await db.insert(liveSessionsTable).values({
    title,
    summary: String(body.summary ?? "").trim(),
    description: String(body.description ?? "").trim(),
    topic: String(body.topic ?? "").trim(),
    speaker: String(body.speaker ?? "").trim(),
    speakerTitle: String(body.speakerTitle ?? "").trim(),
    startsAt: body.startsAt ? new Date(String(body.startsAt)) : null,
    durationMins: Number(body.durationMins) > 0 ? Math.round(Number(body.durationMins)) : 60,
    capacity: Number(body.capacity) > 0 ? Math.round(Number(body.capacity)) : 0,
    meetUrl: body.meetUrl ? String(body.meetUrl).trim() : null,
    status: isLiveSessionStatus(body.status) ? body.status : "draft",
    createdByUserId: user.id,
  }).returning();

  res.status(201).json(publicView(saved, { registered: false, registeredCount: 0 }));
});

router.patch("/admin/live-sessions/:id", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!adminOnly(user.role)) { res.status(403).json(message("Only admins can change live sessions")); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json(message("That is not a session")); return; }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  for (const field of ["title", "summary", "description", "topic", "speaker", "speakerTitle"]) {
    if (typeof body[field] === "string") values[field] = (body[field] as string).trim();
  }
  if ("startsAt" in body) values.startsAt = body.startsAt ? new Date(String(body.startsAt)) : null;
  if ("meetUrl" in body) values.meetUrl = body.meetUrl ? String(body.meetUrl).trim() : null;
  if ("recordingUrl" in body) values.recordingUrl = body.recordingUrl ? String(body.recordingUrl).trim() : null;
  if (Number(body.durationMins) > 0) values.durationMins = Math.round(Number(body.durationMins));
  if (body.capacity !== undefined) values.capacity = Number(body.capacity) > 0 ? Math.round(Number(body.capacity)) : 0;
  if (isLiveSessionStatus(body.status)) values.status = body.status;
  if (Object.keys(values).length === 0) { res.status(400).json(message("Nothing to change")); return; }

  const [saved] = await db.update(liveSessionsTable).set(values).where(eq(liveSessionsTable.id, id)).returning();
  if (!saved) { res.status(404).json(message("Session not found")); return; }

  const { counts } = await registrationsFor([saved.id], null);
  res.json(publicView(saved, { registered: false, registeredCount: counts.get(saved.id) ?? 0 }));
});

/** Who said they were coming, and who actually came. */
router.get("/admin/live-sessions/:id/registrations", async (req, res): Promise<void> => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!adminOnly(user.role)) { res.status(403).json(message("Only admins can see who registered")); return; }
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json(message("That is not a session")); return; }

  const rows = await db
    .select({
      userId: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      registeredAt: liveSessionRegistrationsTable.registeredAt,
      attendedAt: liveSessionRegistrationsTable.attendedAt,
    })
    .from(liveSessionRegistrationsTable)
    .innerJoin(usersTable, eq(liveSessionRegistrationsTable.userId, usersTable.id))
    .where(eq(liveSessionRegistrationsTable.liveSessionId, id))
    .orderBy(asc(liveSessionRegistrationsTable.registeredAt));

  res.json(rows);
});

export default router;
