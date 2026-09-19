import { Router, type IRouter } from "express";
import { db, sessionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateSessionBody } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { isModuleStaff, satisfiesRole, normaliseMeetUrl } from "@workspace/domain";
import { syncMeetingTime } from "../lib/classMeetings";

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
  const data: Record<string, unknown> = isAdmin ? { ...parsed.data } : {};
  if (!isAdmin) {
    // Only the keys actually sent. Copying both unconditionally meant an
    // instructor fixing a typo in their description also looked like they had
    // touched the recording, which reset the transfer job and freed it to
    // overwrite a link a person had deliberately pasted.
    for (const key of ["recordingUrl", "description"] as const) {
      if (key in parsed.data) data[key] = parsed.data[key];
    }
  }

  /**
   * Repair a pasted address, or refuse the save — never quietly empty the box.
   *
   * Both links go through the same repair: one with no scheme is a path rather
   * than a place, and one carrying a scheme nobody should follow is refused
   * outright rather than rendered as a link for a whole cohort.
   *
   * What matters as much is the failure. Returning null on something
   * unreadable meant the admin pressed Save, got no complaint, and had the link
   * silently deleted — and the field is the only record of it. A value that was
   * typed and cannot be understood now stops the save and says so. Only an
   * empty box clears a link, because only an empty box means "clear it".
   */
  const repair = (key: "meetUrl" | "recordingUrl", label: string): string | null => {
    const raw = data[key];
    if (raw === undefined) return null;
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) { data[key] = null; return null; }
    const cleaned = normaliseMeetUrl(text);
    if (!cleaned) {
      return `That ${label} could not be read. Paste the full web address, starting with https://`;
    }
    data[key] = cleaned;
    return null;
  };

  const linkProblem = repair("meetUrl", "meeting link") ?? repair("recordingUrl", "recording link");
  if (linkProblem) {
    res.status(400).json({ error: linkProblem });
    return;
  }

  // A link put in by a person outranks the automatic transfer. Marking it
  // "manual" stops the Meet-to-YouTube job replacing it; clearing the field
  // hands the session back to the job.
  /*
    Only when the recording has actually changed.

    This read `if ("recordingUrl" in data)`, and the admin console sends the
    recording link on every save — it is one Save button for the whole row. So
    correcting a facilitator's name threw away the agreed length of the video,
    and the next learner to open the replay settled a new one from their own
    player, anywhere between a quarter of the class length and three times it.
    Nobody touched the recording and nobody could see what had happened.
  */
  const recordingChanged = "recordingUrl" in data
    && (data.recordingUrl ?? null) !== (existing[0].recordingUrl ?? null);
  if (recordingChanged) {
    data.recordingStatus = data.recordingUrl ? "manual" : "pending";
    data.recordingError = null;
    // A different video has a different length, so the settled figure the whole
    // cohort's replay coverage is measured against has to go with it.
    data.recordingDurationSeconds = null;
  } else if ("recordingUrl" in data) {
    // Same link as before: nothing about the recording has changed, so nothing
    // about the recording should be rewritten.
    delete data.recordingUrl;
  }

  // An account holder and a typed guest name are alternatives, never both: a
  // class with one of each would leave every page choosing which to believe.
  if ("instructorId" in data && data.instructorId) data.guestFacilitator = null;
  if ("guestFacilitator" in data && data.guestFacilitator) data.instructorId = null;

  const [updated] = await db.update(sessionsTable).set(data).where(eq(sessionsTable.id, id)).returning();

  // If the Lab made this class's meeting, the calendar follows the class. This
  // is the entire point of the Lab owning the event: a date changed here and
  // not there is the two copies of a link drifting apart again, which is the
  // failure that cost this cohort three weeks of attendance.
  //
  // Not awaited, and failures do not reach the admin: they were saving a
  // module, and a calendar briefly out of step is not a reason to tell them
  // the save did not work. It is logged.
  const timingChanged = "startsAt" in data || "durationMins" in data || "title" in data;
  if (timingChanged && updated.calendarEventId) void syncMeetingTime(id);

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
