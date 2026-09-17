import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reading Google's attendance report.
 *
 * The failures worth guarding are the quiet ones. A filter that matches nothing
 * looks exactly like a class nobody attended — which is the failure this whole
 * feature exists to end — and a permission that was never granted must say so
 * rather than returning an empty room.
 */

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { fetchCallEvents } from "./meetReports";

const WINDOW = {
  accessToken: "token-not-a-real-one",
  startMs: Date.parse("2026-09-10T14:00:00Z"),
  endMs: Date.parse("2026-09-10T19:00:00Z"),
};

const call = (email: string, seconds: number) => ({
  id: { time: "2026-09-10T15:05:00.000Z" },
  events: [{
    name: "call_ended",
    parameters: [
      { name: "identifier", value: email },
      { name: "identifier_type", value: "email_address" },
      { name: "duration_seconds", intValue: String(seconds) },
      { name: "meeting_code", value: "abcmnopxyz" },
    ],
  }],
});

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => { fetchSpy = vi.fn(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("fetching the report", () => {
  it("asks only for call_ended, over the window it was given", async () => {
    fetchSpy.mockResolvedValue(reply({ items: [call("amina@x.test", 3000)] }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchCallEvents(WINDOW);
    expect(result).toMatchObject({ ok: true });

    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("eventName")).toBe("call_ended");
    expect(url.searchParams.get("startTime")).toBe(new Date(WINDOW.startMs).toISOString());
    expect(url.searchParams.get("endTime")).toBe(new Date(WINDOW.endMs).toISOString());
  });

  it("does not filter by meeting code in the query", async () => {
    // A filter that quietly matches nothing is indistinguishable from a class
    // nobody attended, and the Reports API is fussy about how a meeting code is
    // written. The window is one class wide, so the code is matched afterwards
    // where a mismatch can be seen.
    fetchSpy.mockResolvedValue(reply({ items: [] }));
    vi.stubGlobal("fetch", fetchSpy);

    await fetchCallEvents(WINDOW);
    const url = new URL(String(fetchSpy.mock.calls[0][0]));
    expect(url.searchParams.get("filters")).toBeNull();
  });

  it("follows the pages", async () => {
    fetchSpy
      .mockResolvedValueOnce(reply({ items: [call("a@x.test", 100)], nextPageToken: "page2" }))
      .mockResolvedValueOnce(reply({ items: [call("b@x.test", 200)] }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchCallEvents(WINDOW);
    expect(result.ok && result.events.map((e) => e.email)).toEqual(["a@x.test", "b@x.test"]);
    expect(new URL(String(fetchSpy.mock.calls[1][0])).searchParams.get("pageToken")).toBe("page2");
  });

  it("says what to do about a refused permission", async () => {
    // The likeliest failure by far: connected before this existed, so the
    // reports permission was never granted. "403" helps nobody.
    fetchSpy.mockResolvedValue(reply({ error: "forbidden" }, 403));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchCallEvents(WINDOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/administrator/i);
    expect(!result.ok && result.error).toMatch(/reconnect/i);
  });

  it("distinguishes a dead connection from a refused one", async () => {
    fetchSpy.mockResolvedValue(reply({}, 401));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchCallEvents(WINDOW);
    expect(!result.ok && result.error).toMatch(/reconnect google/i);
  });

  it("asks for patience rather than blaming the admin when Google is busy", async () => {
    for (const status of [429, 500, 503]) {
      fetchSpy.mockImplementation(async () => reply({}, status));
      vi.stubGlobal("fetch", fetchSpy);
      const result = await fetchCallEvents(WINDOW);
      expect(!result.ok && result.error).toMatch(/try again/i);
    }
  });

  it("refuses to return half a class", async () => {
    // Paging forever would be worse, but so would handing back a partial room:
    // the sync never lowers a number, so a half-read class stays half-read.
    // A fresh Response per call: a body can only be read once, and reusing one
    // would fail the test for a reason that has nothing to do with paging.
    fetchSpy.mockImplementation(async () =>
      reply({ items: [call("a@x.test", 100)], nextPageToken: "always" }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchCallEvents(WINDOW);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/not read in full/i);
    expect(!result.ok && result.error).toMatch(/nothing was written/i);
  });

  it("survives the network falling over", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchCallEvents(WINDOW);
    expect(!result.ok && result.error).toMatch(/could not reach google/i);
  });
});
