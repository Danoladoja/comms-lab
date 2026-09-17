import { Router, type IRouter } from "express";
import { db, sessionsTable, programsTable, sessionNotesTable } from "@workspace/db";
import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { appPath, meetCodeFrom, reportWindow, readHoldings } from "@workspace/domain";
import { requireRole, getCurrentUser } from "../lib/auth";
import {
  googleEnv,
  authorizeUrl,
  exchangeCode,
  fetchGoogleEmail,
  saveConnection,
  getConnection,
  disconnect,
  clearTokenCache,
  GoogleTokenError,
  getAccessToken,
  GOOGLE_SCOPES,
} from "../lib/google/oauth";
import { findHoldings } from "../lib/google/meetApi";
import { tokenSecretConfigured } from "../lib/google/secrets";
import { runRecordingSync } from "../lib/recordingSync";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Connecting the Google account, and seeing what the transfer job has done.
 *
 * The OAuth callback is deliberately outside the /admin guard — Google redirects
 * the browser there and cannot present an admin session — so it is protected by
 * a one-use state value generated when the flow starts instead.
 */

// State values live in memory: the flow completes in under a minute, and a
// restart mid-authorisation simply means starting again.
const pendingStates = new Map<string, { userId: number; createdAtMs: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;

function sweepStates(): void {
  const cutoff = Date.now() - STATE_TTL_MS;
  for (const [state, meta] of pendingStates) {
    if (meta.createdAtMs < cutoff) pendingStates.delete(state);
  }
}

async function statusPayload(userId?: number) {
  const env = googleEnv();
  const connection = await getConnection();
  const secretConfigured = tokenSecretConfigured();

  let url: string | null = null;
  if (env && secretConfigured && userId !== undefined) {
    sweepStates();
    const state = randomBytes(24).toString("base64url");
    pendingStates.set(state, { userId, createdAtMs: Date.now() });
    url = authorizeUrl(env, state);
  }

  return {
    connected: !!connection,
    configured: !!env,
    secretConfigured,
    googleEmail: connection?.googleEmail ?? null,
    // The address this server actually uses. Not a secret — it is the public
    // URL Google sends people back to — and it is the one value that has to
    // match Google Cloud character for character. Showing it turns "they must
    // match" into something an admin can check with their eyes.
    redirectUri: env?.redirectUri ?? null,
    connectedAt: connection?.createdAt?.toISOString() ?? null,
    lastError: connection?.lastError ?? null,
    authorizeUrl: url,
  };
}

router.get("/admin/google", requireRole("admin"), async (req, res) => {
  const user = await getCurrentUser(req);
  res.json(await statusPayload(user?.id));
});

router.delete("/admin/google", requireRole("admin"), async (_req, res) => {
  await disconnect();
  clearTokenCache();
  res.json(await statusPayload());
});

/**
 * Where Google sends the admin back to. No session is available here, so the
 * one-use state value is what proves this is the flow we started.
 */
router.get("/google/oauth/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  /**
   * Why it failed, carried back to the page.
   *
   * It used to redirect to a bare `?google=error` and log the reason where only
   * somebody with the server logs could read it. The person who needs it is
   * standing in front of the screen having just done twenty minutes of setup,
   * and every one of these has a different next step.
   */
  const fail = (reason: string, why: string) => {
    logger.warn({ reason, why }, "Google OAuth callback rejected");
    res.redirect(appPath(process.env.BASE_PATH, `/admin?google=error&why=${why}`));
  };

  if (!code || !state) return fail("missing code or state", "no-code");

  sweepStates();
  const pending = pendingStates.get(state);
  if (!pending) return fail("unknown or expired state", "expired");
  pendingStates.delete(state);

  const env = googleEnv();
  if (!env) return fail("server not configured", "not-configured");

  try {
    const token = await exchangeCode(env, code);
    if (!token.refresh_token) {
      // Google only issues one on first consent; forcing prompt=consent should
      // prevent this, but say so plainly rather than storing a useless row.
      return fail("no refresh token returned", "no-refresh-token");
    }
    const email = await fetchGoogleEmail(token.access_token);
    await saveConnection({
      refreshToken: token.refresh_token,
      googleEmail: email,
      scopes: token.scope ?? GOOGLE_SCOPES.join(" "),
      connectedByUserId: pending.userId,
    });
    clearTokenCache();
    logger.info({ email }, "Google account connected for recording transfers");
    res.redirect(appPath(process.env.BASE_PATH, "/admin?google=connected"));
  } catch (err) {
    logger.error({ err }, "Google OAuth exchange failed");
    // Google's own code, passed through. "redirect_uri_mismatch" and
    // "invalid_client" are indistinguishable from the outside and are fixed in
    // completely different places, so guessing between them wastes an
    // afternoon. Only the code travels — it is a fixed vocabulary, not text
    // from elsewhere being echoed into a page.
    const why = err instanceof GoogleTokenError
      ? err.code.replace(/[^a-z_]/gi, "").slice(0, 40)
      : "exchange-failed";
    fail("token exchange failed", why || "exchange-failed");
  }
});

