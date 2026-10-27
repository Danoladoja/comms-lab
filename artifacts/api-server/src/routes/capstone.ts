import { Router, type IRouter } from "express";
import express from "express";
import {
  db, capstonesTable, capstoneSubmissionsTable,
  programsTable, enrollmentsTable, usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  capstonePublishProblem, capstoneSubmitProblem, capstoneReviewProblem,
  capstoneStanding, capstoneFileType, countWords, listCapstoneFormats,
  MAX_CAPSTONE_UPLOAD_BYTES,
  satisfiesRole, isStaffRole,
} from "@workspace/domain";
import { SetCapstoneBody, SaveCapstoneDraftBody, ReviewCapstoneBody } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { logger } from "../lib/logger";

/**
 * The piece of work a programme ends on.
 *
 * Three things in this file are load-bearing beyond the obvious.
 *
 * The first is that an attempt is never overwritten. A piece sent back stays
 * exactly as it was, with the note it was given, and the next go is a new row.
 * The question "what did they actually hand in the first time, and what were
 * they told about it" has to be answerable a year later, and an UPDATE cannot
 * answer it.
 *
 * The second is that publishing one of these starts withholding certificates
 * for the whole cohort. So the publish gate is a sentence an admin reads before
 * pressing the button, not a validation error afterwards.
 *
 * The third is that a learner who has done everything and is waiting on staff
 * must be told so. The certificates page used to show "finish all the modules"
 * to people who had finished all the modules; a capstone adds a second way to
 * be stuck in exactly that silence, so the reason travels with the refusal.
 */

const router: IRouter = Router();

const message = (error: string) => ({ error });

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

async function loadCapstone(programId: number) {
  const [row] = await db.select().from(capstonesTable).where(eq(capstonesTable.programId, programId));
  return row ?? null;
}

/** The learner's current row: their open draft, or the last thing decided. */
async function latestFor(capstoneId: number, userId: number) {
  const [row] = await db
    .select()
    .from(capstoneSubmissionsTable)
    .where(and(
      eq(capstoneSubmissionsTable.capstoneId, capstoneId),
      eq(capstoneSubmissionsTable.userId, userId),
    ))
    .orderBy(desc(capstoneSubmissionsTable.attempt))
    .limit(1);
  return row ?? null;
}

