import { db, sessionsTable, programsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  sessionsDueForRecording,
  meetCodeFrom,
  videoDetailsFor,
  youtubeUrlFor,
  RECORDING_SEARCH_WINDOW_MS,
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
      recordingAttempts: (await currentAttempts(sessionId)) + 1,
    })
    .where(eq(sessionsTable.id, sessionId));
}

async function currentAttempts(sessionId: number): Promise<number> {
  const [row] = await db
    .select({ attempts: sessionsTable.recordingAttempts })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  return row?.attempts ?? 0;
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
      // Not an error yet — Meet may still be writing the file.
      await markAttempt(row.id, "searching", "No finished recording in Drive yet");
      return false;
    }

    const recording = recordings[0];
    await db
      .update(sessionsTable)
      .set({
        recordingStatus: "uploading",
        recordingDriveFileId: recording.driveFileId,
        recordingCheckedAt: new Date(),
        recordingError: null,
      })
      .where(eq(sessionsTable.id, row.id));

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
        recordingStatus: "ready",
        recordingError: null,
        recordingCheckedAt: new Date(),
      })
      .where(eq(sessionsTable.id, row.id));

    logger.info({ sessionId: row.id, videoId }, "Class replay published");
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = await currentAttempts(row.id);
    // Only declare defeat once the search window has closed; until then a
    // failure is usually Meet not being ready.
    const endsAtMs = startsAtMs + row.durationMins * 60 * 1000;
    const giveUp = Date.now() > endsAtMs + RECORDING_SEARCH_WINDOW_MS;
    await markAttempt(row.id, giveUp ? "failed" : "searching", message);
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
