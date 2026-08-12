/**
 * Certificate codes.
 *
 * The old format was `AECL-{programId}-{userId}` — sequential and enumerable.
 * Anyone could walk `AECL-001-0001` upward and harvest every graduate's name,
 * and read off the cohort sizes while they were at it. Codes are now random and
 * stored on the enrollment row; verification looks them up rather than parsing
 * ids out of them.
 */

// Crockford base32 minus I, L, O, U — no character pairs that get misread aloud
// or mistyped from a printed certificate.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GROUPS = 3;
const GROUP_LENGTH = 4;

export const CERTIFICATE_CODE_PATTERN = /^AECL-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/;

// This package is shared between the API and the browser and compiles without
// DOM or Node lib types, so the one global it needs is declared here.
// `crypto.getRandomValues` is available in Node 19+ and every browser we target.
declare const crypto: { getRandomValues<T extends Uint8Array>(array: T): T };

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** e.g. "AECL-7F3K-9QM2-XR41" — ~60 bits of entropy, safe to print and read out. */
export function generateCertificateCode(): string {
  const bytes = randomBytes(GROUPS * GROUP_LENGTH);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  const groups: string[] = [];
  for (let i = 0; i < GROUPS; i++) {
    groups.push(chars.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH).join(""));
  }
  return `AECL-${groups.join("-")}`;
}

/** Normalise user input from the verify box: trim, upper-case, tolerate missing dashes. */
export function normaliseCertificateCode(input: string): string | null {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, "");
  const withDashes = /^AECL-/.test(cleaned)
    ? cleaned
    : `AECL-${cleaned.replace(/^AECL/, "")}`;
  const compact = withDashes.replace(/-/g, "").replace(/^AECL/, "");
  if (compact.length !== GROUPS * GROUP_LENGTH) return null;
  const regrouped: string[] = [];
  for (let i = 0; i < GROUPS; i++) {
    regrouped.push(compact.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH));
  }
  const candidate = `AECL-${regrouped.join("-")}`;
  return CERTIFICATE_CODE_PATTERN.test(candidate) ? candidate : null;
}