async function isEnrolled(userId: number, programId: number) {
  const [row] = await db
    .select({ id: enrollmentsTable.id })
    .from(enrollmentsTable)
    .where(and(
      eq(enrollmentsTable.userId, userId),
      eq(enrollmentsTable.programId, programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));
  return Boolean(row);
}

function briefPayload(c: typeof capstonesTable.$inferSelect) {
  return {
    id: c.id,
    programId: c.programId,
    title: c.title,
    brief: c.brief,
    wordsAtLeast: c.wordsAtLeast,
    wordsAtMost: c.wordsAtMost,
    maxScore: c.maxScore,
    dueAt: c.dueAt?.toISOString() ?? null,
    draft: c.draft,
    postedAt: c.postedAt?.toISOString() ?? null,
  };
}

function attemptPayload(s: typeof capstoneSubmissionsTable.$inferSelect) {
  return {
    id: s.id,
    attempt: s.attempt,
    status: s.status,
    body: s.body,
    words: countWords(s.body),
    filename: s.filename,
    sizeBytes: s.sizeBytes,
    downloadPath: s.filename ? `/api/capstone/submissions/${s.id}/file` : null,
    submittedAt: s.submittedAt?.toISOString() ?? null,
    late: s.late,
    score: s.score,
    reviewNote: s.reviewNote,
    reviewedAt: s.reviewedAt?.toISOString() ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * The learner
 * ------------------------------------------------------------------ */

router.get("/programs/:programId/capstone", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }

  const programId = Number(req.params.programId);
  if (!Number.isInteger(programId) || programId < 1) { res.status(400).json(message("That is not a programme")); return; }

  const capstone = await loadCapstone(programId);
  // A programme with no capstone, or one still being written, behaves exactly
  // as it did before any of this existed: there is nothing here.
  if (!capstone || capstone.draft) { res.status(404).json(message("This programme has no capstone")); return; }
  if (!(await isEnrolled(user.id, programId)) && !isStaffRole(user.role)) {
    res.status(403).json(message("You are not on this programme")); return;
  }

  const latest = await latestFor(capstone.id, user.id);
  const standing = capstoneStanding(latest ? { status: latest.status, score: latest.score } : null);

  // Every decided attempt, so a learner can see what they were told last time
  // while they write the next one.
  const history = await db
    .select()
    .from(capstoneSubmissionsTable)
    .where(and(
      eq(capstoneSubmissionsTable.capstoneId, capstone.id),
      eq(capstoneSubmissionsTable.userId, user.id),
      sql`${capstoneSubmissionsTable.status} in ('approved', 'returned')`,
    ))
    .orderBy(desc(capstoneSubmissionsTable.attempt));

  res.json({
    capstone: briefPayload(capstone),
    current: latest ? attemptPayload(latest) : null,
    history: history.map(attemptPayload),
    headline: standing.headline,
    mayEdit: standing.mayEdit,
    maySubmit: standing.maySubmit,
  });
});

/**
 * Save what they have written so far.
 *
 * Opens a fresh attempt when the last one was decided, so a learner whose piece
 * came back starts typing into attempt two rather than editing the record of
 * attempt one.
 */
router.put("/programs/:programId/capstone/draft", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }

  const programId = Number(req.params.programId);
  const body = SaveCapstoneDraftBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }

  const capstone = await loadCapstone(programId);
  if (!capstone || capstone.draft) { res.status(404).json(message("This programme has no capstone")); return; }
  if (!(await isEnrolled(user.id, programId))) { res.status(403).json(message("You are not on this programme")); return; }

  const latest = await latestFor(capstone.id, user.id);
  if (latest && latest.status === "submitted") {
    res.status(409).json(message("This has been sent and is waiting to be read. You cannot change it now."));
    return;
  }
  if (latest && latest.status === "approved") {
    res.status(409).json(message("This capstone has been approved. There is nothing left to change."));
    return;
  }

  if (latest && latest.status === "draft") {
    const [saved] = await db.update(capstoneSubmissionsTable)
      .set({ body: body.data.body })
      .where(eq(capstoneSubmissionsTable.id, latest.id))
      .returning();
    res.json(attemptPayload(saved));
    return;
  }

  const [saved] = await db.insert(capstoneSubmissionsTable)
    .values({
      capstoneId: capstone.id,
      userId: user.id,
      attempt: latest ? latest.attempt + 1 : 1,
      status: "draft",
      body: body.data.body,
    })
    .returning();
  res.status(201).json(attemptPayload(saved));
});

/**
 * Attach the document.
 *
 * Raw bytes with the name in a header rather than a multipart form, following
 * the slide decks: it avoids an upload dependency, and base64 in JSON would
 * inflate an eight megabyte file into eleven megabytes of text for no gain.
 */
