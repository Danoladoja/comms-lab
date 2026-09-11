import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can read whose work.
 *
 * Three rules are worth guarding here, because getting any of them wrong is not
 * a bug you notice — it is a learner discovering their work was readable before
 * they had written a word, or a reviewer discovering their name was on feedback
 * they were promised was anonymous.
 *
 *   1. The discussion is shut until a learner has filed and critiqued.
 *   2. Inside it, pieces are named and critiques are not.
 *   3. The staff screen is staff only, and it is the one place a critique
 *      carries its author's name.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    usersTable: { id: "id", name: "name", email: "email" },
    programsTable: { id: "id" },
    enrollmentsTable: { id: "id", userId: "userId", programId: "programId", status: "status" },
    sessionsTable: { id: "id", programId: "programId", instructorId: "instructorId" },
    assignmentsTable: {
      id: "id", sessionId: "sessionId", title: "title", instructions: "instructions",
      rubric: "rubric", reviewsRequired: "reviewsRequired",
    },
    assignmentSubmissionsTable: {
      id: "id", userId: "userId", sessionId: "sessionId", body: "body", submittedAt: "submittedAt",
      aiUse: "aiUse", aiNote: "aiNote", activeSeconds: "activeSeconds", sittings: "sittings",
      pasteCount: "pasteCount", pastedChars: "pastedChars", largestPaste: "largestPaste",
      withdrawnAt: "withdrawnAt", withdrawnBy: "withdrawnBy",
    },
    submissionReviewsTable: {
      id: "id", submissionId: "submissionId", reviewerId: "reviewerId", sessionId: "sessionId",
      scores: "scores", comment: "comment", createdAt: "createdAt",
    },
    submissionCommentsTable: {
      id: "id", submissionId: "submissionId", sessionId: "sessionId", userId: "userId",
      body: "body", createdAt: "createdAt",
    },
  };

  let selectResults: unknown[][] = [];

  const thenable = (get: () => unknown[]) => {
    const builder: Record<string, unknown> = {};
    for (const key of [
      "from", "where", "values", "set", "leftJoin", "innerJoin", "orderBy", "limit",
      "returning", "groupBy", "onConflictDoNothing", "onConflictDoUpdate",
    ]) builder[key] = () => builder;
    builder.then = (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(get()).then(resolve, reject);
    return builder;
  };

  return {
    db: {
      select: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      selectDistinct: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      insert: vi.fn(() => thenable(() => [])),
      update: vi.fn(() => thenable(() => [])),
      delete: vi.fn(() => thenable(() => [])),
      transaction: vi.fn(),
    },
    getCurrentUser: vi.fn(),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    tables,
  };
});

vi.mock("@workspace/db", () => ({ db: mocks.db, ...mocks.tables }));
vi.mock("../lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("../lib/progress", () => ({
  progressForUser: vi.fn(async () => []),
  enrolledProgramIds: vi.fn(async () => []),
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import reviewsRouter from "./reviews";

const MODULE = [{
  id: 4, programId: 2, instructorId: 9, assignmentId: 11,
  title: "The tariff story", instructions: "800 words.",
  rubric: null, reviewsRequired: 2,
}];
const ENROLLED = [{ id: 77 }];
const FILED = new Date("2026-09-01T10:00:00Z");

const PIECES = [
  {
    submissionId: 21, authorId: 5, authorName: "Amina Bello",
    body: "Nigeria's band-A tariff rose 240% in April.", submittedAt: FILED,
    aiUse: "edit", aiNote: "Tightened my second paragraph.",
    activeSeconds: 2400, sittings: 3, pasteCount: 0, pastedChars: 0, largestPaste: 0,
    withdrawnAt: null,
  },
  {
    submissionId: 22, authorId: 6, authorName: "Kwame Mensah",
    body: "The minister denied it twice.", submittedAt: FILED,
    aiUse: "none", aiNote: "",
    activeSeconds: 90, sittings: 1, pasteCount: 1, pastedChars: 28, largestPaste: 28,
    withdrawnAt: null,
  },
];
const CRITIQUES = [{
  id: 31, submissionId: 21, reviewerId: 6, reviewerName: "Kwame Mensah",
  scores: {}, comment: "The lede buries the number.", createdAt: FILED,
}];
const COMMENTS = [{
  id: 41, submissionId: 21, authorId: 6, authorName: "Kwame Mensah",
  body: "I would have led on the 240% too.", createdAt: FILED,
}];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

/**
 * Only the parts these tests assert on. Written out rather than borrowed from
 * the generated client, because a test that describes the shape it expects
 * catches the day the route stops sending it.
 */
type Discussion = {
  open: boolean;
  lockedReason: string;
  pieces: {
    submissionId: number;
    authorName: string;
    mine: boolean;
    aiUseLabel: string;
    aiNote: string;
    critiques: { comment: string }[];
    comments: { authorName: string }[];
  }[];
};

type StaffWork = {
  missing: string[];
  owing: { name: string; given: number }[];
  pieces: {
    submissionId: number;
    provenance: string;
    worthALook: boolean;
    critiques: { reviewerName: string; thin: boolean }[];
  }[];
};

const discussion = async (): Promise<{ status: number; body: Discussion }> => {
  const res = await fetch(`${baseUrl}/api/sessions/4/discussion`);
  return { status: res.status, body: (await res.json()) as Discussion };
};

const staffWork = async (): Promise<{ status: number; body: StaffWork; text: string }> => {
  const res = await fetch(`${baseUrl}/api/admin/sessions/4/work`);
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as StaffWork) : ({} as StaffWork), text };
};

