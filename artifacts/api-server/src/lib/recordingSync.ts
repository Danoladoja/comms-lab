import { db, sessionsTable, programsTable, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  sessionsDueForRecording,
  meetCodeFrom,
  videoDetailsFor,
  youtubeUrlFor,
  RECORDING_SEARCH_WINDOW_MS,
  statusAfterAttempt,
  type SessionRecordingState,
} from "@workspace/domain";
import { getAccessToken } from "./google/oauth";
import { findRecordings } from "./google/meetApi";
import { transferToYouTube } from "./google/transfer";
import { logger } from "./logger";

/**
 * The background job that gets last week's class onto YouTube by itself.
 *
 * Runs every few minutes, does at most one upload per pass, and records what
 * happened on the session so an admin can see where things stand without
 * reading logs.
 *
 * Deliberately unhurried. A class recording is not urgent — an hour late is
 * fine — and going slowly keeps the job well inside YouTube's daily upload
 * allowance and off the server's throat while learners are using it.
 */

const CHECK_EVERY_MS = 5 * 60 * 1000;

/** One at a time: these uploads are large and the server has other work. */
const MAX_UPLOADS_PER_PASS = 1;

type SessionRow = {
  id: number;
  title: string;
  startsAt: Date | null;
  durationMins: number;
  meetUrl: string | null;
  recordingUrl: string | null;
  recordingStatus: string;
  recordingAttempts: number;
  recordingCheckedAt: Date | null;
  programTitle: string;
  instructorName: string | null;
};

async function loadCandidates(): Promise<SessionRow[]> {
  return db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      meetUrl: sessionsTable.meetUrl,
      recordingUrl: sessionsTable.recordingUrl,
      recordingStatus: sessionsTable.recordingStatus,
      recordingAttempts: sessionsTable.recordingAttempts,
      recordingCheckedAt: sessionsTable.recordingCheckedAt,
      programTitle: programsTable.title,
      instructorName: usersTable.name,
    })
    .from(sessionsTable)
    .innerJoin(programsTable, eq(sessionsTable.programId, programsTable.id))
    .leftJoin(usersTable, eq(sessionsTable.instructorId, usersTable.id));
}

function toState(row: SessionRow): SessionRecordingState {
  return {
    sessionId: row.id,
    startsAtMs: row.startsAt?.getTime() ?? null,
    durationMins: row.durationMins,
    meetUrl: row.meetUrl,
    recordingUrl: row.recordingUrl,
    status: row.recordingStatus as SessionRecordingState["status"],
    attempts: row.recordingAttempts,
    lastCheckedAtMs: row.recordingCheckedAt?.getTime() ?? null,
  };
}

async function markAttempt(sessionId: number, status: string, error: string | null): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      recordingStatus: status,
      recordingError: error,
      recordingCheckedAt: new Date(),
      // Counted in the database rather than read, added to and written back.
      // Two passes overlapping used to lose an increment, so the give-up limit
      // never arrived and a permanently broken session was retried forever.
      recordingAttempts: sql`${sessionsTable.recordingAttempts} + 1`,
    })
    .where(eq(sessionsTable.id, sessionId));
}