router.post(
  "/programs/:programId/capstone/draft/file",
  express.raw({ type: "*/*", limit: MAX_CAPSTONE_UPLOAD_BYTES }),
  async (req, res) => {
    const user = await getCurrentUser(req);
    if (!user) { res.status(401).json(message("Unauthorized")); return; }

    const programId = Number(req.params.programId);
    const capstone = await loadCapstone(programId);
    if (!capstone || capstone.draft) { res.status(404).json(message("This programme has no capstone")); return; }
    if (!(await isEnrolled(user.id, programId))) { res.status(403).json(message("You are not on this programme")); return; }

    const filename = String(req.header("x-filename") ?? "capstone").slice(0, 200);
    const type = capstoneFileType(filename, req.header("x-file-type") ?? req.header("content-type"));
    if (!type) { res.status(400).json(message(`Attach a ${listCapstoneFormats()} file`)); return; }

    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) { res.status(400).json(message("The upload was empty")); return; }

    const latest = await latestFor(capstone.id, user.id);
    if (latest && latest.status === "submitted") {
      res.status(409).json(message("This has been sent and is waiting to be read. You cannot change it now."));
      return;
    }
    if (latest && latest.status === "approved") {
      res.status(409).json(message("This capstone has been approved. There is nothing left to change."));
      return;
    }

    const file = { filename, mimeType: type.mimeType, sizeBytes: data.length, data };
    if (latest && latest.status === "draft") {
      const [saved] = await db.update(capstoneSubmissionsTable)
        .set(file)
        .where(eq(capstoneSubmissionsTable.id, latest.id))
        .returning();
      res.status(201).json(attemptPayload(saved));
      return;
    }
    const [saved] = await db.insert(capstoneSubmissionsTable)
      .values({
        capstoneId: capstone.id, userId: user.id,
        attempt: latest ? latest.attempt + 1 : 1, status: "draft", body: "", ...file,
      })
      .returning();
    res.status(201).json(attemptPayload(saved));
  },
);

router.delete("/programs/:programId/capstone/draft/file", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }

  const capstone = await loadCapstone(Number(req.params.programId));
  if (!capstone) { res.status(404).json(message("This programme has no capstone")); return; }

  const latest = await latestFor(capstone.id, user.id);
  if (!latest || latest.status !== "draft") { res.status(409).json(message("There is no draft to change")); return; }

  const [saved] = await db.update(capstoneSubmissionsTable)
    .set({ filename: null, mimeType: null, sizeBytes: null, data: null })
    .where(eq(capstoneSubmissionsTable.id, latest.id))
    .returning();
  res.json(attemptPayload(saved));
});

router.post("/programs/:programId/capstone/submit", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }

  const programId = Number(req.params.programId);
  const capstone = await loadCapstone(programId);
  if (!capstone || capstone.draft) { res.status(404).json(message("This programme has no capstone")); return; }
  if (!(await isEnrolled(user.id, programId))) { res.status(403).json(message("You are not on this programme")); return; }

  const latest = await latestFor(capstone.id, user.id);
  if (!latest || latest.status !== "draft") {
    res.status(409).json(message("There is nothing to send. Write the piece first."));
    return;
  }

  const problem = capstoneSubmitProblem({
    body: latest.body,
    wordsAtLeast: capstone.wordsAtLeast,
    wordsAtMost: capstone.wordsAtMost,
    dueAt: capstone.dueAt?.toISOString() ?? null,
    nowMs: Date.now(),
    hasFile: Boolean(latest.filename),
  });
  if (problem) { res.status(400).json(message(problem)); return; }

  const [sent] = await db.update(capstoneSubmissionsTable)
    .set({ status: "submitted", submittedAt: new Date(), late: false })
    .where(eq(capstoneSubmissionsTable.id, latest.id))
    .returning();

  logger.info({ capstoneId: capstone.id, userId: user.id, attempt: sent.attempt }, "Capstone submitted");
  res.json(attemptPayload(sent));
});

/** The attached document, to its author or to staff. */
router.get("/capstone/submissions/:id/file", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }

  const id = Number(req.params.id);
  const [row] = await db.select().from(capstoneSubmissionsTable).where(eq(capstoneSubmissionsTable.id, id));
  if (!row || !row.filename || !row.data) { res.status(404).json(message("No document on this submission")); return; }
  if (row.userId !== user.id && !isStaffRole(user.role)) { res.status(403).json(message("Forbidden")); return; }

  res.setHeader("content-type", row.mimeType ?? "application/octet-stream");
  // Quotes stripped so a file called `piece".pdf` cannot break out of the header.
  res.setHeader("content-disposition", `attachment; filename="${row.filename.replace(/"/g, "")}"`);
  res.send(Buffer.from(row.data));
});

