import { describe, expect, it } from "vitest";
import {
  classifyCalendarError,
  calendarRefusalMessage,
  calendarHelpLink,
  quoteGoogle,
} from "./googleCalendarError";

/* ------------------------------------------------------------------ *
 * The bodies below are the shapes the Calendar API actually returns.
 * They are the point of this file: a handler written against an imagined
 * error shape is a handler that reports "refused" for every real one.
 * ------------------------------------------------------------------ */

const API_DISABLED = JSON.stringify({
  error: {
    errors: [{
      domain: "usageLimits",
      reason: "accessNotConfigured",
      message: "Access Not Configured. Google Calendar API has not been used in project 482917 before "
        + "or it is disabled. Enable it by visiting the console then retry.",
      extendedHelp: "https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=482917",
    }],
    code: 403,
    message: "Access Not Configured. Google Calendar API has not been used in project 482917 before or it is disabled.",
  },
});

const SCOPE_MISSING = JSON.stringify({
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    status: "PERMISSION_DENIED",
    details: [{
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
    }],
  },
});

const WORKSPACE_SAYS_NO = JSON.stringify({
  error: {
    errors: [{ domain: "calendar", reason: "forbiddenForServiceAccounts", message: "Service accounts cannot invite attendees without Domain-Wide Delegation of Authority." }],
    code: 403,
    message: "Service accounts cannot invite attendees without Domain-Wide Delegation of Authority.",
  },
});

const RATE_LIMITED = JSON.stringify({
  error: {
    errors: [{ domain: "usageLimits", reason: "rateLimitExceeded", message: "Rate Limit Exceeded" }],
    code: 403,
    message: "Rate Limit Exceeded",
  },
});

describe("telling one 403 from another", () => {
  it("knows a switched-off Calendar API", () => {
    // The case this whole file was written for. The app used to call this a
    // missing permission and tell an admin to reconnect, which cannot fix it:
    // the permission was already granted, the API was simply off.
    expect(classifyCalendarError(403, API_DISABLED)).toBe("api-not-enabled");
  });

  it("knows a genuinely missing permission", () => {
    expect(classifyCalendarError(403, SCOPE_MISSING)).toBe("scope-missing");
  });

  it("reads the newer error shape as well as the older one", () => {
    // Google runs two error formats at once on this API. Reading only
    // `error.errors[]` misses every failure reported as `status` + `details[]`,
    // and vice versa — either way a known fault comes back unrecognised.
    expect(classifyCalendarError(403, SCOPE_MISSING)).not.toBe("refused");
    expect(classifyCalendarError(403, API_DISABLED)).not.toBe("refused");
  });

  it("knows a Workspace policy", () => {
    expect(classifyCalendarError(403, WORKSPACE_SAYS_NO)).toBe("not-allowed-by-workspace");
  });

  it("knows being asked to slow down", () => {
    expect(classifyCalendarError(403, RATE_LIMITED)).toBe("rate-limited");
    // A 429 carries no body worth reading, and often none at all. Classifying
    // it from the body would turn the one status code that means exactly one
    // thing into an unrecognised refusal.
    expect(classifyCalendarError(429, "")).toBe("rate-limited");
    expect(classifyCalendarError(429, "<html>Too Many Requests</html>")).toBe("rate-limited");
  });

  it("knows a withdrawn connection", () => {
    expect(classifyCalendarError(401, "{}")).toBe("signed-out");
  });

  it("admits when it does not recognise a reason", () => {
    // Better than picking the likeliest. The message for this case prints
    // Google's own words and says so, which is what actually gets solved.
    expect(classifyCalendarError(403, JSON.stringify({ error: { code: 403, message: "Nope" } })))
      .toBe("refused");
  });

  it("does not fall over on a body that is not JSON", () => {
    // A proxy or a load balancer returns HTML, and a parser that throws here
    // replaces a specific failure with a stack trace.
    expect(classifyCalendarError(403, "<html><body>403 Forbidden</body></html>")).toBe("refused");
    expect(classifyCalendarError(403, "")).toBe("refused");
  });

  it("leaves anything that is not a refusal alone", () => {
    expect(classifyCalendarError(500, "{}")).toBe("other");
    expect(classifyCalendarError(404, "{}")).toBe("other");
  });
});

