import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The partnership form, exercised over real HTTP.
 *
 * Reading this route is not enough to trust it. The parts most likely to be
 * wrong — that a bot is thanked rather than corrected, that a failed send is
 * never reported as success, that the budget is spent per address and only on
 * submissions that were actually worth sending — are all about what comes back
 * on the wire, so that is what these assert.
 */

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  emailConfigured: vi.fn(() => true),
}));

class FakeRejected extends Error {
  definiteFailure = true as const;
}

vi.mock("../lib/email", () => ({
  sendEmail: mocks.sendEmail,
  emailConfigured: mocks.emailConfigured,
  EmailRejectedError: FakeRejected,
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const GOOD = {
  name: "Amina Bello",
  organisation: "West Africa Energy Desk",
  email: "amina@example.org",
  interest: "teach",
  message: "I would like to run a session on covering gas flaring for reporters.",
};

let baseUrl = "";
let server: ReturnType<express.Express["listen"]>;

/** Each test gets a fresh module registry, so the in-memory budget resets. */
async function start(clientIp = "203.0.113.7") {
  vi.resetModules();
  const { default: router } = await import("./partnerships");

  const app = express();
  app.use(express.json());
  // Stand in for the proxy header Railway sets, so a test can pretend to be a
  // different caller and prove the budget is per address rather than global.
  app.use((req, _res, next) => {
    Object.defineProperty(req, "ip", { value: (req.headers["x-test-ip"] as string) || clientIp });
    next();
  });
  app.use("/api", router);

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(body: unknown, ip?: string) {
  return fetch(`${baseUrl}/api/partnership-enquiries`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(ip ? { "x-test-ip": ip } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  mocks.sendEmail.mockReset().mockResolvedValue(undefined);
  mocks.emailConfigured.mockReset().mockReturnValue(true);
  await start();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("POST /partnership-enquiries", () => {
  it("accepts a good enquiry and sends exactly one email", async () => {
    const res = await post(GOOD);
    expect(res.status).toBe(202);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);

    const sent = mocks.sendEmail.mock.calls[0][0];
    expect(sent.subject).toContain("West Africa Energy Desk");
    expect(sent.html).toContain("amina@example.org");
  });

  it("returns one sentence per bad field and sends nothing", async () => {
    const res = await post({ ...GOOD, email: "not-an-address", name: "" });
    expect(res.status).toBe(400);

    const body = (await res.json()) as Record<string, string>;
    expect(body.email).toBeTruthy();
    expect(body.name).toBeTruthy();
    expect(body.organisation).toBeUndefined();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("thanks a bot that filled the honeypot, and sends nothing", async () => {
    // The response must be indistinguishable from success, or the honeypot
    // tells whoever is probing exactly which field gave them away.
    const res = await post({ ...GOOD, honeypot: "http://spam.example" });
    expect(res.status).toBe(202);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("never reports a failed send as success", async () => {
    mocks.sendEmail.mockRejectedValue(new FakeRejected("Brevo said no"));
    const res = await post(GOOD);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toMatch(/email us directly/i);
  });

  it("says so plainly when email is not configured at all", async () => {
    mocks.emailConfigured.mockReturnValue(false);
    const res = await post(GOOD);
    expect(res.status).toBe(503);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("turns away a flood from one address after the budget is spent", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await post(GOOD)).status).toBe(202);
    }
    const res = await post(GOOD);
    expect(res.status).toBe(429);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(5);
  });

  it("budgets each address separately", async () => {
    // The failure this guards against: behind a proxy every visitor shares one
    // apparent address, and the second genuine partner of the day is refused.
    for (let i = 0; i < 5; i++) await post(GOOD, "198.51.100.1");
    expect((await post(GOOD, "198.51.100.1")).status).toBe(429);
    expect((await post(GOOD, "198.51.100.2")).status).toBe(202);
  });

  it("does not spend the budget on submissions it refused anyway", async () => {
    // Otherwise a person fumbling their email address five times is locked out
    // before they ever manage to send a valid enquiry.
    for (let i = 0; i < 8; i++) {
      expect((await post({ ...GOOD, email: "nope" })).status).toBe(400);
    }
    expect((await post(GOOD)).status).toBe(202);
  });
});
