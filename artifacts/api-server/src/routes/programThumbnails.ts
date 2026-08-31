import express, { Router, type IRouter } from "express";
import { db, programsTable, programThumbnailsTable, enrollmentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  MAX_THUMBNAIL_BYTES,
  checkThumbnail,
  isStoredThumbnail,
  thumbnailPath,
} from "@workspace/domain";
import { getCurrentUser, requireRole } from "../lib/auth";
import { logger } from "../lib/logger";

/**
 * Programme thumbnails.
 *
 * The picture is stored in the database and served back from here, which makes
 * this the one place the application hands bytes a person uploaded to anybody
 * who asks. Three things follow from that, and all three are deliberate:
 *
 * The media type comes from `checkThumbnail`, which reads the file's own
 * leading bytes. The uploader's Content-Type header is never trusted and never
 * stored — it is the only thing standing between an admin account and serving
 * a script from this origin.
 *
 * `X-Content-Type-Options: nosniff` goes out with every image, so a browser
 * cannot decide for itself that a file we called an image is really something
 * more interesting.
 *
 * And GET is public, because the catalogue shows thumbnails to visitors who
 * have not signed in. Nothing here reveals anything a published programme card
 * does not already show.
 */

const router: IRouter = Router();

const enrolledCountSql = sql<number>`(
  select count(*)::int from ${enrollmentsTable}
  where ${enrollmentsTable.programId} = ${programsTable.id}
    and ${enrollmentsTable.status} in ('enrolled', 'completed')
)`;

/** The programme as the rest of the API returns it, so callers can just re-render. */
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

async function programPayload(programId: number) {
  const [row] = await db.select(programColumns()).from(programsTable).where(eq(programsTable.id, programId));
  return row ?? null;
}

/* ---------- Serve ---------- */

router.get("/programs/:id/thumbnail", async (req, res) => {
  const programId = Number(req.params.id);
  if (!Number.isInteger(programId)) {
    res.status(404).json({ message: "No thumbnail for this programme" });
    return;
  }

  const [image] = await db
    .select()
    .from(programThumbnailsTable)
    .where(eq(programThumbnailsTable.programId, programId));

  if (!image) {
    res.status(404).json({ message: "No thumbnail for this programme" });
    return;
  }

  // The stored type was determined from the bytes, not from the uploader.
  res.setHeader("content-type", image.mimeType);
  res.setHeader("x-content-type-options", "nosniff");
  // The URL carries the row's updated time as ?v=, so a long cache is safe:
  // replacing the image changes the URL and the browser fetches the new one.
  res.setHeader("cache-control", "public, max-age=31536000, immutable");
  res.setHeader("content-length", String(image.sizeBytes));
  res.send(Buffer.from(image.data));
});

/* ---------- Upload ---------- */

/**
 * Raw bytes rather than a multipart form, matching how slide decks arrive: it
 * avoids a file-upload dependency, and base64 in JSON would inflate the image
 * by a third for no gain.
 */
router.post(
  "/programs/:id/thumbnail",
  requireRole("admin"),
  express.raw({ type: "*/*", limit: MAX_THUMBNAIL_BYTES }),
  async (req, res) => {
    const user = await getCurrentUser(req);
    const programId = Number(req.params.id);

    const [program] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
    if (!program) {
      res.status(404).json({ message: "Programme not found" });
      return;
    }

    const body = req.body;
    const bytes = Buffer.isBuffer(body) ? new Uint8Array(body) : new Uint8Array();

    const check = checkThumbnail(bytes);
    if (!check.ok) {
      res.status(400).json({ message: check.problem });
      return;
    }

    const filename = String(req.header("x-filename") ?? "thumbnail").slice(0, 200);
    const values = {
      programId,
      uploadedByUserId: user?.id ?? null,
      filename,
      mimeType: check.type.mimeType,
      sizeBytes: check.sizeBytes,
      data: Buffer.from(bytes),
    };

    const [saved] = await db
      .insert(programThumbnailsTable)
      .values(values)
      // Uploading again replaces the picture rather than accumulating copies.
      .onConflictDoUpdate({ target: programThumbnailsTable.programId, set: values })
      .returning();

    // Point the programme at the stored image. Doing this here rather than
    // asking the caller to send a second request means the two can never end up
    // disagreeing about whether a thumbnail exists.
    await db
      .update(programsTable)
      .set({ thumbnailUrl: thumbnailPath(programId, saved.updatedAt.toISOString()) })
      .where(eq(programsTable.id, programId));

    logger.info(
      { programId, mimeType: check.type.mimeType, sizeBytes: check.sizeBytes },
      "Programme thumbnail uploaded",
    );
    res.status(201).json(await programPayload(programId));
  },
);

/* ---------- Remove ---------- */

router.delete("/programs/:id/thumbnail", requireRole("admin"), async (req, res) => {
  const programId = Number(req.params.id);

  const [program] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (!program) {
    res.status(404).json({ message: "Programme not found" });
    return;
  }

  await db.delete(programThumbnailsTable).where(eq(programThumbnailsTable.programId, programId));

  // Only clear the link if it pointed at the image we just deleted. An admin
  // who pasted an external address and then pressed remove on a stored image
  // that never existed should not silently lose their link.
  if (isStoredThumbnail(program.thumbnailUrl)) {
    await db.update(programsTable).set({ thumbnailUrl: null }).where(eq(programsTable.id, programId));
  }

  logger.info({ programId }, "Programme thumbnail removed");
  res.json(await programPayload(programId));
});

export default router;
