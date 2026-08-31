/**
 * Joining the waitlist.
 *
 * This replaces open sign-up. Anybody could previously create an account and
 * land in the Lab attached to no programme at all, which left the People list
 * full of strangers and gave the Lab no way to tell an applicant from a
 * facilitator. Now the public route in is a waitlist: a name, an address, and
 * which programme they are hoping for. Accounts are created only by invitation.
 *
 * That makes this form the one thing on the site the whole internet can write
 * to, so the rules that decide what is worth keeping live here, testable
 * without a network and without a database.
 *
 * Every refusal is a sentence a person can act on. Somebody who has waited for
 * a cohort for three months should never meet the word "invalid".
 */

export const MAX_WAITLIST_NAME = 120;
export const MAX_WAITLIST_EMAIL = 320;
export const MAX_WAITLIST_NOTE = 1000;

/** What they are waiting for: a numbered programme, or whatever comes next. */
export const ANY_PROGRAMME = "any";

export type WaitlistSignup = {
  name: string;
  email: string;
  /** The programme they want, or null for "any future cohort". */
  programId: number | null;
  note: string;
};

export type WaitlistValidation =
  | { ok: true; signup: WaitlistSignup }
  | { ok: false; problem: string };

/** Strip the control characters a paste can carry, by codepoint. */
export function stripControl(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) out += ch;
  }
  return out;
}

function tidy(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  return stripControl(input).replace(/\s+/g, " ").trim().slice(0, max);
}

export function normaliseWaitlistEmail(input: unknown): string {
  return typeof input === "string" ? input.trim().toLowerCase().slice(0, MAX_WAITLIST_EMAIL) : "";
}

/**
 * Good enough to send to, and nothing stricter.
 *
 * A pattern that tries to encode the email standard rejects real addresses,
 * and the people it rejects are disproportionately those with newer domains.
 * The only real test is whether the invitation arrives.
 */
export function isPlausibleWaitlistEmail(email: string): boolean {
  if (email.length < 6 || email.length > MAX_WAITLIST_EMAIL) return false;
  if (/\s/.test(email)) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || !domain) return false;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return !domain.includes("..");
}

/**
 * Read what somebody typed into the form.
 *
 * `programme` is the raw value of the picker: a number as text, or "any".
 * `trap` is a field kept out of sight; a person leaves it empty and a crude
 * script fills it in.
 */
export function validateWaitlistSignup(input: {
  name?: unknown;
  email?: unknown;
  programme?: unknown;
  note?: unknown;
  trap?: unknown;
}): WaitlistValidation {
  if (typeof input.trap === "string" && input.trap.trim() !== "") {
    // Refused without saying why: telling a script what gave it away is the
    // one piece of feedback worth withholding.
    return { ok: false, problem: "That could not be sent. Please email us instead." };
  }

  const name = tidy(input.name, MAX_WAITLIST_NAME);
  if (name.length < 2) {
    return { ok: false, problem: "Please give the name you would like us to use." };
  }

  const email = normaliseWaitlistEmail(input.email);
  if (!isPlausibleWaitlistEmail(email)) {
    return { ok: false, problem: "That email address does not look right. Check it and try again." };
  }

  const raw = typeof input.programme === "string" ? input.programme.trim() : String(input.programme ?? "");
  let programId: number | null = null;
  if (raw && raw !== ANY_PROGRAMME) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, problem: "Choose a programme, or “any future cohort”." };
    }
    programId = n;
  }

  return { ok: true, signup: { name, email, programId, note: tidy(input.note, MAX_WAITLIST_NOTE) } };
}

/** What the person is told once they are on the list. */
export function waitlistConfirmation(programmeTitle: string | null): string {
  return programmeTitle
    ? `You are on the waitlist for ${programmeTitle}. We will email you when places open.`
    : "You are on the waitlist. We will email you when the next cohort opens.";
}

/**
 * Somebody already on the list who signs up again is told the same thing.
 *
 * Saying "you are already on the list" would confirm to anybody typing
 * addresses into the form which ones the Lab holds. It costs nothing to be
 * quiet about it, and the second entry simply updates the first.
 */
export const WAITLIST_ALREADY_ON = "already-on-list";

export type WaitlistStatus = "waiting" | "invited" | "declined";

export const WAITLIST_STATUSES: readonly WaitlistStatus[] = ["waiting", "invited", "declined"];

export function isWaitlistStatus(value: unknown): value is WaitlistStatus {
  return typeof value === "string" && (WAITLIST_STATUSES as readonly string[]).includes(value);
}

export function waitlistStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "invited":
      return "Invited";
    case "declined":
      return "Not this time";
    default:
      return "Waiting";
  }
}

/** The line an admin reads above the list. */
export function describeWaitlist(counts: { waiting: number; invited: number; declined: number }): string {
  const parts: string[] = [`${counts.waiting} waiting`];
  if (counts.invited > 0) parts.push(`${counts.invited} already invited`);
  if (counts.declined > 0) parts.push(`${counts.declined} set aside`);
  return `${parts.join(", ")}.`;
}
