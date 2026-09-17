import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Reading what Google holds for a class.
 *
 * The failure to guard is the quiet one, again: a room the API does not
 * recognise, a conference from last week, a transcript still being written.
 * Each of those returns something that looks like an answer, and each means
 * something completely different to the person reading it.
 */

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { findHoldings } from "./meetApi";

const WINDOW = {
  accessToken: "token-not-a-real-one",
  meetCode: "abc-mnop-xyz",
  windowStartMs: Date.parse("2026-09-10T13:00:00Z"),
  windowEndMs: Date.parse("2026-09-10T18:00:00Z"),
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Answers each Meet call by the shape of its path. */
const server = (parts: {
  space?: unknown;
  conferences?: unknown;
  recordings?: unknown;
  transcripts?: unknown;
}) => vi.fn(async (input: unknown) => {
  const url = String(input);
  if (url.includes("/recordings")) return json(parts.recordings ?? {});
  if (url.includes("/transcripts")) return json(parts.transcripts ?? {});
  if (url.includes("/conferenceRecords?") || url.endsWith("/conferenceRecords")) {
    return json(parts.conferences ?? {});
  }
  return json(parts.space ?? { name: "spaces/xyz" });
});

const ONE_CONFERENCE = {
  conferenceRecords: [{ name: "conferenceRecords/c1", startTime: "2026-09-10T14:00:00Z" }],
};

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => { fetchSpy = vi.fn(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("what Google holds", () => {
  it("reports a finished recording and a finished transcript", async () => {
    vi.stubGlobal("fetch", server({
      conferences: ONE_CONFERENCE,
      recordings: { recordings: [{ state: "FILE_GENERATED", driveDestination: { file: "drive-1" } }] },
      transcripts: {
        transcripts: [{
          name: "conferenceRecords/c1/transcripts/t1",
          state: "FILE_GENERATED",
          docsDestination: { document: "doc-1", exportUri: "https://docs.google.com/document/d/doc-1/view" },
        }],
      },
    }));

    const held = await findHoldings(WINDOW);
    expect(held.conferences).toBe(1);
    expect(held.recordings).toHaveLength(1);
    expect(held.transcripts[0]).toMatchObject({
      state: "FILE_GENERATED",
      documentId: "doc-1",
      exportUri: "https://docs.google.com/document/d/doc-1/view",
    });
  });

  it("keeps a transcript that has not finished writing", async () => {
    // Unlike a recording, which would download as a stub, an unfinished
    // transcript is worth reporting: it is the proof that transcription was on,
    // which is usually the thing being asked. Dropping it would read as "nobody
    // ever started one" and send an admin to change a setting that is correct.
    vi.stubGlobal("fetch", server({
      conferences: ONE_CONFERENCE,
      transcripts: { transcripts: [{ name: "conferenceRecords/c1/transcripts/t1", state: "ENDED" }] },
    }));

    const held = await findHoldings(WINDOW);
    expect(held.transcripts).toHaveLength(1);
    expect(held.transcripts[0]).toMatchObject({ state: "ENDED", documentId: null });
  });

  it("ignores last week's class in the same room", async () => {
    // A Lab room is reused week after week. Without the window, week one's
    // transcript would be reported as this week's.
    vi.stubGlobal("fetch", server({
      conferences: {
        conferenceRecords: [{ name: "conferenceRecords/old", startTime: "2026-09-03T14:00:00Z" }],
      },
    }));

    const held = await findHoldings(WINDOW);
    expect(held.conferences).toBe(0);
    expect(held.transcripts).toHaveLength(0);
  });

  it("says nothing was found when the room is unknown", async () => {
    vi.stubGlobal("fetch", server({ space: {} }));
    const held = await findHoldings(WINDOW);
    expect(held).toEqual({ conferences: 0, recordings: [], transcripts: [] });
  });

  it("survives a conference with no transcripts key at all", async () => {
    vi.stubGlobal("fetch", server({ conferences: ONE_CONFERENCE, transcripts: {} }));
    const held = await findHoldings(WINDOW);
    expect(held.conferences).toBe(1);
    expect(held.transcripts).toEqual([]);
  });

  it("throws rather than reporting an empty room when Google refuses", async () => {
    // The distinction that matters most. A refused permission reported as
    // "nothing found" would have an admin turning on transcription that was
    // never off — the same mistake, in a new place, as the attendance one.
    fetchSpy.mockResolvedValue(new Response("no", { status: 403 }));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(findHoldings(WINDOW)).rejects.toThrow(/403/);
  });
});
