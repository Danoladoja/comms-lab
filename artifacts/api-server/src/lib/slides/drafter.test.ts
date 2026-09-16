import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What comes back from the drafter, and what is done with it.
 *
 * The failure worth guarding is the quiet one. A facilitator pressed "Draft the
 * coursework", got a quiz, and got no written task — and nothing anywhere said
 * why, because an answer cut off halfway arrives looking exactly like a
 * complete one. The written task is the last thing in the schema, so it is the
 * first thing a long quiz pushes off the end.
 */

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { draftTask, draftCoursework } from "./drafter";

const CLASS = {
  programTitle: "Reporting the Energy Transition",
  sessionTitle: "Who pays for the grid",
  sessionDescription: "Tariffs, subsidies and who carries the cost",
  sourceText: "The class covered cost-reflective tariffs and cross-subsidy.",
};

/** One reply from the API, in the shape it actually arrives in. */
const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));

const toolUse = (name: string, input: unknown, stop_reason = "tool_use") => ({
  stop_reason,
  content: [{ type: "tool_use", name, input }],
});

const A_TASK = {
  assignment: {
    title: "Write the lede",
    instructions: "200 words for a national daily, on who pays for the new tariff.",
  },
  notes: [],
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-a-real-one";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("an answer that ran out of room", () => {
  it("is refused rather than passed on as a draft", () => {
    // This is the whole bug: max_tokens with a tool_use block attached looks
    // like success. It used to be read as one, and whatever had not been
    // written yet — the task — simply was not there.
    fetchSpy = reply(toolUse("submit_task", A_TASK, "max_tokens"));
    vi.stubGlobal("fetch", fetchSpy);

    return draftTask(CLASS).then((result) => {
      expect(result.assignment).toBeNull();
      expect(result.problems[0]).toMatch(/ran out of room/i);
      // And it says what to do about it, because "try again" on its own is
      // advice that has already failed once by the time anyone reads it.
      expect(result.problems[0]).toMatch(/separately/i);
    });
  });

  it("is refused on a full draft too, quiz and all", async () => {
    // A quiz without the task it was drafted alongside is half a module's
    // coursework presented as the whole of it.
    fetchSpy = reply(toolUse("submit_coursework", { questions: [], notes: [] }, "max_tokens"));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await draftCoursework(CLASS);
    expect(result.draft).toBeNull();
    expect(result.problems[0]).toMatch(/ran out of room/i);
  });
});

describe("drafting the task on its own", () => {
  it("returns the brief and asks only for a task", async () => {
    fetchSpy = reply(toolUse("submit_task", A_TASK));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await draftTask(CLASS);
    expect(result.assignment).toMatchObject({ title: "Write the lede" });
    expect(result.problems).toEqual([]);

    // The request forces one tool, and that tool is the task. A facilitator
    // asking for a better brief must not be handed eight new questions on top
    // of the ones they have already checked.
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as { body: string }).body);
    expect(body.tool_choice).toMatchObject({ type: "tool", name: "submit_task" });
    expect(JSON.stringify(body.tools)).not.toMatch(/correctIndex/);
  });

  it("sends what is in the editor, so a redo is a redo", async () => {
    fetchSpy = reply(toolUse("submit_task", A_TASK));
    vi.stubGlobal("fetch", fetchSpy);

    await draftTask({
      ...CLASS,
      current: { title: "Write a script", instructions: "Ninety seconds of radio." },
      guidance: "make it about the financing section",
    });

    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as { body: string }).body);
    const asked = body.messages[0].content as string;
    expect(asked).toContain("Write a script");
    expect(asked).toContain("make it about the financing section");
    expect(asked).toMatch(/must not simply restate/i);
  });

  it("keeps a facilitator's own words when nothing usable comes back", async () => {
    // The editor is not touched on a failure. A draft that fails must never
    // cost somebody the brief they had already written.
    fetchSpy = reply(toolUse("submit_task", { assignment: { title: "Half" }, notes: [] }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await draftTask(CLASS);
    expect(result.assignment).toBeNull();
    expect(result.problems[0]).toMatch(/half a task/i);
  });

  it("says what to do about a rejected key rather than printing a number", async () => {
    fetchSpy = reply({ error: "unauthorized" }, 401);
    vi.stubGlobal("fetch", fetchSpy);

    const result = await draftTask(CLASS);
    expect(result.problems[0]).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("says so plainly when there is no key at all", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    fetchSpy = reply(toolUse("submit_task", A_TASK));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await draftTask(CLASS);
    expect(result.problems[0]).toMatch(/no ai key/i);
    // And nothing was sent, which is the point of checking first.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
