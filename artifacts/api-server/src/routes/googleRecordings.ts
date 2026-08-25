import { Router, type IRouter } from "express";
import { db, sessionsTable, programsTable } from "@workspace/db";
import { and, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
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
  GOOGLE_SCOPES,
} from "../lib/google/oauth";
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
  const basePath = process.env.BASE_PATH ?? "";

  const fail = (reason: string) => {
    logger.warn({ reason }, "Google OAuth callback rejected");
    res.redirect(`${basePath}/admin?google=error`);
  };

  if (!code || !state) return fail("missing code or state");

  sweepStates();
  const pending = pendingStates.get(state);
  if (!pending) return fail("unknown or expired state");
  pendingStates.delete(state);

  const env = googleEnv();
  if (!env) return fail("server not configured");

  try {
    const token = await exchangeCode(env, code);
    if (!token.refresh_token) {
      // Google only issues one on first consent; forcing prompt=consent should
      // prevent this, but say so plainly rather than storing a useless row.
      return fail("no refresh token returned — revoke the app in the Google account and try again");
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
    res.redirect(`${basePath}/admin?google=connected`);
  } catch (err) {
    logger.error({ err }, "Google OAuth exchange failed");
    fail("token exchange failed");
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

router.post("/admin/recordings/sync", requireRole("admin"), async (_req, res) => {
  // Fire and forget: an upload takes minutes and the admin should not wait.
  void runRecordingSync();
  res.status(202).json({ error: "Sync started" });
});

export default router;
