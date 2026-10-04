import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { modelConcern } from "./anthropic";

/**
 * The model name is a setting with an expiry date on it, and nothing in the Lab
 * knew that.
 *
 * `claude-sonnet-4-5` was the default in this file. Anthropic deprecated it on
 * 30 September 2026 and stops serving it on 30 November 2026, after which every
 * call returns a 404 — which means no scenario, no debrief, no draft help on a
 * learner's task, and a Studio that looks broken rather than out of date. One
 * line, a date nobody had written down, and a cohort in the room.
 *
 * These tests pin the two sentences worth having: one before the date, which is
 * a warning somebody can act on, and one after it, which explains an outage
 * that has already started.
 */

const BEFORE = Date.UTC(2026, 9, 3);  // 3 October 2026
const AFTER = Date.UTC(2026, 11, 1);  // 1 December 2026

describe("what is worth saying about the model", () => {
  it("says nothing about a model that is current", () => {
    expect(modelConcern("claude-sonnet-5-5", BEFORE)).toBeNull();
    expect(modelConcern("claude-opus-5-5", BEFORE)).toBeNull();
    expect(modelConcern("claude-haiku-4-5-20251001", BEFORE)).toBeNull();
  });

  it("warns, with the date, while a deprecated model still works", () => {
    const said = modelConcern("claude-sonnet-4-5", BEFORE);
    expect(said).toContain("30 November 2026");
    expect(said).toContain("ANTHROPIC_MODEL");
    expect(said).toContain("claude-sonnet-5-5");
    // Future tense: it has not happened yet, and a warning that reads as an
    // outage sends somebody looking for a fault that is not there.
    expect(said).toContain("stops being served");
  });

  it("explains the outage once the date has passed", () => {
    const said = modelConcern("claude-sonnet-4-5", AFTER);
    expect(said).toContain("stopped being served");
    expect(said).toContain("will fail");
  });

  it("recognises a dated model name as well as its alias", () => {
    expect(modelConcern("claude-sonnet-4-5-20250929", BEFORE)).not.toBeNull();
  });

  it("knows the models that are already gone", () => {
    for (const gone of [
      "claude-3-5-sonnet-20241022",
      "claude-3-7-sonnet-20250219",
      "claude-sonnet-4-20250514",
      "claude-opus-4-1-20250805",
      "claude-3-opus-20240229",
    ]) {
      expect(modelConcern(gone, BEFORE), `${gone} is retired and should be named`)
        .toContain("stopped being served");
    }
  });

  it("does not mistake one Sonnet for another", () => {
    // claude-sonnet-4-5 and claude-sonnet-4-20250514 retire on different dates,
    // and a prefix match that caught the wrong one would print the wrong date.
    expect(modelConcern("claude-sonnet-4-5", BEFORE)).toContain("30 November 2026");
    expect(modelConcern("claude-sonnet-4-20250514", BEFORE)).toContain("stopped being served");
  });
});

/**
 * A reply that ran out of room.
 *
 * The quietest failure in the file. A reply stopped at the token ceiling comes
 * back 200, with a tool_use block on it, and with an `input` — just an
 * incomplete one, because the JSON was mid-sentence when the budget ran out. So
 * it reached the validators looking like a bad answer and was reported as one:
 * "the plan came back with no objectives", when the plan had come back with
 * nowhere to go.
 *
 * Trying again does not fix a ceiling that is too low, so saying the wrong
 * thing here costs an afternoon of pressing a button.
 */
describe("when the AI runs out of room", () => {
  const server = { url: "", close: async () => {} };

  beforeAll(async () => {
    const { createServer } = await import("node:http");
    const s = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      // What the API actually sends: a 200, a partial tool call, and the one
      // field that says it was cut off.
      res.end(JSON.stringify({
        stop_reason: "max_tokens",
        usage: { output_tokens: 4000 },
        content: [{ type: "tool_use", name: "submit_plan", input: { objectives: [{ text: "Half a thou" }] } }],
      }));
    });
    await new Promise<void>((r) => s.listen(0, r));
    const port = (s.address() as { port: number }).port;
    server.url = `http://127.0.0.1:${port}`;
    server.close = () => new Promise<void>((r) => { s.close(() => r()); });
  });

  afterAll(async () => { await server.close(); });

  it("says it ran out of room, rather than passing half an answer on", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    process.env.ANTHROPIC_BASE_URL = server.url;
    const { askClaude } = await import("./anthropic");

    const answer = await askClaude({
      system: "s", user: "u", toolName: "submit_plan", toolDescription: "d",
      schema: { type: "object" }, label: "test",
    });

    expect("error" in answer, "half an answer was passed on as an answer").toBe(true);
    expect((answer as { error: string }).error).toContain("ran out of room");
  });
});

/**
 * Every ceiling in the Studio, in one place.
 *
 * Three of these have now been found the same way: a reply ran out of room,
 * came back half-written, and was reported as a bad answer rather than as a
 * budget. Each time the fix was a number and each time it was found by
 * somebody standing in front of a cohort.
 *
 * So the numbers are asserted rather than left to be discovered. A ceiling is
 * a cap and not a spend — raising one costs nothing on the replies that
 * already fitted — so the only reason any of these is small is that nobody
 * looked at it.
 */
describe("what the Studio's calls are allowed to write", () => {
  it("gives the long answers room, and keeps the quick ones quick", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./simulationAi.ts", import.meta.url), "utf8"));

    const ceilings = [...source.matchAll(/toolName: "(\w+)"[\s\S]{0,900}?maxTokens: (\d+)/g)]
      .map(([, name, cap]) => [name, Number(cap)] as const);

    const expected: Record<string, number> = {
      // Written once, read closely, and the thing people wait for.
      submit_scenario: 8000,
      submit_plan: 8000,
      submit_debrief: 8000,
      submit_session_debrief: 8000,
      // Mid-session, with somebody watching for it. Short on purpose.
      submit_development: 1200,
    };

    for (const [name, cap] of ceilings) {
      expect(expected[name], `${name} has no agreed ceiling — add one here`).toBeDefined();
      expect(cap, `${name} is writing to a ceiling of ${cap}`).toBe(expected[name]);
    }
    // And every call named above is actually in the file.
    for (const name of Object.keys(expected)) {
      expect(ceilings.some(([n]) => n === name), `${name} was not found`).toBe(true);
    }
  });
});
