import { Router, type IRouter } from "express";
import { db, enrollmentsTable, programsTable, usersTable } from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { UpdateUserRoleBody, UpdateEnrollmentBody } from "@workspace/api-zod";
import { requireRole } from "../lib/auth";
import { sendWaitlistPromotion } from "../lib/enrollmentEmails";

const router: IRouter = Router();

router.use("/admin", requireRole("admin"));

router.get("/admin/users", async (_req, res) => {
  const rows = await db
    .select({
      id: usersTable.id,
      clerkUserId: usersTable.clerkUserId,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
    })
    .from(usersTable)
    .orderBy(asc(usersTable.id));
  res.json(rows);
});

router.patch("/admin/users/:id/role", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateUserRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await db.update(usersTable).set({ role: parsed.data.role }).where(eq(usersTable.id, id)).returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const u = updated[0];
  res.json({ id: u.id, clerkUserId: u.clerkUserId, email: u.email, name: u.name, role: u.role });
});

router.get("/admin/enrollments", async (req, res) => {
  const programId = req.query.programId ? Number(req.query.programId) : undefined;
  const base = db
    .select({
      id: enrollmentsTable.id,
      userId: enrollmentsTable.userId,
      programId: enrollmentsTable.programId,
      status: enrollmentsTable.status,
      programTitle: programsTable.title,
      programStartDate: programsTable.startDate,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(enrollmentsTable)
    .innerJoin(programsTable, eq(enrollmentsTable.programId, programsTable.id))
    .innerJoin(usersTable, eq(enrollmentsTable.userId, usersTable.id));
  const rows = programId
    ? await base.where(eq(enrollmentsTable.programId, programId)).orderBy(asc(enrollmentsTable.id))
    : await base.orderBy(asc(enrollmentsTable.id));
  res.json(rows);
});

router.patch("/admin/enrollments/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateEnrollmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  type PromotedLearner = { email: string; name: string; program: { title: string; startDate: string } };
  let promoted: PromotedLearner | null = null;
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(enrollmentsTable)
      .set({ status: parsed.data.status })
      .where(eq(enrollmentsTable.id, id))
      .returning();
    if (rows.length === 0) return rows;
    // If a place opened up, promote the oldest waitlisted learner (FIFO).
    if (parsed.data.status === "cancelled") {
      const programId = rows[0].programId;
      await tx.execute(sql`select id from ${programsTable} where id = ${programId} for update`);
      const [program] = await tx.select().from(programsTable).where(eq(programsTable.id, programId));
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(enrollmentsTable)
        .where(and(eq(enrollmentsTable.programId, programId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
      if (program && count < program.capacity) {
        const waitlisted = await tx
          .select()
          .from(enrollmentsTable)
          .where(and(eq(enrollmentsTable.programId, programId), eq(enrollmentsTable.status, "waitlisted")))
          .orderBy(asc(enrollmentsTable.createdAt), asc(enrollmentsTable.id))
          .limit(1);
        if (waitlisted.length > 0) {
          await tx.update(enrollmentsTable).set({ status: "enrolled" }).where(eq(enrollmentsTable.id, waitlisted[0].id));
          const [learner] = await tx
            .select({ email: usersTable.email, name: usersTable.name })
            .from(usersTable)
            .where(eq(usersTable.id, waitlisted[0].userId));
          if (learner) {
            promoted = { ...learner, program: { title: program.title, startDate: program.startDate } };
          }
        }
      }
    }
    return rows;
  });
  // Email only after the promotion has committed; failure only logs.
  const p = promoted as PromotedLearner | null;
  if (p) {
    sendWaitlistPromotion({ email: p.email, name: p.name }, p.program);
  }
  if (updated.length === 0) {
    res.status(404).json({ error: "Enrollment not found" });
    return;
  }
  res.json(updated[0]);
});

export default router;
