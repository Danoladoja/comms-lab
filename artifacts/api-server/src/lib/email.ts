import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

// Emails are sent through the user's connected Brevo account. The connectors
// SDK injects auth on every call; never cache clients or tokens.
const connectors = new ReplitConnectors();

let cachedSender: { email: string; name: string } | null = null;

/** Brevo requires a verified sender; the account's own email always is. */
async function getSender(): Promise<{ email: string; name: string }> {
  if (cachedSender) return cachedSender;
  const res = await connectors.proxy("brevo", "/account", { method: "GET" });
  if (!res.ok) throw new Error(`Brevo /account failed: ${res.status} ${await res.text()}`);
  const account = (await res.json()) as { email: string };
  cachedSender = { email: account.email, name: "Afrienergy Comms Lab" };
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
}): Promise<void> {
  const sender = await getSender();
  const res = await connectors.proxy("brevo", "/smtp/email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender,
      to: [opts.to],
      subject: opts.subject,
      htmlContent: opts.html,
    }),
  });
  if (!res.ok) {
    throw new EmailRejectedError(`Brevo send failed: ${res.status} ${await res.text()}`);
  }
  logger.info({ to: opts.to.email, subject: opts.subject }, "Reminder email sent");
}
