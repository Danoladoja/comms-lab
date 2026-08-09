import { Router, type IRouter } from "express";
import { db, programsTable, sessionsTable, enrollmentsTable, usersTable } from "@workspace/db";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  CreateProgramBody,
  UpdateProgramBody,
  CreateSessionBody,
} from "@workspace/api-zod";
import { getCurrentUser, requireRole } from "../lib/auth";

const router: IRouter = Router();

const enrolledCountSql = sql<number>`(
  select count(*)::int from ${enrollmentsTable}
  where ${enrollmentsTable.programId} = ${programsTable.id}
    and ${enrollmentsTable.status} in ('enrolled', 'completed')
)`;

function programColumns() {
  return {
    id: programsTable.id,
    tag: programsTable.tag,
    title: programsTable.title,
    description: programsTable.description,
    startDate: programsTable.startDate,
    format: programsTable.format,
    duration: programsTable.duration,
    thumbnailUrl: programsTable.thumbnailUrl,
    capacity: programsTable.capacity,
    status: programsTable.status,
    enrolledCount: enrolledCountSql,
  };
}

router.get("/programs", async (req, res) => {
  const user = await getCurrentUser(req);
  const isAdmin = user?.role === "admin";
  const rows = await db
    .select(programColumns())
    .from(programsTable)
    .where(isAdmin ? ne(programsTable.status, "archived") : eq(programsTable.status, "published"))
    .orderBy(asc(programsTable.id));
  res.json(rows);
});

router.post("/programs", requireRole("admin"), async (req, res) => {
  const parsed = CreateProgramBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db.insert(programsTable).values(parsed.data).returning();
  res.status(201).json({ ...created, enrolledCount: 0 });
});

router.get("/programs/:id", async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.select(programColumns()).from(programsTable).where(eq(programsTable.id, id));
  if (rows.length === 0) {
    res.status(404).json({ error: "Program not found" });
    return;
  }
  const user = await getCurrentUser(req);
  if (rows[0].status !== "published" && user?.role !== "admin") {
    res.status(404).json({ error: "Program not found" });
    return;
  }
  res.json(rows[0]);
});

router.patch("/programs/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateProgramBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await db.update(programsTable).set(parsed.data).where(eq(programsTable.id, id)).returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "Program not found" });
    return;
  }
  const rows = await db.select(programColumns()).from(programsTable).where(eq(programsTable.id, id));
  res.json(rows[0]);
});

/** Whether the given user may see join/recording links for a program. */
async function canSeeLinks(userId: number | undefined, role: string | undefined, programId: number): Promise<boolean> {
  if (role === "admin") return true;
  if (!userId) return false;
  if (role === "instructor") {
    // Instructors only see links for programs where they facilitate a session.
    const assigned = await db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.programId, programId), eq(sessionsTable.instructorId, userId)))
      .limit(1);
    if (assigned.length > 0) return true;
  }
  const rows = await db
    .select({ id: enrollmentsTable.id })
    .from(enrollmentsTable)
    .where(
      and(
        eq(enrollmentsTable.userId, userId),
        eq(enrollmentsTable.programId, programId),
        sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

router.get("/programs/:id/sessions", async (req, res) => {
  const programId = Number(req.params.id);
  const program = await db.select({ id: programsTable.id }).from(programsTable).where(eq(programsTable.id, programId));
  if (program.length === 0) {
    res.status(404).json({ error: "Program not found" });
    return;
  }
  const user = await getCurrentUser(req);
  const showLinks = await canSeeLinks(user?.id, user?.role, programId);

  const rows = await db
    .select({
      id: sessionsTable.id,
      programId: sessionsTable.programId,
      title: sessionsTable.title,
      description: sessionsTable.description,
      sortOrder: sessionsTable.sortOrder,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      meetUrl: sessionsTable.meetUrl,
      recordingUrl: sessionsTable.recordingUrl,
      instructorId: sessionsTable.instructorId,
      instructorName: usersTable.name,
    })
    .from(sessionsTable)
    .leftJoin(usersTable, eq(sessionsTable.instructorId, usersTable.id))
    .where(eq(sessionsTable.programId, programId))
    .orderBy(asc(sessionsTable.sortOrder), asc(sessionsTable.id));

  res.json(
    rows.map((r) => ({
      ...r,
      meetUrl: showLinks ? r.meetUrl : null,
      recordingUrl: showLinks ? r.recordingUrl : null,
    })),
  );
});

router.post("/programs/:id/sessions", requireRole("admin"), async (req, res) => {
  const programId = Number(req.params.id);
  const program = await db.select({ id: programsTable.id }).from(programsTable).where(eq(programsTable.id, programId));
  if (program.length === 0) {
    res.status(404).json({ error: "Program not found" });
    return;
  }
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [created] = await db
    .insert(sessionsTable)
    .values({ ...parsed.data, programId })
    .returning();
  res.status(201).json({ ...created, instructorName: null });
});

export default router;
