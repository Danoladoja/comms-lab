import { Router, type IRouter } from "express";
import {
  db, programsTable, sessionsTable, enrollmentsTable, usersTable,
  forumThreadsTable, forumPostsTable,
} from "@workspace/db";
import { and, asc, desc, eq, sql, inArray } from "drizzle-orm";
import { CreateProgramThreadBody, CreateThreadPostBody, SetThreadPinnedBody } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { satisfiesRole } from "@workspace/domain";

const router: IRouter = Router();

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** Admin, or an instructor assigned to at least one session of the program. */
async function canModerate(user: User, programId: number): Promise<boolean> {
  if (satisfiesRole(user.role, ["admin"])) return true;
  if (user.role !== "instructor") return false;
  const [row] = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.programId, programId), eq(sessionsTable.instructorId, user.id)))
    .limit(1);
  return !!row;
}

/** The forum is visible to enrolled learners and staff (no module locking). */
async function forumAccessError(user: User, programId: number): Promise<string | null> {
  if (await canModerate(user, programId)) return null;
  const [enrollment] = await db
    .select({ id: enrollmentsTable.id })
    .from(enrollmentsTable)
    .where(and(
      eq(enrollmentsTable.userId, user.id),
      eq(enrollmentsTable.programId, programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));
  return enrollment ? null : "You are not enrolled in this program";
}

function displayRole(role: string) {
  if (role === "instructor") return "Facilitator";
  // A super admin posting in the forum is an admin to everyone reading it.
  return satisfiesRole(role, ["admin"]) ? "Admin" : "Learner";
}

async function threadDto(thread: typeof forumThreadsTable.$inferSelect, viewerId: number) {
  const [author] = await db.select({ name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, thread.userId));
  const [stats] = await db
    .select({
      count: sql<number>`count(*)::int`,
      last: sql<string | null>`max(${forumPostsTable.createdAt})`,
    })
    .from(forumPostsTable)
    .where(eq(forumPostsTable.threadId, thread.id));
  return {
    id: thread.id,
    programId: thread.programId,
    title: thread.title,
    body: thread.body,
    pinned: thread.pinned,
    authorName: author?.name ?? "Former member",
    authorRole: displayRole(author?.role ?? "learner"),
    replyCount: stats?.count ?? 0,
    lastActivityAt: (stats?.last ? new Date(stats.last) : thread.createdAt).toISOString(),
    createdAt: thread.createdAt.toISOString(),
    mine: thread.userId === viewerId,
  };
}

/* ---------- Threads ---------- */

router.get("/programs/:id/threads", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const programId = Number(req.params.id);
  const [program] = await db.select({ id: programsTable.id }).from(programsTable).where(eq(programsTable.id, programId));
  if (!program) { res.status(404).json({ error: "Program not found" }); return; }
  const accessError = await forumAccessError(user, programId);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  const threads = await db
    .select()
    .from(forumThreadsTable)
    .where(eq(forumThreadsTable.programId, programId));

  const threadIds = threads.map((t) => t.id);
  const authors = threads.length
    ? await db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role })
        .from(usersTable)
        .where(inArray(usersTable.id, [...new Set(threads.map((t) => t.userId))]))
    : [];
  const authorById = new Map(authors.map((a) => [a.id, a]));
  const stats = threadIds.length
    ? await db
        .select({
          threadId: forumPostsTable.threadId,
          count: sql<number>`count(*)::int`,
          last: sql<string | null>`max(${forumPostsTable.createdAt})`,
        })
        .from(forumPostsTable)
        .where(inArray(forumPostsTable.threadId, threadIds))
        .groupBy(forumPostsTable.threadId)
    : [];
  const statsByThread = new Map(stats.map((s) => [s.threadId, s]));

  const dtos = threads.map((t) => {
    const author = authorById.get(t.userId);
    const s = statsByThread.get(t.id);
    return {
      id: t.id,
      programId: t.programId,
      title: t.title,
      body: t.body,
      pinned: t.pinned,
      authorName: author?.name ?? "Former member",
      authorRole: displayRole(author?.role ?? "learner"),
      replyCount: s?.count ?? 0,
      lastActivityAt: (s?.last ? new Date(s.last) : t.createdAt).toISOString(),
      createdAt: t.createdAt.toISOString(),
      mine: t.userId === user.id,
    };
  });
  // Pinned first, then most recent activity.
  dtos.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastActivityAt.localeCompare(a.lastActivityAt));

  res.json({ canModerate: await canModerate(user, programId), threads: dtos });
});