/* ------------------------------------------------------------------ *
 * Staff
 * ------------------------------------------------------------------ */

function mayManage(user: User) { return satisfiesRole(user.role, ["admin"]); }

router.get("/admin/programs/:programId/capstone", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!isStaffRole(user.role)) { res.status(403).json(message("Only staff can read a capstone")); return; }

  const programId = Number(req.params.programId);
  const [programme] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (!programme) { res.status(404).json(message("Programme not found")); return; }

  const capstone = await loadCapstone(programId);

  /*
    Everybody on the cohort, with whatever their newest attempt is.

    A left join rather than two queries because the useful screen is the one
    that shows who has not started as plainly as who is waiting — a list of
    submissions alone hides exactly the people a facilitator needs to chase.
  */
  const learners = capstone
    ? await db.execute(sql`
        select u.id as user_id,
               coalesce(nullif(trim(u.name), ''), u.email) as name,
               u.email as email,
               s.id as submission_id, s.attempt, s.status, s.score,
               s.submitted_at, s.reviewed_at, s.filename,
               length(s.body) as body_chars
        from enrollments e
        join users u on u.id = e.user_id
        left join lateral (
          select * from capstone_submissions cs
          where cs.capstone_id = ${capstone.id} and cs.user_id = e.user_id
          order by cs.attempt desc limit 1
        ) s on true
        where e.program_id = ${programId} and e.status in ('enrolled', 'completed')
        order by name asc
      `)
    : { rows: [] as Record<string, unknown>[] };

  const rows = (learners as { rows: Record<string, unknown>[] }).rows ?? [];
  const waiting = rows.filter((r) => r.status === "submitted").length;
  const approved = rows.filter((r) => r.status === "approved").length;

  res.json({
    programmeTitle: programme.title,
    capstone: capstone ? briefPayload(capstone) : null,
    waiting,
    approved,
    learners: rows.map((r) => ({
      userId: Number(r.user_id),
      name: String(r.name ?? "Unnamed"),
      email: String(r.email ?? ""),
      submissionId: r.submission_id === null || r.submission_id === undefined ? null : Number(r.submission_id),
      attempt: r.attempt === null || r.attempt === undefined ? null : Number(r.attempt),
      status: r.status === null || r.status === undefined ? null : String(r.status),
      score: r.score === null || r.score === undefined ? null : Number(r.score),
      hasFile: Boolean(r.filename),
      submittedAt: r.submitted_at ? new Date(String(r.submitted_at)).toISOString() : null,
    })),
  });
});

router.put("/admin/programs/:programId/capstone", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!mayManage(user)) { res.status(403).json(message("Only admins can set a capstone")); return; }

  const programId = Number(req.params.programId);
  const body = SetCapstoneBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }

  const [programme] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (!programme) { res.status(404).json(message("Programme not found")); return; }

  const values = {
    programId,
    title: body.data.title,
    brief: body.data.brief,
    wordsAtLeast: body.data.wordsAtLeast,
    wordsAtMost: body.data.wordsAtMost,
    maxScore: body.data.maxScore,
    dueAt: body.data.dueAt ? new Date(body.data.dueAt) : null,
  };

  const [saved] = await db.insert(capstonesTable).values(values)
    .onConflictDoUpdate({ target: capstonesTable.programId, set: values })
    .returning();

  res.json(briefPayload(saved));
});

/**
 * Put it in front of the cohort.
 *
 * Separate from saving, and gated, because this is the moment certificates
 * start being withheld. A half-written brief that goes live holds up a whole
 * programme until somebody notices.
 */
