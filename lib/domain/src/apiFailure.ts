/**
 * Getting the server's own explanation in front of the person who pressed the
 * button.
 *
 * This exists because of a second lost afternoon, which was the same afternoon
 * as the first one. An admin invited someone, the console said "Could not send
 * that invitation" and nothing else, and the actual reason had been written by
 * the server, put in the response body, sent over the wire, received by the
 * browser, and then thrown away one line before it would have been displayed.
 *
 * The cause was a shape mismatch nobody could see. The API client raises an
 * `ApiError` whose parsed body sits at `error.data`, so the server's
 * `{ error: "..." }` arrives at `error.data.error`. Eleven call sites read
 * `error.error`, which is always undefined — so every one of them fell through
 * to a bare title with no reason, in exactly the situations where the reason was
 * the only thing worth having.
 *
 * The lesson is not "remember the right path". It is that reading an error
 * shape is a rule with a right answer, and rules with right answers belong here,
 * tested, rather than being retyped from memory at each of eleven call sites.
 *
 * Two things this deliberately will not do. It will not show a raw HTML page: a
 * proxy that returns its own 502 sends markup, and a wall of tags reads as the
 * app breaking rather than as the one sentence that matters. And it will not
 * show an empty string dressed up as an explanation — where there is genuinely
 * nothing to say, the caller's own fallback is better than a shrug.
 */

/** Long enough for a real sentence, short enough for a toast. */
const MAX_REASON = 300;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function field(source: unknown, key: string): string {
  if (!source || typeof source !== "object") return "";
  return text((source as Record<string, unknown>)[key]);
}

/** A proxy's own error page, which is markup rather than a message. */
function looksLikeMarkup(value: string): boolean {
  const start = value.trimStart().slice(0, 20).toLowerCase();
  return start.startsWith("<!doctype") || start.startsWith("<html") || start.startsWith("<?xml");
}

function tidy(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean || looksLikeMarkup(clean)) return "";
  return clean.length > MAX_REASON ? `${clean.slice(0, MAX_REASON - 1)}…` : clean;
}

/**
 * The failures that never reached the server at all.
 *
 * `fetch` reports these as a TypeError with a message written for a developer.
 * "Failed to fetch" in a toast tells an admin nothing; that their connection
 * dropped, or the Lab is down, tells them whether to try again.
 */
function describeNetworkFailure(error: unknown): string {
  const message = field(error, "message");
  const name = field(error, "name");
  const offline =
    /failed to fetch|networkerror|network request failed|load failed/i.test(message) ||
    name === "TypeError";
  return offline
    ? "Could not reach the Lab. Check your connection, then try again."
    : "";
}

/**
 * What the server said went wrong, or the caller's fallback if it said nothing.
 *
 * Give it whatever the mutation handed you. It knows the shape the API client
 * actually raises, so no call site has to.
 */
export function apiReason(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return tidy(text(error)) || fallback;

  const body = (error as { data?: unknown }).data;

  // A body that is plain text rather than JSON: some proxies answer that way.
  const asText = tidy(text(body));

  const said =
    // Ours: every route in this app answers a failure with { error }.
    field(body, "error") ||
    // Shapes other services use, in the order they are worth trying.
    field(body, "message") ||
    field(body, "detail") ||
    field(body, "title") ||
    asText ||
    // A caller that passed the body straight in rather than the error.
    field(error, "error");

  if (said) return tidy(said) || fallback;

  // Nothing in the body. Before giving up, distinguish "the server refused" from
  // "the request never arrived", because those need different things from the
  // person reading it.
  const network = describeNetworkFailure(error);
  if (network) return network;

  const status = (error as { status?: unknown }).status;
  if (typeof status === "number") {
    if (status === 401) return "You are signed out. Sign in again, then try once more.";
    if (status === 403) return "You do not have permission to do that.";
    if (status === 404) return "That is no longer there. Refresh the page.";
    if (status === 429) return "Too many attempts in a row. Wait a moment, then try again.";
    if (status >= 500) return "The Lab had a problem at its end. Try again shortly.";
  }

  return fallback;
}
