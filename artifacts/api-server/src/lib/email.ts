import { logger } from "./logger";

/**
 * Sending email through Brevo.
 *
 * This used to go through Replit's connector, which injected credentials for a
 * connected Brevo account. That runtime only exists inside Replit: anywhere
 * else every call failed while the app looked perfectly healthy, so reminders
 * and waitlist notices simply stopped arriving with nothing visible to say so.
 * Talking to Brevo directly works the same everywhere.
 *
 * Without `BREVO_API_KEY` the app runs normally and email is skipped loudly —
 * a warning per send rather than an exception, because a missing reminder must
 * never take an enrolment down with it.
 */

const API_BASE = "https://api.brevo.com/v3";
const TIMEOUT_MS = 15_000;

let cachedSender: { email: string; name: string } | null = null;

export function emailConfigured(): boolean {
  return !!process.env.BREVO_API_KEY;
}

async function brevo(path: string, init: RequestInit = {}): Promise<Response> {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new EmailRejectedError("BREVO_API_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "api-key": key,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Brevo will only send from a verified sender. The account's own address always
 * is, so it is the safe default; `BREVO_SENDER_EMAIL` overrides it once a
 * proper address has been verified in the Brevo dashboard.
 */
async function getSender(): Promise<{ email: string; name: string }> {
  if (cachedSender) return cachedSender;

  const name = process.env.BREVO_SENDER_NAME || "Ananse Comms Lab";
  const configured = process.env.BREVO_SENDER_EMAIL?.trim();
  if (configured) {
    cachedSender = { email: configured, name };
    return cachedSender;
  }

  const res = await brevo("/account");
  if (!res.ok) {
    throw new Error(`Brevo /account failed: ${res.status} ${await res.text()}`);
  }
  const account = (await res.json()) as { email: string };
  cachedSender = { email: account.email, name };
  return cachedSender;
}

/** Thrown when the provider definitively rejected the send (HTTP error). Any
 *  other failure (timeout, lost response) is ambiguous — the email may have
 *  gone out — and must NOT be retried automatically. */
export class EmailRejectedError extends Error {
  definiteFailure = true as const;
}

export async function sendEmail(opts: {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  /**
   * A plain-text version, for clients that strip HTML and for the spam scores
   * that count its absence against a message. Optional: most of what this app
   * sends is short enough that the HTML alone reads fine.
   */
  text?: string;
}): Promise<void> {
  if (!emailConfigured()) {
    logger.warn(
      { to: opts.to.email, subject: opts.subject },
      "No BREVO_API_KEY is set, so this email was not sent",
    );
    return;
  }

  const sender = await getSender();
  const res = await brevo("/smtp/email", {
    method: "POST",
    body: JSON.stringify({
      sender,
      to: [opts.to],
      subject: opts.subject,
      htmlContent: opts.html,
      ...(opts.text ? { textContent: opts.text } : {}),
    }),
  });

  if (!res.ok) {
    // A rejected key is worth naming: it is the difference between "Brevo
    // refused this message" and "nothing has been sent since the move".
    if (res.status === 401 || res.status === 403) {
      cachedSender = null;
      throw new EmailRejectedError(
        `Brevo rejected the API key (${res.status}). Check BREVO_API_KEY.`,
      );
    }
    throw new EmailRejectedError(`Brevo send failed: ${res.status} ${await res.text()}`);
  }

  logger.info({ to: opts.to.email, subject: opts.subject }, "Email sent");
}
