import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

vi.mock("./logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

/**
 * Asking again, instead of asking an admin to.
 *
 * The screen said "the plan came back with no objectives" and offered a button.
 * Which is to say: the Lab knew the answer was unusable, knew that asking again
 * would probably fix it, and handed that job to a person — without telling them
 * that was the job — who was standing in front of a cohort at the time.
 *
 * It asks for itself now. Three times, and no more, because this is a paid call
 * and a loop with no end on it is a bill nobody can explain.
 */

const GOOD = {
  objectives: [
    { text: "Say something true within the hour", note: "Watch who they address first." },
    { text: "Hold a line under pressure", note: "Watch for over-claiming." },
  ],
  beats: [
    { atMinute: 0, scope: "all", title: "The photographs run", content: "It is on the front page.", responsePrompt: "First statement?", responseMinutes: 8 },
    { atMinute: 30, scope: "all", title: "A minister comments", content: "An inquiry is called for.", responsePrompt: "What now?", responseMinutes: 8 },
  ],
};

let server: Server;
let replies: unknown[] = [];
let asked = 0;

beforeAll(async () => {
  server = createServer((_req, res) => {
    const input = replies[Math.min(asked, replies.length - 1)];
    asked += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "submit_plan", input }] }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => { await new Promise((r) => server.close(r)); });

const plan = async () => {
  const { generateGroupPlan } = await import("./simulationAi");
  return generateGroupPlan({
    openingBrief: "A leak, and three days of silence.",
    teams: [{ id: "operator", name: "The operator", roleName: "Lead" }],
    objective: "Handle it",
    durationMinutes: 45,
  });
};

describe("planning asks again for itself", () => {
  it("takes a usable plan on the first attempt and stops there", async () => {
    replies = [GOOD]; asked = 0;
    const result = await plan();
    expect(result.ok).toBe(true);
    expect(asked, "it asked more than once for an answer it could use").toBe(1);
  });

  it("asks again when the first answer is unusable, and succeeds", async () => {
    // The actual fault, as it reached the Lab: an empty list where four
    // objectives should be.
    replies = [{ objectives: [], beats: GOOD.beats }, GOOD]; asked = 0;
    const result = await plan();
    expect(result.ok, "a second ask would have fixed this and was never made").toBe(true);
    expect(asked).toBe(2);
  });

  it("gives up after three, rather than asking forever", async () => {
    replies = [{ objectives: [], beats: [] }]; asked = 0;
    const result = await plan();
    expect(result.ok).toBe(false);
    expect(asked, "a paid call in a loop with no end on it").toBe(3);
    expect((result as { error: string }).error).toContain("3 times");
  });

  it("does not ask three times about a key that was rejected", async () => {
    // Asking again cannot mend a credential, a retired model or a timeout.
    // Spending three calls to say the same thing three times is just slower.
    const was = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    asked = 0;
    const result = await plan();
    process.env.ANTHROPIC_API_KEY = was;

    expect(result.ok).toBe(false);
    expect(asked, "it kept asking about something asking cannot fix").toBe(0);
  });
});
