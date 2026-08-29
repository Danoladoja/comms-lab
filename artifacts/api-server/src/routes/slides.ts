import { Router, type IRouter } from "express";
import express from "express";
import {
  db, sessionSlidesTable, sessionReadingsTable, sessionsTable, programsTable, enrollmentsTable,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  slideTypeFor,
  slideTextQuality,
  validateReadings,
  MAX_SLIDE_UPLOAD_BYTES,
} from "@workspace/domain";
import { SetSlidesVisibilityBody, SetSessionReadingsBody } from "@workspace/api-zod";
import { getCurrentUser } from "../lib/auth";
import { progressForUser } from "../lib/progress";
import { extractSlideText } from "../lib/slides/extract";
import { draftCoursework, drafterConfigured } from "../lib/slides/drafter";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

function isStaffFor(user: User, session: { instructorId: number | null }) {
  return user.role === "admin" || (user.role === "instructor" && session.instructorId === user.id);
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

/* ---------- Draft coursework from the deck ---------- */

router.post("/sessions/:id/coursework/draft", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const sessionId = Number(req.params.id);
  const session = await loadSession(sessionId);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (!isStaffFor(user, session)) { res.status(403).json({ error: "Forbidden" }); return; }

  if (!drafterConfigured()) {
    res.status(503).json({ error: "No AI key is configured on the server. Add ANTHROPIC_API_KEY to use drafting." });
    return;
  }

  const [deck] = await db.select().from(sessionSlidesTable).where(eq(sessionSlidesTable.sessionId, sessionId));
  if (!deck) { res.status(404).json({ error: "Upload a slide deck for this module first" }); return; }

  const quality = slideTextQuality(deck.extractedText);
  if (!quality.usable) {
    res.status(400).json({
      error: quality.reason === "empty"
        ? "No text could be read from this deck. PDFs and image-only slides cannot be drafted from — upload the .pptx instead."
        : "There is too little text in this deck to draft from. Add speaker notes or upload a fuller version.",
    });
    return;
  }

  const result = await draftCoursework({
    programTitle: session.programTitle,
    sessionTitle: session.title,
    sessionDescription: session.description,
    slideText: deck.extractedText,
  });

  logger.info(
    { sessionId, questions: result.draft?.questions.length ?? 0, problems: result.problems.length },
    "Drafted coursework from slides",
  );

  res.json({
    questions: result.draft?.questions ?? [],
    assignment: result.draft?.assignment ?? null,
    problems: result.problems,
    notes: result.draft?.notes ?? [],
  });
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
