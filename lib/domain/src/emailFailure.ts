/**
 * Turning a mail provider's refusal into something an admin can act on.
 *
 * This exists because of a real afternoon. Invitations stopped going out, the
 * console said only "the invitation email could not be sent", and the actual
 * reason — the provider refusing requests from the server's IP address, which
 * had changed when the service restarted — sat in a log nobody was looking at.
 * It took two rounds of guessing to find. The provider had said exactly what
 * was wrong, in plain words, and we threw them away.
 *
 * So the provider's own words are carried through to the person who pressed the
 * button. Two constraints on doing that safely:
 *
 * Nothing that could be a credential goes through. The message is built from
 * the response body, not the request, but a key pasted into the wrong field has
 * turned up in an error message before now, so anything shaped like one is
 * removed on the way past.
 *
 * And it only ever reaches an admin. A learner never sees this: the failures it
 * describes are ours to fix, not theirs to read.
 */

/** Long enough for a real explanation, short enough not to fill the screen. */
const MAX_DETAIL = 220;

/** Anything shaped like an API key, removed before the text goes anywhere. */
function withoutSecrets(text: string): string {
  return text
    .replace(/xkeysib-[A-Za-z0-9_-]+/gi, "(key)")
    .replace(/xsmtpsib-[A-Za-z0-9_-]+/gi, "(key)")
    .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "(token)");
}

function tidy(text: string): string {
  const clean = withoutSecrets(text).replace(/\s+/g, " ").trim();
  return clean.length > MAX_DETAIL ? `${clean.slice(0, MAX_DETAIL - 1)}…` : clean;
}

/** The provider's own sentence, dug out of whatever wrapper it arrived in. */
export function providerDetail(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";

  // Brevo answers with JSON; the useful sentence is its "message" field.
  const inJson = raw.match(/"message"\s*:\s*"([^"]+)"/);
  return tidy(inJson ? inJson[1] : raw);
}

/**
 * What to tell the admin.
 *
 * The three cases worth naming are the three that have actually happened here:
 * the address the server sends from is not on the provider's allowlist, the key
 * is wrong, and the sender address is not verified. Everything else is passed
 * through as the provider phrased it, which is more useful than a category we
 * guessed at.
 */
export function describeEmailFailure(error: unknown): string {
  const detail = providerDetail(error);
  if (!detail) return "The email provider gave no reason. Check the server log.";

  const ip = detail.match(/IP address ([0-9A-Fa-f:.]+)/);
  if (ip) {
    return `The email provider is refusing requests from this server's address (${ip[1]}). Add it to the provider's authorised addresses, or switch that restriction off: the address changes whenever the server restarts.`;
  }

  if (/\bkey\b/i.test(detail) || /unauthori[sz]ed/i.test(detail)) {
    return `The email provider rejected our credentials: ${detail}`;
  }

  if (/sender/i.test(detail)) {
    return `The email provider refused the sender address: ${detail}`;
  }

  if (/credit|quota|limit|plan/i.test(detail)) {
    return `The email provider refused to send: ${detail} This often means the sending allowance is used up.`;
  }

  return `The email provider said: ${detail}`;
}
