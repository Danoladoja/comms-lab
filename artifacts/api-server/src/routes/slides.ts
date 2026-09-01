import { Router, type IRouter, type Request } from "express";
import express from "express";
import {
  db, sessionSlidesTable, sessionReadingsTable, sessionNotesTable, courseworkDraftsTable,
  sessionsTable, programsTable, enrollmentsTable, usersTable,
} from "@workspace/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  slideTypeFor,
  slideTextQuality,
  validateReadings,
  combineSources,
  sourceQuality,
  describeSource,
  describeDraftRun,
  roomForMoreQuestions,
  MAX_SLIDE_UPLOAD_BYTES,
  MAX_NOTES_CHARS,
  DEFAULT_NOTES_LABEL,
  MAX_QUIZ_QUESTIONS,
  type CombinedSource,
  type MaterialKind,
  isModuleStaff,
} from "@workspace/domain";
import {
  SetSlidesVisibilityBody, SetSessionReadingsBody, SetSessionNotesBody,
  ReplaceDraftQuestionBody, DraftMoreQuestionsBody,
} from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { progressForUser } from "../lib/progress";
import { extractSlideText } from "../lib/slides/extract";
import {
  draftCoursework, replaceQuestion, moreQuestions, normaliseExisting, drafterConfigured, MODEL,
} from "../lib/slides/drafter";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

function isStaffFor(user: User, session: { instructorId: number | null }) {
  return isModuleStaff(user.role, user.id, session.instructorId);
}

async function loadSession(sessionId: number) {
  const [row] = await db
    .select({
      id: sessionsTable.id,
      programId: sessionsTable.programId,
      title: sessionsTable.title,
      description: sessionsTable.description,
      instructorId: sessionsTable.instructorId,
      programTitle: programsTable.title,
    })
    .from(sessionsTable)
    .innerJoin(programsTable, eq(sessionsTable.programId, programsTable.id))
    .where(eq(sessionsTable.id, sessionId));
  return row ?? null;
}

/** Enrolled and unlocked, or staff. */
async function learnerMayRead(user: User, session: { id: number; programId: number; instructorId: number | null }) {
  if (isStaffFor(user, session)) return true;
  const [enrollment] = await db
    .select({ id: enrollmentsTable.id })
    .from(enrollmentsTable)
    .where(and(
      eq(enrollmentsTable.userId, user.id),
      eq(enrollmentsTable.programId, session.programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));
  if (!enrollment) return false;
  const progress = await progressForUser(user.id, [session.programId]);
  return !progress.find((p) => p.sessionId === session.id)?.locked;
}

function deckPayload(row: {
  sessionId: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  visibleToLearners: boolean;
  extractedText: string;
  createdAt: Date;
}) {
  const quality = slideTextQuality(row.extractedText);
  return {
    sessionId: row.sessionId,
    filename: row.filename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    visibleToLearners: row.visibleToLearners,
    hasReadableText: quality.chars > 0,
    textChars: quality.chars,
    canDraft: quality.usable,
    uploadedAt: row.createdAt.toISOString(),
    downloadPath: `/api/sessions/${row.sessionId}/slides/file`,
  };
}

/* ---------- Upload ---------- */

/**
 * The deck arrives as raw bytes rather than a multipart form: it avoids a file
 * upload dependency, and base64 in JSON would inflate a 20MB deck to 27MB of
 * text for no gain. The filename comes in a header.
 */
router.post(
  "/sessions/:id/slides",
  express.raw({ type: "*/*", limit: MAX_SLIDE_UPLOAD_BYTES }),
  async (req, res) => {
    const user = await getCurrentUser(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const sessionId = Number(req.params.id);
    const session = await loadSession(sessionId);
    if (!session) { res.status(404).json({ error: "Session not found" }); return; }
    if (!isStaffFor(user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

    const filename = String(req.header("x-filename") ?? "deck").slice(0, 200);
    const declaredMime = req.header("x-file-type") ?? req.header("content-type");
    const type = slideTypeFor(filename, declaredMime);
    if (!type) {
      res.status(400).json({ error: "Upload a .pptx, .pdf, .txt or .md file" });
      return;
    }

    const data = req.body as Buffer;
    if (!Buffer.isBuffer(data) || data.length === 0) {
      res.status(400).json({ error: "The upload was empty" });
      return;
    }

    const extractedText = extractSlideText(data, type.mimeType);
    const values = {
      sessionId,
      uploadedByUserId: user.id,
      filename,
      mimeType: type.mimeType,
      sizeBytes: data.length,
      data,
      extractedText,
    };

    const [saved] = await db
      .insert(sessionSlidesTable)
      .values(values)
      // A second upload replaces the first, so there is never a question about
      // which deck a draft came from.
      .onConflictDoUpdate({ target: sessionSlidesTable.sessionId, set: values })
      .returning();

    logger.info({ sessionId, chars: extractedText.length }, "Slide deck uploaded");
    res.status(201).json(deckPayload(saved));
  },
);

/* ---------- Read ---------- */

router.get("/sessions/:id/slides", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const [deck] = await db.select().from(sessionSlidesTable).where(eq(sessionSlidesTable.sessionId, sessionId));
  if (!deck) { res.status(404).json({ error: "No slides for this module" }); return; }

  const staff = isStaffFor(user, session);
  if (!staff) {
    if (!deck.visibleToLearners) { res.status(404).json({ error: "No slides for this module" }); return; }
    if (!(await learnerMayRead(user, session))) { res.status(403).json({ error: "Forbidden" }); return; }
  }
  res.json(deckPayload(deck));
});

router.get("/sessions/:id/slides/file", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const [deck] = await db.select().from(sessionSlidesTable).where(eq(sessionSlidesTable.sessionId, sessionId));
  if (!deck) { res.status(404).json({ error: "No slides for this module" }); return; }

  if (!isStaffFor(user, session)) {
    if (!deck.visibleToLearners) { res.status(404).json({ error: "No slides for this module" }); return; }
    if (!(await learnerMayRead(user, session))) { res.status(403).json({ error: "Forbidden" }); return; }
  }

  res.setHeader("content-type", deck.mimeType);
  // The filename is quoted and stripped of quotes so a deck called
  // `class".pptx` cannot break out of the header.
  res.setHeader("content-disposition", `attachment; filename="${deck.filename.replace(/"/g, "")}"`);
  res.send(Buffer.from(deck.data));
});

/* ---------- Manage ---------- */

router.patch("/sessions/:id/slides/visibility", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = SetSlidesVisibilityBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db
    .update(sessionSlidesTable)
    .set({ visibleToLearners: parsed.data.visibleToLearners })
    .where(eq(sessionSlidesTable.sessionId, sessionId))
    .returning();
  if (!updated) { res.status(404).json({ error: "No slides for this module" }); return; }
  res.json(deckPayload(updated));
});

router.delete("/sessions/:id/slides", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  await db.delete(sessionSlidesTable).where(eq(sessionSlidesTable.sessionId, sessionId));
  res.status(204).end();
});

