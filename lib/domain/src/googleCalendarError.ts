/**
 * What Google actually said when it refused, and what to do about it.
 *
 * This file exists because of a mistake made twice.
 *
 * The first time, the OAuth exchange failed and the app said "Google refused
 * the exchange" while Google was saying `invalid_client` — a specific fault
 * with a specific remedy. Two days went into guessing before the real code was
 * put on screen, and it was solved in minutes once it was.
 *
 * The second time is this one. Creating a class meeting failed with a 403, and
 * the app turned every possible 403 into a single sentence: "the connected
 * account needs permission to manage its calendar — reconnect Google". That is
 * one of at least five reasons Google returns 403 here, and for the other four
 * reconnecting does nothing at all. An admin who has already reconnected is
 * then told to reconnect, which reads as the app being broken rather than as
 * the app not knowing.
 *
 * A 403 from the Calendar API means "no", not "no because of the thing you
 * happened to think of while writing the error handler". The remedies are
 * genuinely different — one is a switch in the Google Cloud console, one is a
 * Workspace policy, one really is the consent screen — and an admin cannot
 * guess which. So: read the reason, name it, and say the one thing that will
 * fix that one.
 *
 * Everything here is a pure function of the body Google returned, so it can be
 * tested against the shapes the API actually produces rather than hoped about.
 */

/** What kind of "no" this is. */
export type CalendarRefusal =
  /** The Calendar API is switched off for the Cloud project. */
  | "api-not-enabled"
  /** The token genuinely lacks the calendar permission. */
  | "scope-missing"
  /** The Workspace forbids this account creating meetings. */
  | "not-allowed-by-workspace"
  /** Too many requests, for now. */
  | "rate-limited"
  /** The connection has expired or been withdrawn. */
  | "signed-out"
  /** A 403 whose reason is not one we recognise. */
  | "refused"
  /** Anything that is not a refusal at all. */
  | "other";

type GoogleError = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: { reason?: string; message?: string; extendedHelp?: string }[];
    details?: { reason?: string; "@type"?: string }[];
  };
};

/**
 * Pull the reason out of whichever shape Google used.
 *
 * Google has two error formats in service at once — the old `error.errors[]`
 * with a `reason`, and the newer `error.status` plus `error.details[].reason` —
 * and the Calendar API returns either depending on which failure it is. Reading
 * only one of them is how a recognised fault comes back as "refused".
 */
function reasonsIn(body: string): string[] {
  let parsed: GoogleError;
  try {
    parsed = JSON.parse(body) as GoogleError;
  } catch {
    // Not JSON at all — an HTML error page from a proxy, most often. The raw
    // text is still worth scanning, because it usually names the fault.
    return [body.toLowerCase()];
  }

  const found: string[] = [];
  if (parsed.error?.status) found.push(parsed.error.status);
  for (const e of parsed.error?.errors ?? []) if (e.reason) found.push(e.reason);
  for (const d of parsed.error?.details ?? []) if (d.reason) found.push(d.reason);
  if (parsed.error?.message) found.push(parsed.error.message);
  return found.map((f) => f.toLowerCase());
}

export function classifyCalendarError(status: number, body: string): CalendarRefusal {
  if (status === 401) return "signed-out";
  // 429 means one thing and only one thing, whatever the body says — and the
  // body is often empty on a rate limit, so reading it would turn a known
  // failure into an unknown one.
  if (status === 429) return "rate-limited";
  if (status !== 403) return "other";

  const reasons = reasonsIn(body);
  const says = (...needles: string[]) => reasons.some((r) => needles.some((n) => r.includes(n)));

  // Order matters: a disabled API and a missing scope both mention permission,
  // and only one of them is fixed by reconnecting.
  if (says("accessnotconfigured", "service_disabled", "has not been used in project")) {
    return "api-not-enabled";
  }
  if (says("access_token_scope_insufficient", "insufficientpermissions", "insufficient authentication scopes")) {
    return "scope-missing";
  }
  if (says("ratelimitexceeded", "quotaexceeded", "userratelimitexceeded", "resource_exhausted")) {
    return "rate-limited";
  }
  if (says("forbiddenforservice", "notallowed", "cannot create conference", "conference type", "domainpolicy")) {
    return "not-allowed-by-workspace";
  }
  return "refused";
}

/**
 * The sentence an admin reads, and the one thing to do about it.
 *
 * Each names the place the fix happens, because "grant permission" is not an
 * instruction if you do not know which of three consoles to open.
 */
export function calendarRefusalMessage(kind: CalendarRefusal, googleSaid: string): string {
  const said = quoteGoogle(googleSaid);

  switch (kind) {
    case "api-not-enabled":
      return "Google Calendar is switched off for this project, so the Lab is not allowed to ask it "
        + "for anything. Turn it on in the Google Cloud console — APIs & Services, Enable APIs, search "
        + "for Google Calendar API, press Enable — then try again. Reconnecting will not help; the "
        + "permission is already granted."
        + said;

    case "scope-missing":
      return "This Google connection has not been given permission to create meetings. Press Reconnect "
        + "on the Recordings page and go through the consent screen — it will ask for one extra "
        + "permission this time."
        + said;

    case "not-allowed-by-workspace":
      return "Google allowed the request but your Workspace does not let this account create meetings. "
        + "A Workspace administrator has to allow Google Meet for it, in the Google Admin console. "
        + "Reconnecting will not change this."
        + said;

    case "rate-limited":
      return "Google is asking the Lab to slow down. Wait a minute and press the button again — nothing "
        + "is wrong with the connection."
        + said;

    case "signed-out":
      return "Google no longer accepts this connection. Press Reconnect on the Recordings page."
        + said;

    case "refused":
      return "Google refused to create the meeting and did not say why in a way the Lab recognises. "
        + "Its own words are below — they name the fault, and they are what to search for or send on."
        + said;

    case "other":
      return "Google could not create the meeting." + said;
  }
}

/**
 * Google's own words, kept.
 *
 * Trimmed, because these bodies run to several hundred characters of JSON, and
 * an error nobody can read gets screenshotted rather than acted on. But never
 * dropped: the whole point of this file is that the app's guess is worth less
 * than what Google actually said.
 */
export function quoteGoogle(googleSaid: string): string {
  const message = extractMessage(googleSaid);
  return message ? `\n\nGoogle said: ${message}` : "";
}

function extractMessage(body: string): string {
  const raw = (body ?? "").trim();
  if (!raw) return "";

  try {
    const parsed = JSON.parse(raw) as GoogleError;
    const message = parsed.error?.errors?.[0]?.message ?? parsed.error?.message ?? "";
    if (message) return trimTo(message, 300);
  } catch {
    // fall through to the raw text
  }
  return trimTo(raw.replace(/\s+/g, " "), 300);
}

function trimTo(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * The link Google offers to the exact page that fixes a disabled API.
 *
 * Returned separately so the browser can make it a link rather than printing a
 * URL in the middle of a paragraph. Only ever Google's own, never one this app
 * assembled — a guessed console URL with the wrong project number in it sends
 * an admin to somebody else's settings.
 */
export function calendarHelpLink(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as GoogleError;
    const help = parsed.error?.errors?.find((e) => e.extendedHelp)?.extendedHelp ?? "";
    return help.startsWith("https://console.") || help.startsWith("https://console.cloud.google.com")
      ? help
      : null;
  } catch {
    return null;
  }
}
