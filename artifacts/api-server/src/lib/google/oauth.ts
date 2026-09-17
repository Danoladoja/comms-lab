import { db, googleConnectionTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sealToken, openToken } from "./secrets";
import { logger } from "../logger";

/**
 * The admin's Google account, and how to speak to Google as them.
 *
 * Written by hand rather than with the googleapis SDK: this needs three
 * endpoints and no request signing, and the SDK would add tens of megabytes to
 * a bundle that has to run on modest hosting.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * What the platform asks permission for, and why:
 *   meetings.space.readonly — find the recording belonging to a class
 *   drive.readonly          — read that recording out of Drive
 *   youtube.upload          — put it on the channel as unlisted
 *   userinfo.email          — show which account is connected
 * Nothing here can delete anything.
 */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/userinfo.email",
  /**
   * Who was in the room, and for how long.
   *
   * The Workspace audit trail, which requires an administrator of the domain
   * that hosts the classes. It is what lets attendance stop depending on a
   * learner having the Lab's own page open during the class — the assumption
   * that cost a cohort three weeks when the join link failed and everybody used
   * the calendar invite instead.
   *
   * Adding a scope does not extend a connection that already exists: Google
   * only grants it at the consent screen, so the admin has to reconnect once
   * after this ships. `meetReportsAuthorised` below is how the app tells the
   * difference between "not an admin" and "has not reconnected yet".
   */
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  /**
   * Making the class's meeting.
   *
   * `calendar.events` rather than the full `calendar` scope: it is enough to
   * create and move events, and it cannot touch calendar settings or sharing.
   * The narrower ask is also a shorter consent screen, which matters when the
   * person approving it has already been through this twice.
   *
   * As with the reports permission, Google only grants this at the consent
   * screen — so a connection made before this shipped has everything except
   * this, and will fail at the moment of use rather than at connection time.
   * `hasCalendarScope` below is how the app tells one from the other.
   */
  "https://www.googleapis.com/auth/calendar.events",
];

/** Has the stored connection actually been granted permission to make meetings? */
export function hasCalendarScope(grantedScopes: string | null | undefined): boolean {
  return (grantedScopes ?? "").includes("calendar.events");
}

/** Has the stored connection actually been granted the reports permission? */
export function hasReportsScope(grantedScopes: string | null | undefined): boolean {
  return (grantedScopes ?? "").includes("admin.reports.audit.readonly");
}

export type GoogleEnv = { clientId: string; clientSecret: string; redirectUri: string };

export function googleEnv(): GoogleEnv | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function authorizeUrl(env: GoogleEnv, state: string): string {
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: env.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // offline + consent is what makes Google hand back a refresh token; without
    // it the connection silently expires after an hour.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

/**
 * Google's own words about why it said no.
 *
 * Kept as a code rather than flattened into a sentence, because each of them
 * has a different remedy and the person who needs to know is an administrator
 * looking at a screen, not somebody reading server logs. `redirect_uri_mismatch`
 * and `invalid_client` look identical from the outside and are fixed in
 * completely different places.
 *
 * Neither field carries a secret: Google reports what was wrong with the
 * request, never what was in it.
 */
export class GoogleTokenError extends Error {
  constructor(readonly code: string, readonly description: string) {
    super(`Google rejected the token request: ${description || code}`);
    this.name = "GoogleTokenError";
  }
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const json = (await res.json()) as TokenResponse & { error?: string; error_description?: string };
  if (!res.ok) {
    throw new GoogleTokenError(json.error ?? String(res.status), json.error_description ?? "");
  }
  return json;
}

export async function exchangeCode(env: GoogleEnv, code: string): Promise<TokenResponse> {
  return postToken({
    code,
    client_id: env.clientId,
    client_secret: env.clientSecret,
    redirect_uri: env.redirectUri,
    grant_type: "authorization_code",
  });
}

export async function fetchGoogleEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Could not read the Google account email (${res.status})`);
  const json = (await res.json()) as { email?: string };
  return json.email ?? "";
}

export async function saveConnection(args: {
  refreshToken: string;
  googleEmail: string;
  scopes: string;
  connectedByUserId: number;
}): Promise<void> {
  const values = {
    singleton: "primary",
    connectedByUserId: args.connectedByUserId,
    googleEmail: args.googleEmail,
    refreshTokenEncrypted: sealToken(args.refreshToken),
    scopes: args.scopes,
    lastError: null,
    lastErrorAt: null,
  };
  await db
    .insert(googleConnectionTable)
    .values(values)
    .onConflictDoUpdate({ target: googleConnectionTable.singleton, set: values });
}

export async function getConnection() {
  const [row] = await db
    .select()
    .from(googleConnectionTable)
    .where(eq(googleConnectionTable.singleton, "primary"));
  return row ?? null;
}

export async function disconnect(): Promise<void> {
  await db.delete(googleConnectionTable).where(eq(googleConnectionTable.singleton, "primary"));
}

export async function noteConnectionError(message: string): Promise<void> {
  await db
    .update(googleConnectionTable)
    .set({ lastError: message.slice(0, 500), lastErrorAt: new Date() })
    .where(eq(googleConnectionTable.singleton, "primary"));
}

// Access tokens last an hour; hold one in memory rather than trading the
// refresh token on every single API call.
let cached: { token: string; expiresAtMs: number } | null = null;

/**
 * A usable access token, or null when no account is connected.
 *
 * Throws only when a connection exists but Google refuses it — that is worth
 * surfacing, because it means someone revoked access and recordings have
 * silently stopped.
 */
export async function getAccessToken(): Promise<string | null> {
  if (cached && cached.expiresAtMs > Date.now() + 60_000) return cached.token;

  const env = googleEnv();
  const connection = await getConnection();
  if (!env || !connection) return null;

  const refreshToken = openToken(connection.refreshTokenEncrypted);
  try {
    const token = await postToken({
      refresh_token: refreshToken,
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: "refresh_token",
    });
    cached = {
      token: token.access_token,
      expiresAtMs: Date.now() + token.expires_in * 1000,
    };
    return cached.token;
  } catch (err) {
    cached = null;
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "Google refresh token rejected — recordings will not sync until reconnected");
    await noteConnectionError(message);
    throw err;
  }
}

/** Forget the in-memory token, e.g. after disconnecting. */
export function clearTokenCache(): void {
  cached = null;
}