/* ---------- Pasted material: a transcript, or speaker notes ---------- */

/**
 * What the facilitator typed or pasted in, most often a transcript copied out of
 * the class recording.
 *
 * Staff only, in both directions. A transcript is a verbatim record of a room
 * people spoke freely in, and publishing it to learners is not a decision to
 * make by accident.
 */
router.get("/sessions/:id/notes", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const [row] = await db.select().from(sessionNotesTable).where(eq(sessionNotesTable.sessionId, sessionId));
  res.json(notesPayload(sessionId, row));
});

router.put("/sessions/:id/notes", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = SetSessionNotesBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const values = {
    sessionId,
    label: (parsed.data.label ?? "").trim() || DEFAULT_NOTES_LABEL,
    body: parsed.data.body.slice(0, MAX_NOTES_CHARS),
    updatedByUserId: user.id,
  };

  const [saved] = await db
    .insert(sessionNotesTable)
    .values(values)
    .onConflictDoUpdate({ target: sessionNotesTable.sessionId, set: values })
    .returning();

  res.json(notesPayload(sessionId, saved));
});

function notesPayload(sessionId: number, row?: { label: string; body: string; updatedAt: Date } | null) {
  return {
    sessionId,
    label: row?.label ?? DEFAULT_NOTES_LABEL,
    body: row?.body ?? "",
    chars: (row?.body ?? "").trim().length,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/* ---------- Drafting coursework from whatever material exists ---------- */

/**
 * Gather the deck and the pasted material into one block for the drafter, and
 * say plainly what is missing when there is not enough.
 */
async function materialFor(sessionId: number): Promise<
  { ok: true; source: CombinedSource; notesLabel: string } | { ok: false; status: number; error: string }
> {
  const [[deck], [notes]] = await Promise.all([
    db.select().from(sessionSlidesTable).where(eq(sessionSlidesTable.sessionId, sessionId)),
    db.select().from(sessionNotesTable).where(eq(sessionNotesTable.sessionId, sessionId)),
  ]);

  const notesLabel = notes?.label ?? DEFAULT_NOTES_LABEL;
  const source = combineSources({
    slideText: deck?.extractedText ?? "",
    notesText: notes?.body ?? "",
    notesLabel,
  });

  const quality = sourceQuality(source);
  if (quality.usable) return { ok: true, source, notesLabel };

  // The message has to tell the facilitator what to do next, and the right next
  // step differs depending on what they already have.
  const deckUnreadable = !!deck && slideTextQuality(deck.extractedText).chars === 0;
  const error = quality.reason === "empty"
    ? deckUnreadable
      ? "No text could be read from this deck — PDFs and image-only slides give nothing to work from. Upload the .pptx, or paste the class transcript below."
      : "There is nothing to draft from yet. Upload a deck, or paste the class transcript below."
    : "There is too little here to draft from. Paste the class transcript below, or upload a fuller deck.";

  return { ok: false, status: 400, error };
}

/** Keep a record of what was read, by whom, and what came back. */
async function recordRun(args: {
  sessionId: number;
  userId: number;
  kind: "draft" | "replace" | "expand";
  source: CombinedSource;
  notesLabel: string;
  questionCount: number;
  payload: unknown;
}) {
  try {
    await db.insert(courseworkDraftsTable).values({
      sessionId: args.sessionId,
      createdByUserId: args.userId,
      kind: args.kind,
      model: MODEL,
      sourceKinds: args.source.kinds,
      sourceLabel: args.notesLabel,
      sourceChars: args.source.chars,
      questionCount: args.questionCount,
      payload: args.payload,
    });
  } catch (err) {
    // Losing the audit row must not lose the facilitator their draft.
    logger.error({ err, sessionId: args.sessionId }, "Could not record a drafting run");
  }
}

function sourcePayload(source: CombinedSource, notesLabel: string) {
  return {
    kinds: source.kinds,
    chars: source.chars,
    truncated: source.truncated,
    description: describeSource(source.kinds, notesLabel),
  };
}

/** Everything the three drafting endpoints check before spending a request. */
async function readyToDraft(req: Request, sessionId: number) {
  const user = await getCurrentUser(req);
  if (!user) return { ok: false, fail: { status: 401, error: "Unauthorized" } } as const;

  const session = await loadSession(sessionId);
  if (!session) return { ok: false, fail: { status: 404, error: "Session not found" } } as const;
  if (!isStaffFor(user, session)) return { ok: false, fail: { status: 403, error: "Forbidden" } } as const;

  if (!drafterConfigured()) {
    return {
      ok: false,
      fail: {
        status: 503,
        error: "No AI key is configured on the server. Add ANTHROPIC_API_KEY to use drafting.",
      },
    } as const;
  }

  const material = await materialFor(sessionId);
  if (!material.ok) return { ok: false, fail: { status: material.status, error: material.error } } as const;

  return {
    ok: true,
    user,
    source: material.source,
    notesLabel: material.notesLabel,
    context: {
      programTitle: session.programTitle,
      sessionTitle: session.title,
      sessionDescription: session.description,
      sourceText: material.source.text,
    },
  } as const;
}

router.post("/sessions/:id/coursework/draft", async (req, res) => {
  const sessionId = Number(req.params.id);
  const ready = await readyToDraft(req, sessionId);
  if (!ready.ok) { res.status(ready.fail.status).json({ error: ready.fail.error }); return; }

  const result = await draftCoursework(ready.context);
  const questions = result.draft?.questions ?? [];

  logger.info(
    { sessionId, kinds: ready.source.kinds, chars: ready.source.chars, questions: questions.length },
    "Drafted coursework",
  );

  if (result.draft) {
    await recordRun({
      sessionId,
      userId: ready.user.id,
      kind: "draft",
      source: ready.source,
      notesLabel: ready.notesLabel,
      questionCount: questions.length,
      payload: result.draft,
    });
  }

  res.json({
    questions,
    assignment: result.draft?.assignment ?? null,
    problems: result.problems,
    notes: result.draft?.notes ?? [],
    source: sourcePayload(ready.source, ready.notesLabel),
  });
});

/** Redo one question, without touching the rest of the quiz. */
router.post("/sessions/:id/coursework/questions/replace", async (req, res) => {
  const sessionId = Number(req.params.id);

  // Authorisation first, as on the sibling route: a caller with no business here
  // gets 401 or 403, not a description of the schema they failed to match.
  const ready = await readyToDraft(req, sessionId);
  if (!ready.ok) { res.status(ready.fail.status).json({ error: ready.fail.error }); return; }

  const parsed = ReplaceDraftQuestionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const result = await replaceQuestion({
    ...ready.context,
    existing: normaliseExisting(parsed.data.existing),
    replaceIndex: parsed.data.replaceIndex,
    guidance: parsed.data.guidance,
  });

  if (result.questions.length > 0) {
    await recordRun({
      sessionId,
      userId: ready.user.id,
      kind: "replace",
      source: ready.source,
      notesLabel: ready.notesLabel,
      questionCount: result.questions.length,
      payload: result.questions,
    });
  }

  res.json({ ...result, source: sourcePayload(ready.source, ready.notesLabel) });
});

/** A few more questions, covering ground the quiz has not. */
router.post("/sessions/:id/coursework/questions/more", async (req, res) => {
  const sessionId = Number(req.params.id);

  // Authorisation first: a caller with no business here gets 401 or 403, not a
  // lecture about quiz length.
  const ready = await readyToDraft(req, sessionId);
  if (!ready.ok) { res.status(ready.fail.status).json({ error: ready.fail.error }); return; }

  const parsed = DraftMoreQuestionsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = normaliseExisting(parsed.data.existing);
  const written = existing.filter((q) => q.prompt).length;
  if (roomForMoreQuestions(written) === 0) {
    res.status(400).json({
      error: `${MAX_QUIZ_QUESTIONS} questions is as long as a quiz should get. Remove one before adding another.`,
    });
    return;
  }

  const result = await moreQuestions({
    ...ready.context,
    existing,
    wanted: parsed.data.wanted ?? 2,
    guidance: parsed.data.guidance,
  });

  if (result.questions.length > 0) {
    await recordRun({
      sessionId,
      userId: ready.user.id,
      kind: "expand",
      source: ready.source,
      notesLabel: ready.notesLabel,
      questionCount: result.questions.length,
      payload: result.questions,
    });
  }

  res.json({ ...result, source: sourcePayload(ready.source, ready.notesLabel) });
});

/**
 * Where this module's coursework came from.
 *
 * The question worth being able to answer in six months is not "was AI used"
 * but "was anyone reading" — so each run records what material it read and how
 * much of it, not merely that it happened.
 */
router.get("/sessions/:id/coursework/history", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const rows = await db
    .select({
      id: courseworkDraftsTable.id,
      kind: courseworkDraftsTable.kind,
      model: courseworkDraftsTable.model,
      sourceKinds: courseworkDraftsTable.sourceKinds,
      sourceLabel: courseworkDraftsTable.sourceLabel,
      questionCount: courseworkDraftsTable.questionCount,
      createdAt: courseworkDraftsTable.createdAt,
      byName: usersTable.name,
    })
    .from(courseworkDraftsTable)
    .leftJoin(usersTable, eq(courseworkDraftsTable.createdByUserId, usersTable.id))
    .where(eq(courseworkDraftsTable.sessionId, sessionId))
    .orderBy(desc(courseworkDraftsTable.createdAt))
    .limit(20);

  res.json(rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    model: row.model,
    questionCount: row.questionCount,
    createdAt: row.createdAt.toISOString(),
    by: row.byName,
    summary: describeDraftRun({
      kinds: (row.sourceKinds ?? []) as MaterialKind[],
      notesLabel: row.sourceLabel,
      questionCount: row.questionCount,
      byName: row.byName,
      at: row.createdAt,
    }),
  })));
});

