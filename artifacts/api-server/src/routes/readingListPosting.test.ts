import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A reading list is saved privately and posted deliberately.
 *
 * Until now, pressing Save put the links straight onto every learner's screen.
 * Nothing warned anybody, and there was no way to build a list over a week
 * without the half-built version being live the whole time.
 *
 * The two things worth guarding are the same two as everywhere else: an
 * unposted list must be invisible, and a list that was already live before any
 * of this existed must stay live.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    sessionsTable: { id: "id", programId: "programId", title: "title", description: "description", instructorId: "instructorId", readingsDraft: "readingsDraft", readingsPostedAt: "readingsPostedAt" },
    programsTable: { id: "id", title: "title" },
    enrollmentsTable: { id: "id", userId: "userId", programId: "programId", status: "status" },
    usersTable: { id: "id", email: "email", name: "name" },
    sessionReadingsTable: { id: "id", sessionId: "sessionId", title: "title", url: "url", note: "note", sortOrder: "sortOrder" },
    sessionSlidesTable: { id: "id", sessionId: "sessionId" },
    sessionNotesTable: { sessionId: "sessionId" },
    courseworkDraftRunsTable: { sessionId: "sessionId" },
  };

  let queue: unknown[][] = [];
  const updates: Record<string, unknown>[] = [];

  const thenable = (get: () => unknown[], onSet?: (v: Record<string, unknown>) => void) => {
    const b: Record<string, unknown> = {};
    for (const k of [
      "from", "where", "values", "innerJoin", "leftJoin", "groupBy", "orderBy",
      "limit", "returning", "onConflictDoUpdate",
    ]) b[k] = () => b;
    b.set = (v: Record<string, unknown>) => { onSet?.(v); return b; };
    b.then = (res: (v: unknown[]) => unknown, rej?: (r: unknown) => unknown) =>
      Promise.resolve(get()).then(res, rej);
    return b;
  };

  const tx = {
    delete: () => thenable(() => []),
    insert: () => thenable(() => []),
    update: () => thenable(() => [], (v) => { updates.push(v); }),
  };

  return {
    db: {
      select: vi.fn(() => thenable(() => queue.shift() ?? [])),
      selectDistinct: vi.fn(() => thenable(() => queue.shift() ?? [])),
      insert: vi.fn(() => thenable(() => [])),
      update: vi.fn(() => thenable(() => [], (v) => { updates.push(v); })),
      delete: vi.fn(() => thenable(() => [])),
      transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    },
    getCurrentUser: vi.fn(),
    setQueue(rows: unknown[][]) { queue = [...rows]; },
    updates,
    tables,
  };
});

vi.mock("@workspace/db", () => ({ db: mocks.db, ...mocks.tables }));
vi.mock("../lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  currentRole: vi.fn(async () => "admin"),
}));
vi.mock("../lib/progress", () => ({
  progressForUser: vi.fn(async () => []),
  enrolledProgramIds: vi.fn(async () => []),
}));
vi.mock("../lib/anthropic", () => ({ draftCoursework: vi.fn() }));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import slidesRouter from "./slides";

const MODULE = {
  id: 10, programId: 3, title: "Who Owns the Grid", description: "",
  instructorId: 99, programTitle: "Energy Narratives",
};
const LINKS = [{ title: "Africa Energy Outlook", url: "https://example.org/report", note: "" }];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

const readings = () => fetch(`${baseUrl}/api/sessions/10/readings`);

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
  mocks.setQueue([]);
  mocks.getCurrentUser.mockResolvedValue({ id: 5, role: "learner" });

  const app = express();
  app.use(express.json());
  app.use("/api", slidesRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

describe("an unposted reading list", () => {
  it("is empty as far as a learner is concerned", async () => {
    mocks.setQueue([
      [{ ...MODULE, readingsDraft: true, readingsPostedAt: null }],
      [{ id: 1 }],   // enrolled
      LINKS,
    ]);

    const res = await readings();

    expect(res.status).toBe(200);
    // Not "locked", not an error — simply nothing there yet, which is the truth.
    expect(await res.json()).toEqual([]);
  });

  it("is visible to the person building it", async () => {
    // instructorId 99 is this user, so they are staff for this module.
    mocks.getCurrentUser.mockResolvedValue({ id: 99, role: "instructor" });
    mocks.setQueue([[{ ...MODULE, readingsDraft: true, readingsPostedAt: null }], LINKS]);

    const body = (await (await readings()).json()) as unknown[];
    expect(body).toHaveLength(1);
  });

  it("still shows a list that was live before posting existed", async () => {
    // The column defaults to false precisely so that a term's worth of links
    // does not vanish off every learner's screen the day this ships.
    mocks.setQueue([
      [{ ...MODULE, readingsDraft: false, readingsPostedAt: null }],
      [{ id: 1 }],
      LINKS,
    ]);

    expect((await (await readings()).json()) as unknown[]).toHaveLength(1);
  });
});

describe("saving a reading list", () => {
  const save = () =>
    fetch(`${baseUrl}/api/sessions/10/readings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: LINKS }),
    });

  it("keeps a brand-new list private until it is posted", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 99, role: "instructor" });
    mocks.setQueue([
      [{ ...MODULE, readingsDraft: false, readingsPostedAt: null }],
      [],  // nothing saved before now
    ]);

    const body = (await (await save()).json()) as { draft: boolean };

    expect(body.draft).toBe(true);
    expect(mocks.updates).toContainEqual(expect.objectContaining({ readingsDraft: true }));
  });

  it("does not take a posted list back off the cohort when it is edited", async () => {
    // Fixing a broken link must not make the whole shelf disappear.
    mocks.getCurrentUser.mockResolvedValue({ id: 99, role: "instructor" });
    mocks.setQueue([
      [{ ...MODULE, readingsDraft: false, readingsPostedAt: new Date() }],
      [{ id: 1 }],  // links already there
    ]);

    const body = (await (await save()).json()) as { draft: boolean };

    expect(body.draft).toBe(false);
  });
});