describe("what the admin is told to do", () => {
  it("sends them to the Cloud console for a disabled API, and says not to reconnect", () => {
    const message = calendarRefusalMessage("api-not-enabled", API_DISABLED);
    expect(message).toMatch(/Google Cloud console/);
    expect(message).toMatch(/Enable/);
    // The sentence that matters most. An admin who has already reconnected
    // twice needs to be told that reconnecting is not the answer.
    expect(message).toMatch(/Reconnecting will not help/);
  });

  it("sends them to Reconnect only when reconnecting is actually the fix", () => {
    expect(calendarRefusalMessage("scope-missing", SCOPE_MISSING)).toMatch(/Press Reconnect/);
    expect(calendarRefusalMessage("api-not-enabled", API_DISABLED)).not.toMatch(/Press Reconnect/);
    expect(calendarRefusalMessage("not-allowed-by-workspace", WORKSPACE_SAYS_NO)).not.toMatch(/Press Reconnect/);
    expect(calendarRefusalMessage("rate-limited", RATE_LIMITED)).not.toMatch(/Press Reconnect/);
  });

  it("sends them to the Workspace admin console, not the Cloud one", () => {
    const message = calendarRefusalMessage("not-allowed-by-workspace", WORKSPACE_SAYS_NO);
    expect(message).toMatch(/Workspace administrator/);
    expect(message).toMatch(/Google Admin console/);
    expect(message).not.toMatch(/Google Cloud console/);
  });

  it("tells them to wait rather than to change anything, when it is a rate limit", () => {
    const message = calendarRefusalMessage("rate-limited", RATE_LIMITED);
    expect(message).toMatch(/Wait a minute/);
    expect(message).toMatch(/nothing is wrong with the connection/);
  });

  it("carries Google's own words in every case", () => {
    // The lesson from the OAuth failure, which took two days because the app
    // swallowed `invalid_client` and said "Google refused the exchange".
    for (const body of [API_DISABLED, SCOPE_MISSING, WORKSPACE_SAYS_NO, RATE_LIMITED]) {
      expect(calendarRefusalMessage(classifyCalendarError(403, body), body)).toMatch(/Google said:/);
    }
  });

  it("says plainly when it does not know, instead of guessing", () => {
    const body = JSON.stringify({ error: { code: 403, message: "Something new" } });
    const message = calendarRefusalMessage("refused", body);
    expect(message).toMatch(/did not say why in a way the Lab recognises/);
    expect(message).toMatch(/Google said: Something new/);
  });
});

describe("quoting Google without drowning the reader", () => {
  it("prefers the specific message to the outer one", () => {
    expect(quoteGoogle(API_DISABLED)).toMatch(/has not been used in project 482917/);
  });

  it("trims a very long body rather than printing all of it", () => {
    const long = JSON.stringify({ error: { message: "x".repeat(900) } });
    const quoted = quoteGoogle(long);
    expect(quoted.length).toBeLessThan(340);
    expect(quoted).toMatch(/…$/);
  });

  it("still shows something when the body is not JSON", () => {
    expect(quoteGoogle("403 Forbidden from the proxy")).toMatch(/403 Forbidden from the proxy/);
  });

  it("says nothing at all rather than an empty quotation", () => {
    expect(quoteGoogle("")).toBe("");
    expect(quoteGoogle("   ")).toBe("");
  });
});

describe("the link to the page that fixes it", () => {
  it("uses the one Google supplied, with the right project on it", () => {
    expect(calendarHelpLink(API_DISABLED))
      .toBe("https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=482917");
  });

  it("never invents one", () => {
    // A console URL assembled by this app would carry a guessed project number
    // and send an admin into somebody else's settings.
    expect(calendarHelpLink(SCOPE_MISSING)).toBeNull();
    expect(calendarHelpLink("not json")).toBeNull();
    expect(calendarHelpLink(JSON.stringify({
      error: { errors: [{ extendedHelp: "https://evil.example.com/phish" }] },
    }))).toBeNull();
  });
});
