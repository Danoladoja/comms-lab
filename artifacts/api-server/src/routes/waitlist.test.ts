import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Joining the waitlist, over real HTTP.
 *
 * The behaviour worth guarding is that somebody who fills the form in gets on
 * the list. Everything else here — a mail provider having a bad afternoon, a
 * programme that has since been unpublished — must not cost a person their
 * place, because nobody types their name into a waitlist twice.
 */

const mocks = vi.hoisted(() => {
  let selectResults: unknown[][] = [];
  let insertThrows: Error | null = null;
  const inserted: unknown[] = [];

  const thenable = (get: () => unknown[], onValues?: (v: unknown) => void) => {
    const builder: Record<string, unknown> = {};
    for (const key of ["from", "where", "leftJoin", "orderBy", "returning", "limit", "onConflictDoUpdate", "onConflictDoNothing"]) {
      builder[key] = () => builder;
    }
    builder.values = (v: unknown) => { onValues?.(v); return builder; };
    builder.then = (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) => {
      if (insertThrows && onValues) return Promise.reject(insertThrows).then(resolve, reject);
      return Promise.resolve(get()).then(resolve, reject);
    };
    return builder;
  };

  return {
    db: {
      select: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      insert: vi.fn(() => thenable(() => [], (v) => inserted.push(v))),
      update: vi.fn(() => thenable(() => [])),
      delete: vi.fn(() => thenable(() => [])),
    },
    sendEmail: vi.fn(),
    emailConfigured: vi.fn(() => true),
    getCurrentUser: vi.fn(async () => ({ id: 1, role: "admin" })),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    failInserts(err: Error | null) { insertThrows = err; },
    inserted,
    reset() { selectResults = []; insertThrows = null; inserted.length = 0; },
  };
});

vi.mock("@workspace/db", () => ({
  db: mocks.db,
  waitlistTable: { email: "email" },
  programsTable: { id: "id", title: "title", status: "status" },
  usersTable: { id: "id", role: "role", name: "name", email: "email", createdAt: "created_at" },
  enrollmentsTable: { userId: "user_id", status: "status" },
}));
vi.mock("../lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/email", () => ({
  emailConfigured: mocks.emailConfigured,
  sendEmail: mocks.sendEmail,
  EmailRejectedError: class extends Error {},
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import waitlistRouter, { waitlistBudget } from "./waitlist";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

function join(body: unknown) {
  return fetch(`${baseUrl}/api/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PUBLISHED = [{ id: 3, title: "Energy Reporting", status: "published" }];

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.reset();
  // The budget is one map for the life of the process, which is right in
  // production and wrong between tests: without this, five successful joins in
  // an earlier test spend the sixth test's allowance.
  waitlistBudget.reset();
  mocks.emailConfigured.mockReturnValue(true);
  mocks.sendEmail.mockResolvedValue(undefined);

  const app = express();
  app.use(express.json());
  app.use("/api", waitlistRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

describe("POST /waitlist", () => {
  it("puts somebody on the list and names the programme back to them", async () => {
    mocks.setSelects([PUBLISHED]);

    const res = await join({ name: "Amina Bello", email: "amina@example.org", programme: "3" });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("Energy Reporting");
    expect(mocks.inserted[0]).toMatchObject({ email: "amina@example.org", programId: 3, status: "waiting" });
  });

  it("takes somebody waiting for any future cohort", async () => {
    const res = await join({ name: "Amina Bello", email: "amina@example.org", programme: "any" });
    expect(res.status).toBe(201);
    expect(mocks.inserted[0]).toMatchObject({ programId: null });
  });

  it("explains a bad address instead of failing silently", async () => {
    const res = await join({ name: "Amina Bello", email: "not-an-address" });
    expect(res.status).toBe(400);
    expect((await res.json() as { message: string }).message).toMatch(/email/i);
  });

  it("keeps somebody whose chosen programme has since been hidden", async () => {
    // Their page was open when the programme was still listed. Refusing here
    // would lose a real person over our own timing.
    mocks.setSelects([[{ id: 3, title: "Energy Reporting", status: "draft" }]]);

    const res = await join({ name: "Amina Bello", email: "amina@example.org", programme: "3" });
    expect(res.status).toBe(201);
    expect(mocks.inserted[0]).toMatchObject({ programId: null });
  });

  it("still adds them when the confirmation email fails", async () => {
    // Being on the list is the thing that matters; the email is a courtesy.
    mocks.sendEmail.mockRejectedValue(new Error("Brevo is having a day"));

    const res = await join({ name: "Amina Bello", email: "amina@example.org" });
    expect(res.status).toBe(201);
    expect(mocks.inserted).toHaveLength(1);
  });

  it("adds them when no mail provider is configured at all", async () => {
    mocks.emailConfigured.mockReturnValue(false);
    const res = await join({ name: "Amina Bello", email: "amina@example.org" });
    expect(res.status).toBe(201);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("says so plainly when the entry could not be saved", async () => {
    // The opposite case: here the person is genuinely not on the list, and
    // thanking them would be the worst possible answer.
    mocks.failInserts(new Error("database is down"));
    const res = await join({ name: "Amina Bello", email: "amina@example.org" });
    expect(res.status).toBe(503);
  });

  it("turns away a filled honeypot without saving or explaining", async () => {
    const res = await join({
      name: "Amina Bello", email: "amina@example.org", trap: "http://spam.example",
    });
    expect(res.status).toBe(400);
    expect(mocks.inserted).toHaveLength(0);
    expect((await res.json() as { message: string }).message).not.toMatch(/hidden|bot/i);
  });

  it("stops a flood from one address after a handful of attempts", async () => {
    for (let i = 0; i < 5; i++) {
      const ok = await join({ name: `Person ${i}`, email: `p${i}@example.org` });
      expect(ok.status).toBe(201);
    }
    const sixth = await join({ name: "Person 6", email: "p6@example.org" });
    expect(sixth.status).toBe(429);
  });

  it("does not spend the budget on a form with a mistake in it", async () => {
    for (let i = 0; i < 5; i++) {
      const bad = await join({ name: "Amina", email: "still-not-an-address" });
      expect(bad.status).toBe(400);
    }
    const good = await join({ name: "Amina Bello", email: "amina@example.org" });
    expect(good.status).toBe(201);
  });
});