const pieceIn = <T extends { submissionId: number }>(pieces: T[], id: number): T => {
  const found = pieces.find((p) => p.submissionId === id);
  if (!found) throw new Error(`No piece ${id} in the response`);
  return found;
};

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.setSelects([]);
  mocks.getCurrentUser.mockResolvedValue({ id: 5, name: "Amina Bello", role: "learner" });

  const app = express();
  app.use(express.json());
  app.use("/api", reviewsRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

/** module · enrolment · critiques given · own submission · pieces · critiques · comments */
const learnerReads = (given: number, mine: unknown[]) =>
  mocks.setSelects([MODULE, ENROLLED, [{ count: given }], mine, PIECES, CRITIQUES, COMMENTS]);

describe("GET /sessions/:id/discussion", () => {
  it("stays shut until the learner has filed their own piece", async () => {
    learnerReads(0, []);
    const { body } = await discussion();

    expect(body.open).toBe(false);
    expect(body.lockedReason).toMatch(/submit your own piece/i);
    expect(body.pieces).toEqual([]);
    // And nobody else's words travelled, not even to be thrown away.
    expect(JSON.stringify(body)).not.toContain("band-A tariff");
  });

  it("stays shut while critiques are owed, and says how many", async () => {
    learnerReads(1, [{ id: 21 }]);
    const { body } = await discussion();

    expect(body.open).toBe(false);
    expect(body.lockedReason).toMatch(/one more critique/i);
    expect(JSON.stringify(body)).not.toContain("band-A tariff");
  });

  it("opens once the work is done, with pieces named and critiques not", async () => {
    learnerReads(2, [{ id: 21 }]);
    const { body } = await discussion();

    expect(body.open).toBe(true);
    expect(body.pieces).toHaveLength(2);

    const amina = pieceIn(body.pieces, 21);
    expect(amina.authorName).toBe("Amina Bello");
    expect(amina.mine).toBe(true);
    // The disclosure travels with the piece — that was the point of asking.
    expect(amina.aiUseLabel).toMatch(/edit and tighten/i);
    expect(amina.aiNote).toBe("Tightened my second paragraph.");

    // The promise of anonymity does not lapse when the exercise ends.
    expect(amina.critiques[0].comment).toMatch(/buries the number/);
    expect(JSON.stringify(amina.critiques)).not.toContain("Kwame");

    // A comment is a conversation, so it is signed.
    expect(amina.comments[0].authorName).toBe("Kwame Mensah");
  });

  it("never sends a score of any kind, only what people wrote", async () => {
    learnerReads(2, [{ id: 21 }]);
    const { body } = await discussion();
    expect(JSON.stringify(body)).not.toMatch(/worthALook|provenance|activeSeconds|scorePct/);
  });
});

describe("GET /admin/sessions/:id/work", () => {
  /** module · pieces · critiques · cohort */
  const staffReads = () => mocks.setSelects([MODULE, PIECES, CRITIQUES, [
    { id: 5, name: "Amina Bello" }, { id: 6, name: "Kwame Mensah" }, { id: 7, name: "Ngozi Eze" },
  ]]);

  it("refuses a learner, including one enrolled on the programme", async () => {
    staffReads();
    const { status, text } = await staffWork();
    expect(status).toBe(403);
    expect(text).not.toContain("band-A tariff");
  });

  it("refuses a facilitator who does not teach this module", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 8, name: "Someone Else", role: "instructor" });
    staffReads();
    expect((await staffWork()).status).toBe(403);
  });

  it("gives the facilitator who teaches it the names on every critique", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 9, name: "Dan", role: "instructor" });
    staffReads();
    const { body } = await staffWork();

    const amina = pieceIn(body.pieces, 21);
    // The one screen where a critique is signed.
    expect(amina.critiques[0].reviewerName).toBe("Kwame Mensah");
    expect(amina.provenance).toMatch(/3 sittings/);
    expect(amina.worthALook).toBe(false);

    // And the two lists a facilitator actually chases.
    expect(body.missing).toEqual(["Ngozi Eze"]);
    expect(body.owing.map((o) => o.name)).toContain("Amina Bello");
  });

  it("raises an eyebrow at a piece that arrived whole in ninety seconds", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: 1, name: "Admin", role: "admin" });
    staffReads();
    const { body } = await staffWork();

    const kwame = pieceIn(body.pieces, 22);
    expect(kwame.worthALook).toBe(true);
    // A sentence about what happened, never a verdict about who wrote it.
    expect(kwame.provenance).not.toMatch(/\bAI\b|likely|generated/i);
  });
});