router.post("/admin/programs/:programId/capstone/publish", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!mayManage(user)) { res.status(403).json(message("Only admins can publish a capstone")); return; }

  const capstone = await loadCapstone(Number(req.params.programId));
  if (!capstone) { res.status(404).json(message("There is no capstone on this programme yet")); return; }
  if (!capstone.draft) { res.json(briefPayload(capstone)); return; }

  const problem = capstonePublishProblem({
    title: capstone.title,
    brief: capstone.brief,
    wordsAtLeast: capstone.wordsAtLeast,
    wordsAtMost: capstone.wordsAtMost,
    maxScore: capstone.maxScore,
    dueAt: capstone.dueAt?.toISOString() ?? null,
  }, Date.now());
  if (problem) { res.status(400).json(message(problem)); return; }

  const [live] = await db.update(capstonesTable)
    .set({ draft: false, postedAt: new Date() })
    .where(eq(capstonesTable.id, capstone.id))
    .returning();

  logger.info({ capstoneId: capstone.id, by: user.id }, "Capstone published");
  res.json(briefPayload(live));
});

/** One piece, in full, for whoever is reading it. */
router.get("/admin/capstone/submissions/:id", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!isStaffRole(user.role)) { res.status(403).json(message("Only staff can read a capstone")); return; }

  const [row] = await db.select().from(capstoneSubmissionsTable)
    .where(eq(capstoneSubmissionsTable.id, Number(req.params.id)));
  if (!row) { res.status(404).json(message("Submission not found")); return; }

  const [capstone] = await db.select().from(capstonesTable).where(eq(capstonesTable.id, row.capstoneId));
  const [learner] = await db.select({ name: usersTable.name, email: usersTable.email })
    .from(usersTable).where(eq(usersTable.id, row.userId));

  const earlier = await db.select().from(capstoneSubmissionsTable)
    .where(and(
      eq(capstoneSubmissionsTable.capstoneId, row.capstoneId),
      eq(capstoneSubmissionsTable.userId, row.userId),
      sql`${capstoneSubmissionsTable.attempt} < ${row.attempt}`,
    ))
    .orderBy(asc(capstoneSubmissionsTable.attempt));

  res.json({
    ...attemptPayload(row),
    learnerName: (learner?.name ?? "").trim() || learner?.email || "Unnamed",
    learnerEmail: learner?.email ?? "",
    maxScore: capstone?.maxScore ?? 100,
    capstoneTitle: capstone?.title ?? "",
    earlier: earlier.map(attemptPayload),
  });
});

/**
 * Approve it, or send it back.
 *
 * Sending back opens nothing here. The learner's next draft is created the
 * moment they next save, which keeps this one write and avoids a half-created
 * attempt sitting in the table if the learner never returns.
 */
router.post("/admin/capstone/submissions/:id/review", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json(message("Unauthorized")); return; }
  if (!isStaffRole(user.role)) { res.status(403).json(message("Only staff can mark a capstone")); return; }

  const body = ReviewCapstoneBody.safeParse(req.body);
  if (!body.success) { res.status(400).json(message(body.error.message)); return; }

  const [row] = await db.select().from(capstoneSubmissionsTable)
    .where(eq(capstoneSubmissionsTable.id, Number(req.params.id)));
  if (!row) { res.status(404).json(message("Submission not found")); return; }

  const [capstone] = await db.select().from(capstonesTable).where(eq(capstonesTable.id, row.capstoneId));
  if (!capstone) { res.status(404).json(message("Submission not found")); return; }

  const score = body.data.score === undefined ? null : body.data.score;
  const problem = capstoneReviewProblem({
    decision: body.data.decision,
    score,
    maxScore: capstone.maxScore,
    note: body.data.note ?? "",
    status: row.status,
  });
  if (problem) { res.status(400).json(message(problem)); return; }

  const [decided] = await db.update(capstoneSubmissionsTable)
    .set({
      status: body.data.decision === "approve" ? "approved" : "returned",
      score,
      reviewNote: body.data.note ?? "",
      reviewedByUserId: user.id,
      reviewedAt: new Date(),
    })
    .where(eq(capstoneSubmissionsTable.id, row.id))
    .returning();

  logger.info(
    { submissionId: row.id, decision: body.data.decision, by: user.id },
    "Capstone reviewed",
  );
  res.json(attemptPayload(decided));
});

export default router;
