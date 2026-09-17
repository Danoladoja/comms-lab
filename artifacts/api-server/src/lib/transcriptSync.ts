/**
 * Filling a class's material box from the transcript Google already has.
 *
 * The state of things before this: three of the cohort's classes were checked
 * and two had finished transcripts sitting in Google that nobody had fetched,
 * while a facilitator's instructions still read "open the recording on YouTube,
 * click the three dots, choose Show transcript, copy and paste". The third
 * class had no transcript at all, because somebody forgot to press a button.
 *
 * So the gap was never a capability. It was a habit, held by a person, at the
 * end of a teaching day. This moves the habit into the machine.
 *
 * Two things it will not do, both guarded in the domain:
 *   - overwrite material a person put there, whatever the relative age or
 *     length, because a facilitator's cleaned-up transcript is work
 *   - save a fragment, because an empty box is honest about having nothing and
 *     a forty-word box gets drafted from
 */
import { db, sessionsTable, sessionNotesTable } from "@workspace/db";
import {
  meetCodeFrom,
  reportWindow,
  decideImport,
  GOOGLE_TRANSCRIPT_LABEL,
} from "@workspace/domain";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { getAccessToken, getConnection } from "./google/oauth";
import { findHoldings } from "./google/meetApi";
import { exportTranscriptText } from "./google/transfer";
import { logger } from "./logger";

export type TranscriptOutcome = {
  sessionId: number;
  title: string;
  saved: boolean;
  /** What happened, in a sentence somebody can act on. */
  note: string;
};

export async function importTranscriptForSession(
  sessionId: number,
): Promise<TranscriptOutcome | { error: string }> {
  const [session] = await db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      meetUrl: sessionsTable.meetUrl,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));

  if (!session) return { error: `No module with id ${sessionId}.` };
  if (!session.startsAt) return { error: `"${session.title}" has no date, so there was no class.` };

  const meetCode = meetCodeFrom(session.meetUrl);
  if (!meetCode) {
    return {
      error: `"${session.title}" has no Google Meet link saved, so there is no room to ask about. `
        + "Add the meeting link to the module first.",
    };
  }

  const connection = await getConnection();
  if (!connection) return { error: "Google is not connected. Connect it in the admin console." };
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return { error: "Could not refresh the Google connection. Reconnect it in the admin console." };
  }

  // Checked before the fetch, not after. Asking Google for a document and then
  // throwing it away because the box was full is a slow way to do nothing.
  const [notes] = await db
    .select({ body: sessionNotesTable.body })
    .from(sessionNotesTable)
    .where(eq(sessionNotesTable.sessionId, sessionId));
  const existing = (notes?.body ?? "").trim();
  if (existing.length > 0) {
    return {
      sessionId,
      title: session.title,
      saved: false,
      note: "This class already has material, so it was left alone.",
    };
  }

  const window = reportWindow(session.startsAt.getTime(), session.durationMins);

  let holdings;
  try {
    holdings = await findHoldings({
      accessToken,
      meetCode,
      windowStartMs: window.startMs,
      windowEndMs: window.endMs,
    });
  } catch (err) {
    logger.error({ err, sessionId }, "Could not ask Google what it holds for a class");
    return { error: "Google refused the question. Check the connection in the admin console." };
  }

  const ready = holdings.transcripts.find((t) => t.state === "FILE_GENERATED" && t.documentId);
  if (!ready?.documentId) {
    return {
      sessionId,
      title: session.title,
      saved: false,
      note: holdings.conferences === 0
        ? "Google has no record of this room being used around the class. Check the meeting link on the module."
        : "Google has no finished transcript for this class. Nobody started one, or it is still being written.",
    };
  }

  let raw: string;
  try {
    raw = await exportTranscriptText(accessToken, ready.documentId);
  } catch (err) {
    logger.error({ err, sessionId }, "Could not export a transcript document");
    return { error: "The transcript could not be read out of Drive. Try again shortly." };
  }

  const decision = decideImport({ raw, existing });
  if (!decision.save) {
    return { sessionId, title: session.title, saved: false, note: decision.note };
  }

  // Written under the unique index on session, and only into a row that is
  // empty — a facilitator pasting theirs in the seconds between the check above
  // and this write must still win.
  await db
    .insert(sessionNotesTable)
    .values({ sessionId, label: GOOGLE_TRANSCRIPT_LABEL, body: decision.text })
    .onConflictDoUpdate({
      target: sessionNotesTable.sessionId,
      set: { label: GOOGLE_TRANSCRIPT_LABEL, body: decision.text },
      where: sql`coalesce(btrim(${sessionNotesTable.body}), '') = ''`,
    });

  logger.info({ sessionId, chars: decision.text.length }, "Transcript imported from Google Meet");
  return { sessionId, title: session.title, saved: true, note: decision.note };
}

/* ------------------------------------------------------------------ *
 * Running it without being asked
 * ------------------------------------------------------------------ */

const CHECK_EVERY_MS = 30 * 60 * 1000;

/**
 * Classes that have finished, have a room, and still have no material.
 *
 * An hour after the scheduled end, for the same reason attendance waits: Google
 * writes the transcript document when the meeting is over, not while it runs,
 * and asking early gets nothing and then never asks again.
 */
async function classesNeedingTranscript(): Promise<number[]> {
  const rows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .leftJoin(sessionNotesTable, eq(sessionNotesTable.sessionId, sessionsTable.id))
    .where(and(
      isNotNull(sessionsTable.startsAt),
      isNotNull(sessionsTable.meetUrl),
      sql`${sessionsTable.startsAt} + make_interval(mins => ${sessionsTable.durationMins}) < now() - interval '1 hour'`,
      // Google keeps these for a while, but re-asking about a term's worth of
      // settled classes every half hour is a lot of requests to learn nothing.
      sql`${sessionsTable.startsAt} > now() - interval '30 days'`,
      // Nothing in the box. A class somebody has already written up is not
      // waiting for anything.
      sql`coalesce(btrim(${sessionNotesTable.body}), '') = ''`,
    ))
    .orderBy(asc(sessionsTable.startsAt));
  return rows.map((r) => r.id);
}

let running = false;

export async function runTranscriptSync(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const connection = await getConnection();
    // Quiet when there is nothing to work with. This runs forever, and a log
    // line every half hour about a feature nobody switched on is how real
    // warnings come to be ignored.
    if (!connection) return;

    for (const id of await classesNeedingTranscript()) {
      const result = await importTranscriptForSession(id);
      if ("error" in result) {
        logger.warn({ sessionId: id, error: result.error }, "Transcript import skipped a class");
        // A refused connection will refuse the next one too. Stopping keeps one
        // misconfiguration from becoming forty identical log lines.
        if (result.error.includes("Reconnect") || result.error.includes("refused")) return;
      }
    }
  } catch (err) {
    logger.error({ err }, "Transcript sync pass failed");
  } finally {
    running = false;
  }
}

export function startTranscriptSync(): void {
  setTimeout(() => void runTranscriptSync(), 90_000).unref?.();
  setInterval(() => void runTranscriptSync(), CHECK_EVERY_MS).unref?.();
  logger.info("Transcript sync scheduled");
}
