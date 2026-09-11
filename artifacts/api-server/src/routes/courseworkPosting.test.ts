import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Saving is private; posting is public.
 *
 * Three things are worth guarding, and they are guarded here rather than in the
 * browser because the browser is not where the damage happens.
 *
 * One: a draft must be invisible. Not merely un-clickable — absent, the same as
 * if it had never been written.
 *
 * Two, and this is the one that would hurt: completing a module needs its quiz
 * and its task, and the next module waits on this one. A draft that still
 * counted towards completion would wall a whole cohort in behind a quiz they
 * cannot see, with nothing on screen to explain it. So progress must not count
 * drafts at all.
 *
 * Three: posting is what sends the email, and it must send exactly one round of
 * them — never on a save, and never twice for the same piece.
 */

const mocks = vi.hoisted(() => {
  const tables = {
    sessionsTable: { id: "id", programId: "programId", quizDraft: "quizDraft", quizDueAt: "quizDueAt" },
    programsTable: { id: "id", title: "title" },
    usersTable: { id: "id", email: "email", name: "name" },
    enrollmentsTable: { id: "id", userId: "userId", programId: "programId", status: "status" },
    quizQuestionsTable: { sessionId: "sessionId", sortOrder: "sortOrder", id: "id" },
    quizAttemptsTable: { userId: "userId", sessionId: "sessionId", scorePct: "scorePct" },
    assignmentsTable: { id: "id", sessionId: "sessionId", dueAt: "dueAt", draft: "draft" },
    assignmentSubmissionsTable: { userId: "userId", sessionId: "sessionId", body: "body", submittedAt: "submittedAt" },
    sessionReadingsTable: { id: "id", sessionId: "sessionId" },
    sessionSlidesTable: { id: "id", sessionId: "sessionId", visibleToLearners: "visibleToLearners" },
  };

  let selectResults: unknown[][] = [];
  const updates: Record<string, unknown>[] = [];

  const thenable = (get: () => unknown[], onSet?: (v: Record<string, unknown>) => void) => {
    const builder: Record<string, unknown> = {};
    for (const key of [
      "from", "where", "values", "leftJoin", "innerJoin", "orderBy", "limit",
      "returning", "groupBy", "onConflictDoUpdate",
    ]) builder[key] = () => builder;
    builder.set = (v: Record<string, unknown>) => { onSet?.(v); return builder; };
    builder.then = (resolve: (v: unknown[]) => unknown, reject?: (r: unknown) => unknown) =>
      Promise.resolve(get()).then(resolve, reject);
    return builder;
  };

  return {
    db: {
      select: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      selectDistinct: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      insert: vi.fn(() => thenable(() => selectResults.shift() ?? [])),
      update: vi.fn(() => thenable(() => [], (v) => { updates.push(v); })),
      delete: vi.fn(() => thenable(() => [])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
        delete: () => thenable(() => []),
        insert: () => thenable(() => selectResults.shift() ?? []),
      })),
    },
    getCurrentUser: vi.fn(),
    currentRole: vi.fn(),
    sendEmail: vi.fn(async () => undefined),
    emailConfigured: vi.fn(() => true),
    setSelects(rows: unknown[][]) { selectResults = [...rows]; },
    updates,
    tables,
  };
});

