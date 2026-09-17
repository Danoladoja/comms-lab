import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What Google said when it refused.
 *
 * A failed connection used to arrive on the admin page as one sentence that
 * guessed at the cause. The four real causes below produce the identical red
 * screen at the identical moment and are repaired in four different places —
 * Railway, Google Cloud credentials, the consent flow, the client type — so a
 * guess sends somebody to the wrong one. These tests hold the code Google
 * returned to the code the page is told about.
 */

vi.mock("@workspace/db", () => ({
  db: {},
  googleConnectionTable: {},
}));
vi.mock("./secrets", () => ({ sealToken: (s: string) => s, openToken: (s: string) => s }));
vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { exchangeCode, GoogleTokenError, hasReportsScope } from "./oauth";

const ENV = {
  clientId: "client-id.apps.googleusercontent.test",
  clientSecret: "not-a-real-secret",
  redirectUri: "https://example.test/api/google/oauth/callback",
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => { fetchSpy = vi.fn(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("exchanging the sign-in code", () => {
  it("carries Google's own error code, not a status number", async () => {
    // The whole point. "400" is true and useless; "redirect_uri_mismatch" names
    // the one field to change and the one place to change it.
    // A fresh Response per call: a body can only be read once, and reusing one
    // would fail the second assertion for a reason unrelated to what it checks.
    fetchSpy.mockImplementation(async () =>
      reply({ error: "redirect_uri_mismatch", error_description: "Bad Request" }, 400));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(exchangeCode(ENV, "code")).rejects.toBeInstanceOf(GoogleTokenError);
    await expect(exchangeCode(ENV, "code")).rejects.toMatchObject({
      code: "redirect_uri_mismatch",
      description: "Bad Request",
    });
  });

  it("falls back to the status when Google names no error", async () => {
    // Some failures come back as an empty body. Something must still travel, or
    // the page shows its generic sentence with nothing to quote.
    fetchSpy.mockResolvedValue(reply({}, 500));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(exchangeCode(ENV, "code")).rejects.toMatchObject({ code: "500" });
  });

  it("sends the redirect address it was given", async () => {
    // The value that has to match Google Cloud character for character.
    fetchSpy.mockResolvedValue(reply({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchSpy);

    await exchangeCode(ENV, "the-code");
    const body = new URLSearchParams(String(fetchSpy.mock.calls[0][1].body));
    expect(body.get("redirect_uri")).toBe(ENV.redirectUri);
    expect(body.get("code")).toBe("the-code");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("returns the token when Google agrees", async () => {
    fetchSpy.mockResolvedValue(reply({ access_token: "a", refresh_token: "r", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(exchangeCode(ENV, "code")).resolves.toMatchObject({ refresh_token: "r" });
  });
});

describe("the reports permission", () => {
  it("tells a connection made before attendance existed from one made after", async () => {
    // A connection granted before this feature shipped has every other scope and
    // will fail only at the moment attendance is read, which is hours later and
    // out of sight.
    expect(hasReportsScope("https://www.googleapis.com/auth/admin.reports.audit.readonly")).toBe(true);
    expect(hasReportsScope("https://www.googleapis.com/auth/drive.readonly")).toBe(false);
    expect(hasReportsScope(null)).toBe(false);
    expect(hasReportsScope(undefined)).toBe(false);
  });
});