/* ---------- Reading list ---------- */

/**
 * Further reading. Ungraded, and never consulted by `computeProgress` — adding
 * a link cannot change whether anyone can finish a module.
 */
router.get("/sessions/:id/readings", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  if (!isStaffFor(user, session) && !(await learnerMayRead(user, session))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await db
    .select({ title: sessionReadingsTable.title, url: sessionReadingsTable.url, note: sessionReadingsTable.note })
    .from(sessionReadingsTable)
    .where(eq(sessionReadingsTable.sessionId, sessionId))
    .orderBy(asc(sessionReadingsTable.sortOrder), asc(sessionReadingsTable.id));
  res.json(rows);
});

router.put("/sessions/:id/readings", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  const parsed = SetSessionReadingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { items, problems } = validateReadings(parsed.data.items);

  // Replace wholesale: the editor sends the list as the facilitator wants it,
  // and a partial save would leave a half-edited shelf behind.
  await db.transaction(async (tx) => {
    await tx.delete(sessionReadingsTable).where(eq(sessionReadingsTable.sessionId, sessionId));
    if (items.length > 0) {
      await tx.insert(sessionReadingsTable).values(
        items.map((item, i) => ({ sessionId, ...item, sortOrder: i })),
      );
    }
  });

  res.json({ items, problems });
});

export default router;