/* ---------- Where each past class stands ---------- */

router.get("/admin/recordings", requireRole("admin"), async (_req, res) => {
  const rows = await db
    .select({
      sessionId: sessionsTable.id,
      sessionTitle: sessionsTable.title,
      programTitle: programsTable.title,
      startsAt: sessionsTable.startsAt,
      status: sessionsTable.recordingStatus,
      attempts: sessionsTable.recordingAttempts,
      meetUrl: sessionsTable.meetUrl,
      recordingUrl: sessionsTable.recordingUrl,
      error: sessionsTable.recordingError,
      checkedAt: sessionsTable.recordingCheckedAt,
    })
    .from(sessionsTable)
    .innerJoin(programsTable, eq(sessionsTable.programId, programsTable.id))
    .where(and(isNotNull(sessionsTable.startsAt), lt(sessionsTable.startsAt, sql`now()`)))
    .orderBy(desc(sessionsTable.startsAt))
    .limit(100);

  res.json(
    rows.map((r) => ({
      sessionId: r.sessionId,
      sessionTitle: r.sessionTitle,
      programTitle: r.programTitle,
      startsAt: r.startsAt?.toISOString() ?? null,
      status: r.status,
      attempts: r.attempts,
      hasMeetUrl: !!r.meetUrl,
      recordingUrl: r.recordingUrl,
      error: r.error,
      checkedAt: r.checkedAt?.toISOString() ?? null,
    })),
  );
});

/**
 * What Google actually holds for one class.
 *
 * Built before any of the automation it is meant to inform, deliberately. A
 * Meet transcript exists only if somebody started one, or if an administrator
 * turned on automatic transcription for the domain — and neither is visible
 * from inside the Lab. Writing the transcript fetch first would mean writing it
 * against a folder that may be empty, where "it found nothing" and "it is
 * broken" look identical. That confusion is what cost this cohort three weeks
 * of attendance, and it is not worth repeating with transcripts.
 *
 * Every call this makes is a GET. It cannot change anything in Google or here.
 */
router.get("/admin/sessions/:id/google-holdings", requireRole("admin"), async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) { res.status(400).json({ error: "That is not a module." }); return; }

  const [session] = await db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      meetUrl: sessionsTable.meetUrl,
      recordingUrl: sessionsTable.recordingUrl,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "That module no longer exists." }); return; }
  if (!session.startsAt) {
    res.status(400).json({ error: `"${session.title}" has no date, so there was no class to ask about.` });
    return;
  }

  const meetCode = meetCodeFrom(session.meetUrl);
  if (!meetCode) {
    res.status(400).json({
      error: `"${session.title}" has no Google Meet link saved, so there is no room to ask about. `
        + "Add the meeting link to the module first.",
    });
    return;
  }

  const connection = await getConnection();
  if (!connection) { res.status(403).json({ error: "Google is not connected." }); return; }
  const accessToken = await getAccessToken();
  if (!accessToken) {
    res.status(403).json({ error: "Could not refresh the Google connection. Reconnect it above." });
    return;
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
    // The Meet API's own words are a status code and a blob. Worth logging in
    // full and worth not showing.
    logger.error({ err, sessionId }, "Could not read what Google holds for a class");
    res.status(403).json({
      error: "Google refused the question. The connected account must be able to see the meetings this room "
        + "hosted — usually it is the organiser's account, or an administrator's.",
    });
    return;
  }

  const [notes] = await db
    .select({ body: sessionNotesTable.body })
    .from(sessionNotesTable)
    .where(eq(sessionNotesTable.sessionId, sessionId));

  const ready = holdings.transcripts.filter((t) => t.state === "FILE_GENERATED" && t.documentId);
  const verdict = readHoldings({
    conferences: holdings.conferences,
    recordings: holdings.recordings.length,
    transcriptsReady: ready.length,
    transcriptsUnfinished: holdings.transcripts.length - ready.length,
    hasRecordingLink: !!session.recordingUrl,
    hasPastedMaterial: (notes?.body ?? "").trim().length > 0,
  });

  res.json({
    sessionId,
    conferences: holdings.conferences,
    recordings: holdings.recordings.length,
    transcriptsReady: ready.length,
    transcriptsUnfinished: holdings.transcripts.length - ready.length,
    transcriptUrl: ready[0]?.exportUri ?? null,
    ...verdict,
  });
});

router.post("/admin/recordings/sync", requireRole("admin"), async (_req, res) => {
  // Fire and forget: an upload takes minutes and the admin should not wait.
  void runRecordingSync();
  res.status(202).json({ error: "Sync started" });
});

export default router;
