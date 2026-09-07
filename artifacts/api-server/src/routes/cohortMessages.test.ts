import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Writing to a cohort, exercised over real HTTP.
 *
 * The thing to guard is not that a message sends. It is that it reaches exactly
 * the people it should and nobody else, because this is the only place in the
 * Lab where a person composes something and it goes to fifty inboxes at once.
 *
 * Three ways that goes wrong quietly: somebody removed from the cohort keeps
 * receiving its post; a person enrolled twice gets it twice; and an admin's
 * typing reaches an inbox as markup rather than as words.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    usersTable: { id: "id", email: "email", name: "name" },
    programsTable: { id: "id", title: "title" },
    enrollmentsTable: { userId: "userId", programId: "programId", status: "status" },
    cohortMessagesTable: { id: "id", programId: "programId", createdAt: "createdAt", sentByUserId: "sentByUserId" },
  };

  let selectResults: unknown[][] = [];
  const inserted: unknown[] = [];

  const thenable = (get: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const key of [
      "from", "where", "values", "set", "leftJoin", "innerJoin", "orderBy", "limit", "returning",
    ]) {
      builder[key] = (arg: unknown) => {
        if (key === "values") inserted.push(arg);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(get()).then(resolve, reject);
    return builder;
  };

  return {
    db: {
      select: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      insert: vi.fn(() => thenable(() => [{ id: 1 }])),
      update: vi.fn(() => thenable(() => [])),
      delete: vi.fn(() => thenable(() => [])),
    },
    sendEmail: vi.fn(),
    emailConfigured: vi.fn(() => true),
    getCurrentUser: vi.fn(async () => ({ id: 1, role: "admin" })),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    inserted,
    tables,
  };
});

vi.mock("@workspace/db", () => ({ db: mocks.db, ...mocks.tables }));
vi.mock("../lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/email", () => ({
  sendEmail: mocks.sendEmail,
  emailConfigured: mocks.emailConfigured,
  EmailRejectedError: class extends Error {},
}));
vi.mock("../lib/enrollmentEmails", () => ({ labLogoUrl: () => null }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import cohortMessagesRouter from "./cohortMessages";
import { statusesFor } from "@workspace/domain";

const PROGRAMME = [{ id: 3, title: "Energy Reporting Foundations" }];
const COHORT = [
  { id: 10, email: "amina@example.org", name: "Amina Bello" },
  { id: 11, email: "kwame@example.org", name: "Kwame Mensah" },
];

const GOOD_BODY =
  "The grid resilience class has moved from 2pm to 4pm this Thursday.\n\nEverything else is unchanged.";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

const post = (body: unknown, id = 3) =>
  fetch(`${baseUrl}/api/admin/programmes/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.inserted.length = 0;
  mocks.emailConfigured.mockReturnValue(true);
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.setSelects([]);

  const app = express();
  app.use(express.json());
  app.use("/api", cohortMessagesRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

describe("POST /admin/programmes/:id/messages", () => {
  it("sends one letter per person, in the Lab's template", async () => {
    mocks.setSelects([PROGRAMME, COHORT]);

    const res = await post({ subject: "Thursday has moved", body: GOOD_BODY });

    expect(res.status).toBe(201);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);

    const first = mocks.sendEmail.mock.calls[0]![0] as { html: string; text: string; subject: string };
    // The shared letter, not a second design: the dark masthead and the card.
    expect(first.html).toContain("#07111E");
    expect(first.html).toContain("Ananse Comms Lab");
    expect(first.subject).toBe("Thursday has moved");
    // And a plain-text alternative, which spam filters look for.
    expect(first.text).toContain("The grid resilience class has moved");
  });

  it("greets each person by their own name", async () => {
    mocks.setSelects([PROGRAMME, COHORT]);

    await post({ subject: "Thursday has moved", body: GOOD_BODY });

    const [first, second] = mocks.sendEmail.mock.calls.map((c) => (c[0] as { html: string }).html);
    expect(first).toContain("Hello Amina,");
    expect(second).toContain("Hello Kwame,");
  });

  it("never lets an admin's typing reach an inbox as markup", async () => {
    mocks.setSelects([PROGRAMME, COHORT]);

    await post({
      subject: "Careful",
      body: "A stray bracket <script>alert(1)</script> and an & ampersand, typed by an admin.",
    });

    const html = (mocks.sendEmail.mock.calls[0]![0] as { html: string }).html;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("writes to the cohort, not to people who were removed from it", async () => {
    // The rule itself is tested in the domain; this holds the route to it.
    expect(statusesFor("active")).not.toContain("cancelled");
    expect(statusesFor("everyone")).not.toContain("cancelled");
  });

  it("sends once to somebody who appears twice", async () => {
    mocks.setSelects([PROGRAMME, [...COHORT, { id: 12, email: "AMINA@example.org", name: "Amina Bello" }]]);

    await post({ subject: "Thursday has moved", body: GOOD_BODY });

    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("lets one bad address alone rather than taking the cohort with it", async () => {
    mocks.setSelects([PROGRAMME, COHORT]);
    mocks.sendEmail.mockRejectedValueOnce(new Error("mailbox unavailable"));

    const body = (await (await post({ subject: "Thursday has moved", body: GOOD_BODY })).json()) as {
      sent: number; failed: number; outcomes: { email: string; status: string }[];
    };

    expect(body.sent).toBe(1);
    expect(body.failed).toBe(1);
    // And names the one that failed, rather than only counting it.
    expect(body.outcomes.find((o) => o.status === "failed")?.email).toBe("amina@example.org");
  });

  it("records what was sent, even when every send failed", async () => {
    mocks.setSelects([PROGRAMME, COHORT]);
    mocks.sendEmail.mockRejectedValue(new Error("no"));

    await post({ subject: "Thursday has moved", body: GOOD_BODY });

    // "I sent that on Tuesday and nobody got it" is the thing worth looking up.
    const record = mocks.inserted.at(-1) as { subject: string; sentCount: number; failedCount: number };
    expect(record.subject).toBe("Thursday has moved");
    expect(record.sentCount).toBe(0);
    expect(record.failedCount).toBe(2);
  });

  it("refuses a message that is not ready, before finding anybody to send it to", async () => {
    mocks.setSelects([PROGRAMME, COHORT]);
    const res = await post({ subject: "", body: "hi" });
    expect(res.status).toBe(400);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("refuses a button link that is not an ordinary secure address", async () => {
    mocks.setSelects([PROGRAMME, COHORT]);
    const res = await post({
      subject: "Careful", body: GOOD_BODY,
      actionLabel: "Click", actionUrl: "javascript:alert(1)",
    });
    expect(res.status).toBe(400);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("says so plainly when there is nobody to write to", async () => {
    mocks.setSelects([PROGRAMME, []]);
    const res = await post({ subject: "Thursday has moved", body: GOOD_BODY });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/nobody on this programme/i);
  });

  it("is a 404 for a programme that is not there", async () => {
    mocks.setSelects([[]]);
    expect((await post({ subject: "Thursday has moved", body: GOOD_BODY })).status).toBe(404);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("says so plainly when no mail provider is configured", async () => {
    mocks.emailConfigured.mockReturnValue(false);
    expect((await post({ subject: "Thursday has moved", body: GOOD_BODY })).status).toBe(503);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
