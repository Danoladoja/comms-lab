import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for the stored Google refresh token.
 *
 * That token is a long-lived key to the admin's Drive and YouTube channel. A
 * database dump should not hand it over in readable form, so it is sealed with
 * AES-256-GCM before it is written and only opened in memory when a job needs
 * to call Google.
 *
 * The key comes from GOOGLE_TOKEN_SECRET. Change that value and every stored
 * token becomes unreadable — the admin simply reconnects their account.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function key(): Buffer {
  const secret = process.env.GOOGLE_TOKEN_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "GOOGLE_TOKEN_SECRET is missing or too short. Set it to a random string of at least 16 characters before connecting a Google account.",
    );
  }
  // A hash gives a fixed 32-byte key from a human-typed secret of any length.
  return createHash("sha256").update(secret).digest();
}

export function sealToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), sealed.toString("base64")].join(".");
}

export function openToken(sealed: string): string {
  const [ivB64, tagB64, dataB64] = sealed.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Stored Google token is malformed — reconnect the Google account.");
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** True when the server is configured well enough to hold a Google connection. */
export function tokenSecretConfigured(): boolean {
  const secret = process.env.GOOGLE_TOKEN_SECRET;
  return !!secret && secret.length >= 16;
}