vi.mock("@workspace/db", () => ({ db: mocks.db, ...mocks.tables }));
vi.mock("../lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  currentRole: mocks.currentRole,
}));
vi.mock("../lib/progress", () => ({
  progressForUser: vi.fn(async () => []),
  enrolledProgramIds: vi.fn(async () => []),
}));
vi.mock("../lib/email", () => ({
  sendEmail: mocks.sendEmail,
  emailConfigured: mocks.emailConfigured,
}));
vi.mock("../lib/enrollmentEmails", () => ({
  appUrl: (p: string) => `https://energycommslab.africa${p}`,
  labLogoUrl: () => null,
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import courseworkRouter from "./coursework";

const MODULE = {
  id: 10, programId: 3, title: "Who Owns the Grid", instructorId: 99,
  quizDueAt: null, readingsDraft: false, readingsPostedAt: null,
};
const LIVE = { ...MODULE, quizDraft: false, quizPostedAt: new Date() };
const UNPOSTED = { ...MODULE, quizDraft: true, quizPostedAt: null };
const ENROLLED = [{ id: 1 }];
const QUESTIONS = [
  { id: 1, prompt: "Who pays?", options: ["A", "B"], correctIndex: 0, sortOrder: 0, origin: "manual" },
];
const COHORT = [
  { email: "amina@example.org", name: "Amina Bello" },
  { email: "kwame@example.org", name: "Kwame Mensah" },
];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;

const asLearner = () => {
  mocks.getCurrentUser.mockResolvedValue({ id: 5, role: "learner" });
  mocks.currentRole.mockResolvedValue("learner");
};
const asAdmin = () => {
  mocks.getCurrentUser.mockResolvedValue({ id: 1, role: "admin" });
  mocks.currentRole.mockResolvedValue("admin");
};

const getQuiz = () => fetch(`${baseUrl}/api/sessions/10/quiz`);
const getTask = () => fetch(`${baseUrl}/api/sessions/10/assignment`);
const postCoursework = () =>
  fetch(`${baseUrl}/api/sessions/10/coursework/post`, { method: "POST" });

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.updates.length = 0;
  mocks.setSelects([]);
  mocks.emailConfigured.mockReturnValue(true);
  asLearner();

  const app = express();
  app.use(express.json());
  app.use("/api", courseworkRouter);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
});

describe("a draft is invisible to learners", () => {
  it("tells a learner there is no quiz, rather than showing them an unfinished one", async () => {
    mocks.setSelects([[UNPOSTED], ENROLLED, QUESTIONS]);

    const res = await getQuiz();

    expect(res.status).toBe(404);
    // Not one word of the unfinished questions leaves the server.
    expect(JSON.stringify(await res.json())).not.toContain("Who pays");
  });

  it("shows the same draft to the person writing it", async () => {
    asAdmin();
    mocks.setSelects([[UNPOSTED], QUESTIONS, [{ best: null }]]);

    const res = await getQuiz();

    expect(res.status).toBe(200);
    const body = (await res.json()) as { draft: boolean; questions: unknown[] };
    expect(body.draft).toBe(true);
    expect(body.questions).toHaveLength(1);
  });

  it("refuses answers to a quiz that was never posted", async () => {
    mocks.setSelects([[UNPOSTED], ENROLLED]);
    const res = await fetch(`${baseUrl}/api/sessions/10/quiz/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: [{ questionId: 1, answerIndex: 0 }] }),
    });
    expect(res.status).toBe(404);
  });

  it("hides a drafted task and refuses a submission to it", async () => {
    mocks.setSelects([[MODULE], ENROLLED, [{ id: 4, title: "Brief", instructions: "", rubric: [], reviewsRequired: 2, draft: true, dueAt: null, origin: "manual" }]]);
    expect((await getTask()).status).toBe(404);

    mocks.setSelects([[MODULE], ENROLLED, [{ id: 4, dueAt: null, draft: true }]]);
    const res = await fetch(`${baseUrl}/api/sessions/10/assignment/submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Handed in early, on something never set.", aiUse: "none" }),
    });
    expect(res.status).toBe(404);
  });

  it("still shows a quiz that was live before posting existed", async () => {
    // Every quiz already published carries quizDraft = false, and must go on
    // behaving exactly as it did. This is the whole reason for that default.
    mocks.setSelects([[LIVE], ENROLLED, QUESTIONS, [{ best: 80 }]]);
    expect((await getQuiz()).status).toBe(200);
  });
});

