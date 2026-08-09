import { Router, type IRouter } from "express";
import { db, enrollmentsTable, programsTable, sessionsTable, usersTable } from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getCurrentUser } from "../lib/auth";

const router: IRouter = Router();

router.post("/programs/:id/enroll", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const programId = Number(req.params.id);
  const program = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (program.length === 0 || program[0].status !== "published") {
    res.status(404).json({ error: "Program not found" });
    return;
  }
  const existing = await db
    .select()
    .from(enrollmentsTable)
    .where(and(eq(enrollmentsTable.userId, user.id), eq(enrollmentsTable.programId, programId)));
  if (existing.length > 0 && existing[0].status !== "cancelled") {
    res.status(409).json({ error: "Already enrolled" });
    return;
  }

  // Lock the program row so concurrent enrollments cannot exceed capacity.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${programsTable} where id = ${programId} for update`);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(enrollmentsTable)
      .where(and(eq(enrollmentsTable.programId, programId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
    const status = count >= program[0].capacity ? "waitlisted" : "enrolled";

    if (existing.length > 0) {
      const [updated] = await tx
        .update(enrollmentsTable)
        .set({ status })
        .where(eq(enrollmentsTable.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await tx
      .insert(enrollmentsTable)
      .values({ userId: user.id, programId, status })
      .returning();
    return created;
  });
  res.status(201).json(result);
});

router.get("/my/enrollments", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const rows = await db
    .select({
      id: enrollmentsTable.id,
      userId: enrollmentsTable.userId,
      programId: enrollmentsTable.programId,
      status: enrollmentsTable.status,
      programTitle: programsTable.title,
      programStartDate: programsTable.startDate,
    })
    .from(enrollmentsTable)
    .innerJoin(programsTable, eq(enrollmentsTable.programId, programsTable.id))
    .where(eq(enrollmentsTable.userId, user.id))
    .orderBy(asc(enrollmentsTable.id));
  res.json(rows.map((r) => ({ ...r, userName: user.name, userEmail: user.email })));
});

router.get("/my/sessions", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let programIds: number[] = [];
  if (user.role === "instructor") {
    const taught = await db
      .selectDistinct({ programId: sessionsTable.programId })
      .from(sessionsTable)
      .where(eq(sessionsTable.instructorId, user.id));
    programIds = taught.map((t) => t.programId);
  } else {
    const enrolled = await db
      .select({ programId: enrollmentsTable.programId })
      .from(enrollmentsTable)
      .where(and(eq(enrollmentsTable.userId, user.id), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
    programIds = enrolled.map((e) => e.programId);
  }
  if (programIds.length === 0) {
    res.json([]);
    return;
  }

  const baseWhere =
    user.role === "instructor"
      ? and(inArray(sessionsTable.programId, programIds), eq(sessionsTable.instructorId, user.id))
      : inArray(sessionsTable.programId, programIds);

  const rows = await db
    .select({
      id: sessionsTable.id,
      programId: sessionsTable.programId,
      programTitle: programsTable.title,
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
    .innerJoin(programsTable, eq(sessionsTable.programId, programsTable.id))
    .leftJoin(usersTable, eq(sessionsTable.instructorId, usersTable.id))
    .where(baseWhere)
    .orderBy(asc(sessionsTable.startsAt), asc(sessionsTable.sortOrder));
  res.json(rows);
});

export default router;
