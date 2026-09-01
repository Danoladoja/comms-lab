import { Router, type IRouter } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateSessionBody } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { isModuleStaff, satisfiesRole } from "@workspace/domain";

const router: IRouter = Router();

router.patch("/sessions/:id", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = Number(req.params.id);
  const existing = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const isAdmin = satisfiesRole(user.role, ["admin"]);
  if (!isModuleStaff(user.role, user.id, existing[0].instructorId)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const parsed = UpdateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Creating the meeting room is an admin duty, so instructors cannot set
  // meetUrl — only the recording and the description of their own session.
  const data: Record<string, unknown> = isAdmin
    ? { ...parsed.data }
    : { recordingUrl: parsed.data.recordingUrl, description: parsed.data.description };

  // A link put in by a person outranks the automatic transfer. Marking it
  // "manual" stops the Meet-to-YouTube job replacing it; clearing the field
  // hands the session back to the job.
  if ("recordingUrl" in data) {
    data.recordingStatus = data.recordingUrl ? "manual" : "pending";
    data.recordingError = null;
  }

  // An account holder and a typed guest name are alternatives, never both: a
  // class with one of each would leave every page choosing which to believe.
  if ("instructorId" in data && data.instructorId) data.guestFacilitator = null;
  if ("guestFacilitator" in data && data.guestFacilitator) data.instructorId = null;

  const [updated] = await db.update(sessionsTable).set(data).where(eq(sessionsTable.id, id)).returning();
  const instructor = updated.instructorId
    ? await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, updated.instructorId))
    : [];
  res.json({ ...updated, instructorName: instructor[0]?.name ?? updated.guestFacilitator ?? null });
});

router.delete("/sessions/:id", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user || !satisfiesRole(user.role, ["admin"])) {
    res.status(user ? 403 : 401).json({ error: user ? "Forbidden" : "Unauthorized" });
    return;
  }
  const id = Number(req.params.id);
  await db.delete(sessionsTable).where(eq(sessionsTable.id, id));
  res.status(204).end();
});

export default router;