describe("posting", () => {
  it("publishes the drafts and writes to the cohort once each", async () => {
    asAdmin();
    mocks.setSelects([
      [UNPOSTED],                                   // the module
      [{ id: 1 }],                                  // a quiz exists
      [{ id: 4, title: "Brief", draft: true, dueAt: null }], // and a task
      [],                                           // no reading list
      [],                                           // no deck
      [{ title: "Energy Narratives" }],             // the programme
      COHORT,                                       // who is on it
    ]);

    const res = await postCoursework();

    expect(res.status).toBe(201);
    const body = (await res.json()) as { posted: string[]; emailed: number };
    expect(body.posted.sort()).toEqual(["assignment", "quiz"]);
    expect(body.emailed).toBe(2);
    // One letter per person, not one per piece of coursework.
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
    // And both were taken out of draft.
    expect(mocks.updates).toEqual([
      expect.objectContaining({ quizDraft: false }),
      expect.objectContaining({ draft: false }),
    ]);
  });

  it("says there is nothing to post rather than sending an empty notice", async () => {
    asAdmin();
    mocks.setSelects([
      [LIVE],
      [{ id: 1 }],
      [{ id: 4, title: "Brief", draft: false, dueAt: null }],
      [],
      [],
    ]);

    const res = await postCoursework();

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/already live/i);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("posts to an empty cohort without pretending anybody was told", async () => {
    asAdmin();
    mocks.setSelects([[UNPOSTED], [{ id: 1 }], [], [], [], [{ title: "Energy Narratives" }], []]);

    const body = (await (await postCoursework()).json()) as { posted: string[]; emailed: number };

    expect(body.posted).toEqual(["quiz"]);
    expect(body.emailed).toBe(0);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("still publishes when the mail provider is switched off", async () => {
    // Going live and being emailed are separate things. A missing mail provider
    // must not hold a cohort's coursework hostage.
    asAdmin();
    mocks.emailConfigured.mockReturnValue(false);
    mocks.setSelects([[UNPOSTED], [{ id: 1 }], [], [], [], [{ title: "Energy Narratives" }], COHORT]);

    const body = (await (await postCoursework()).json()) as {
      posted: string[]; emailed: number; mailConfigured: boolean;
    };

    expect(body.posted).toEqual(["quiz"]);
    expect(body.mailConfigured).toBe(false);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("carries on down the cohort when one address is refused", async () => {
    asAdmin();
    mocks.sendEmail.mockRejectedValueOnce(new Error("bad address"));
    mocks.setSelects([[UNPOSTED], [{ id: 1 }], [], [], [], [{ title: "Energy Narratives" }], COHORT]);

    const body = (await (await postCoursework()).json()) as { emailed: number; failed: number };

    expect(body.emailed).toBe(1);
    expect(body.failed).toBe(1);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("takes the reading list and the deck out with the rest", async () => {
    // Both used to reach learners the moment they were saved. They now wait for
    // the same press, and go out in the same letter as everything else.
    asAdmin();
    mocks.setSelects([
      [{ ...UNPOSTED, quizDraft: false, readingsDraft: true }],
      [],                                        // no quiz
      [],                                        // no task
      [{ id: 7 }],                               // a reading list exists
      [{ id: 8, visibleToLearners: false }],     // and a deck, not yet shown
      [{ title: "Energy Narratives" }],
      COHORT,
    ]);

    const body = (await (await postCoursework()).json()) as { posted: string[] };

    expect(body.posted.sort()).toEqual(["readings", "slides"]);
    expect(mocks.updates).toEqual([
      expect.objectContaining({ readingsDraft: false }),
      expect.objectContaining({ visibleToLearners: true }),
    ]);
    // Still one letter, not one per piece.
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);
  });

  it("leaves a deck that was deliberately hidden alone", async () => {
    // The deck's own hide control is not overruled by posting the rest: a deck
    // taken down on purpose stays down.
    asAdmin();
    mocks.setSelects([
      [LIVE],
      [{ id: 1 }],
      [{ id: 4, title: "Brief", draft: false, dueAt: null }],
      [{ id: 7 }],
      [{ id: 8, visibleToLearners: true }],
    ]);

    const res = await postCoursework();
    expect(res.status).toBe(400);
    expect(mocks.updates).toHaveLength(0);
  });

  it("refuses anybody who does not run this module", async () => {
    mocks.setSelects([[UNPOSTED], [], [], [], []]);
    expect((await postCoursework()).status).toBe(403);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});

describe("saving never emails anybody", () => {
  it("sends nothing when a quiz is saved", async () => {
    // The whole point of the split. Before this, saving was publishing.
    asAdmin();
    mocks.setSelects([[UNPOSTED], [], [{ id: 1, prompt: "Who pays?", options: ["A", "B"], correctIndex: 0, sortOrder: 0, origin: "manual" }]]);

    const res = await fetch(`${baseUrl}/api/sessions/10/quiz`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questions: [{ prompt: "Who pays?", options: ["A", "B"], correctIndex: 0 }] }),
    });

    expect(res.status).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    // A quiz nobody has seen stays private until it is posted.
    expect((await res.json() as { draft: boolean }).draft).toBe(true);
  });

  it("makes a brand-new quiz a draft even on a module that predates posting", async () => {
    // Every module in the database says quizDraft = false, because that default
    // is what keeps published coursework published. So the *first* save of a
    // quiz on such a module is what has to make it private — otherwise writing
    // a quiz would still be publishing it, which is the bug being fixed.
    asAdmin();
    const neverHadOne = { ...MODULE, quizDraft: false, quizPostedAt: null };
    mocks.setSelects([
      [neverHadOne],
      [],                                        // no questions saved before now
      [{ id: 1, prompt: "Who pays?", options: ["A", "B"], correctIndex: 0, sortOrder: 0, origin: "manual" }],
    ]);

    const res = await fetch(`${baseUrl}/api/sessions/10/quiz`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questions: [{ prompt: "Who pays?", options: ["A", "B"], correctIndex: 0 }] }),
    });

    expect((await res.json() as { draft: boolean }).draft).toBe(true);
    expect(mocks.updates[0]).toMatchObject({ quizDraft: true });
  });

  it("does not take a posted quiz back off the cohort when it is edited", async () => {
    // Fixing a typo in a live quiz must not make it vanish from every dashboard.
    asAdmin();
    mocks.setSelects([
      [LIVE],
      [{ id: 1 }],                               // questions already exist
      [{ id: 1, prompt: "Who pays?", options: ["A", "B"], correctIndex: 0, sortOrder: 0, origin: "manual" }],
    ]);

    const res = await fetch(`${baseUrl}/api/sessions/10/quiz`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questions: [{ prompt: "Who pays?", options: ["A", "B"], correctIndex: 0 }] }),
    });

    expect((await res.json() as { draft: boolean }).draft).toBe(false);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
