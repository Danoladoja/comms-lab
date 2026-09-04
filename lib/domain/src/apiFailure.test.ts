import { describe, expect, it } from "vitest";
import { apiReason } from "./apiFailure";

const FALLBACK = "Try again.";

/**
 * The shape the API client actually raises: an ApiError whose parsed response
 * body sits at .data. Reproduced here rather than imported, so that if the
 * client's shape ever changes these tests fail loudly instead of agreeing with
 * it and staying silent.
 */
function apiError(status: number, body: unknown) {
  return {
    name: "ApiError",
    status,
    statusText: "Bad Request",
    message: `HTTP ${status} Bad Request`,
    data: body,
  };
}

describe("apiReason", () => {
  it("finds the reason where this app's API actually puts it", () => {
    // The exact failure that started this: the server said why, and the console
    // showed "Could not send that invitation" and nothing else.
    const err = apiError(400, {
      error: "The invitation was withdrawn because the email could not be sent. The email provider is refusing requests from this server's address (13.51.2.9).",
    });
    expect(apiReason(err, FALLBACK)).toContain("refusing requests from this server's address");
    expect(apiReason(err, FALLBACK)).not.toBe(FALLBACK);
  });

  it("reads the other shapes a service might answer with", () => {
    expect(apiReason(apiError(400, { message: "Not allowed" }), FALLBACK)).toBe("Not allowed");
    expect(apiReason(apiError(400, { detail: "Too long" }), FALLBACK)).toBe("Too long");
    expect(apiReason(apiError(400, { title: "Bad input" }), FALLBACK)).toBe("Bad input");
  });

  it("prefers our own field when a body carries several", () => {
    const err = apiError(400, { error: "That address already has an account.", message: "Bad Request" });
    expect(apiReason(err, FALLBACK)).toBe("That address already has an account.");
  });

  it("takes a plain-text body", () => {
    expect(apiReason(apiError(502, "upstream timed out"), FALLBACK)).toBe("upstream timed out");
  });

  it("still works when the body itself is passed in rather than the error", () => {
    expect(apiReason({ error: "No places left." }, FALLBACK)).toBe("No places left.");
  });

  it("never shows a proxy's HTML error page", () => {
    const html = "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>...</body></html>";
    // Falls through to the status, which is a sentence rather than markup.
    expect(apiReason(apiError(502, html), FALLBACK)).toBe("The Lab had a problem at its end. Try again shortly.");
    expect(apiReason(apiError(502, html), FALLBACK)).not.toContain("<");
  });

  it("says the request never arrived, rather than 'Failed to fetch'", () => {
    const offline = { name: "TypeError", message: "Failed to fetch" };
    expect(apiReason(offline, FALLBACK)).toBe("Could not reach the Lab. Check your connection, then try again.");
  });

  it("explains a bodiless refusal from its status", () => {
    expect(apiReason(apiError(401, null), FALLBACK)).toMatch(/signed out/i);
    expect(apiReason(apiError(403, null), FALLBACK)).toMatch(/permission/i);
    expect(apiReason(apiError(404, null), FALLBACK)).toMatch(/no longer there/i);
    expect(apiReason(apiError(429, null), FALLBACK)).toMatch(/too many/i);
    expect(apiReason(apiError(503, null), FALLBACK)).toMatch(/problem at its end/i);
  });

  it("falls back rather than inventing an explanation", () => {
    expect(apiReason(apiError(418, null), FALLBACK)).toBe(FALLBACK);
    expect(apiReason(apiError(400, { error: "   " }), FALLBACK)).toBe(FALLBACK);
    expect(apiReason(null, FALLBACK)).toBe(FALLBACK);
    expect(apiReason(undefined, FALLBACK)).toBe(FALLBACK);
    expect(apiReason({}, FALLBACK)).toBe(FALLBACK);
  });

  it("trims a runaway message to something a toast can hold", () => {
    const long = "x".repeat(900);
    const shown = apiReason(apiError(400, { error: long }), FALLBACK);
    expect(shown.length).toBeLessThanOrEqual(300);
    expect(shown.endsWith("…")).toBe(true);
  });

  it("flattens the newlines a stack trace or wrapped body brings with it", () => {
    expect(apiReason(apiError(400, { error: "Line one.\n\n  Line two." }), FALLBACK))
      .toBe("Line one. Line two.");
  });
});