router.post("/programs/:id/threads", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const programId = Number(req.params.id);
  const [program] = await db.select({ id: programsTable.id }).from(programsTable).where(eq(programsTable.id, programId));
  if (!program) { res.status(404).json({ error: "Program not found" }); return; }
  const accessError = await forumAccessError(user, programId);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  const parsed = CreateProgramThreadBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const title = parsed.data.title.trim();
  if (!title) { res.status(400).json({ error: "Title is required" }); return; }

  const [thread] = await db
    .insert(forumThreadsTable)
    .values({ programId, userId: user.id, title, body: (parsed.data.body ?? "").trim() })
    .returning();
  res.json(await threadDto(thread, user.id));
});

/* ---------- Thread detail & replies ---------- */

async function loadThread(threadId: number) {
  const [thread] = await db.select().from(forumThreadsTable).where(eq(forumThreadsTable.id, threadId));
  return thread ?? null;
}

router.get("/threads/:id", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const thread = await loadThread(Number(req.params.id));
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }
  const accessError = await forumAccessError(user, thread.programId);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  const posts = await db
    .select({
      id: forumPostsTable.id,
      threadId: forumPostsTable.threadId,
      body: forumPostsTable.body,
      createdAt: forumPostsTable.createdAt,
      userId: forumPostsTable.userId,
      authorName: usersTable.name,
      authorRole: usersTable.role,
    })
    .from(forumPostsTable)
    .leftJoin(usersTable, eq(usersTable.id, forumPostsTable.userId))
    .where(eq(forumPostsTable.threadId, thread.id))
    .orderBy(asc(forumPostsTable.createdAt), asc(forumPostsTable.id));

  res.json({
    thread: await threadDto(thread, user.id),
    posts: posts.map((p) => ({
      id: p.id,
      threadId: p.threadId,
      body: p.body,
      authorName: p.authorName ?? "Former member",
      authorRole: displayRole(p.authorRole ?? "learner"),
      createdAt: p.createdAt.toISOString(),
      mine: p.userId === user.id,
    })),
    canModerate: await canModerate(user, thread.programId),
  });
});

router.post("/threads/:id/posts", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const thread = await loadThread(Number(req.params.id));
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }
  const accessError = await forumAccessError(user, thread.programId);
  if (accessError) { res.status(403).json({ error: accessError }); return; }

  const parsed = CreateThreadPostBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = parsed.data.body.trim();
  if (!body) { res.status(400).json({ error: "Reply cannot be empty" }); return; }

  const [post] = await db.insert(forumPostsTable).values({ threadId: thread.id, userId: user.id, body }).returning();
  res.json({
    id: post.id,
    threadId: post.threadId,
    body: post.body,
    authorName: user.name,
    authorRole: displayRole(user.role),
    createdAt: post.createdAt.toISOString(),
    mine: true,
  });
});

router.post("/threads/:id/pin", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const thread = await loadThread(Number(req.params.id));
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }
  if (!(await canModerate(user, thread.programId))) { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = SetThreadPinnedBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db
    .update(forumThreadsTable)
    .set({ pinned: parsed.data.pinned })
    .where(eq(forumThreadsTable.id, thread.id))
    .returning();
  res.json(await threadDto(updated, user.id));
});

export default router;