/** Handle one session end to end. Returns true when a video was published. */
async function syncOne(accessToken: string, row: SessionRow): Promise<boolean> {
  const meetCode = meetCodeFrom(row.meetUrl);
  const startsAtMs = row.startsAt?.getTime();
  if (!meetCode || startsAtMs === undefined) return false;

  // Only conferences that began around this class count, so a room reused every
  // week never republishes an older session as this one's replay.
  const windowStartMs = startsAtMs - 60 * 60 * 1000;
  const windowEndMs = startsAtMs + row.durationMins * 60 * 1000 + 6 * 60 * 60 * 1000;

  try {
    const recordings = await findRecordings({ accessToken, meetCode, windowStartMs, windowEndMs });

    if (recordings.length === 0) {
      // Not an error yet — Meet may still be writing the file. But when this is
      // the attempt that exhausts the allowance, say so: the robot stops here,
      // and leaving it reading "Waiting for Meet" for another six days hid
      // every recording that never arrived.
      const status = statusAfterAttempt({
        attempts: row.recordingAttempts + 1,
        endsAtMs: startsAtMs + row.durationMins * 60 * 1000,
      });
      await markAttempt(
        row.id,
        status,
        status === "failed"
          ? "No recording appeared in Drive. Add the link by hand, or check the Meet recording was saved."
          : "No finished recording in Drive yet",
      );
      return false;
    }

    const recording = recordings[0];

    // Claim this session before uploading anything.
    //
    // The only guard used to be a boolean in this process's memory, which is
    // worth nothing on a platform that runs two copies of the app — and the
    // admin's "check now" button is a third. Two of them would find the same
    // Drive file and both upload it, putting the class on the channel twice
    // and spending half a day's YouTube allowance on the duplicate.
    //
    // The claim is the status change itself, applied only if nobody else has
    // already moved it. Whoever wins gets zero rows back and stops.
    const claimed = await db
      .update(sessionsTable)
      .set({
        recordingStatus: "uploading",
        recordingDriveFileId: recording.driveFileId,
        recordingCheckedAt: new Date(),
        recordingError: null,
      })
      .where(and(
        eq(sessionsTable.id, row.id),
        sql`${sessionsTable.recordingStatus} <> 'uploading'`,
      ))
      .returning({ id: sessionsTable.id });

    if (claimed.length === 0) {
      logger.info({ sessionId: row.id }, "Recording already being transferred elsewhere");
      return false;
    }

    const { title, description } = videoDetailsFor({
      programTitle: row.programTitle,
      sessionTitle: row.title,
      startsAtMs,
      instructorName: row.instructorName,
    });

    logger.info({ sessionId: row.id, title }, "Copying class recording to YouTube");

    const videoId = await transferToYouTube({
      accessToken,
      driveFileId: recording.driveFileId,
      title,
      description,
    });

    await db
      .update(sessionsTable)
      .set({
        recordingUrl: youtubeUrlFor(videoId),
        // A new video has its own length; the figure the cohort's replay
        // coverage is measured against must not carry over from the old one.
        recordingDurationSeconds: null,
        recordingStatus: "ready",
        recordingError: null,
        recordingCheckedAt: new Date(),
      })
      .where(eq(sessionsTable.id, row.id));

    logger.info({ sessionId: row.id, videoId }, "Class replay published");
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Declare defeat when the robot actually stops trying, not four days after
    // it has: a status still reading "searching" hid every failure from the
    // console's "needs attention" list.
    const attempts = row.recordingAttempts + 1;
    const endsAtMs = startsAtMs + row.durationMins * 60 * 1000;
    await markAttempt(row.id, statusAfterAttempt({ attempts, endsAtMs }), message);
    logger.warn({ sessionId: row.id, attempts, err }, "Could not sync class recording");
    return false;
  }
}

let running = false;

export async function runRecordingSync(): Promise<void> {
  if (running) return; // an upload can outlast the interval
  running = true;
  try {
    const accessToken = await getAccessToken().catch(() => null);
    if (!accessToken) return; // no Google account connected, or it was revoked

    const rows = await loadCandidates();
    const byId = new Map(rows.map((r) => [r.id, r]));
    const due = sessionsDueForRecording(rows.map(toState));

    let published = 0;
    for (const state of due) {
      if (published >= MAX_UPLOADS_PER_PASS) break;
      const row = byId.get(state.sessionId);
      if (!row) continue;
      if (await syncOne(accessToken, row)) published++;
    }
  } catch (err) {
    logger.error({ err }, "Recording sync pass failed");
  } finally {
    running = false;
  }
}

export function startRecordingSync(): void {
  setTimeout(() => void runRecordingSync(), 30_000).unref?.();
  setInterval(() => void runRecordingSync(), CHECK_EVERY_MS).unref?.();
  logger.info("Recording sync scheduled");
}
