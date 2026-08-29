import { describe, expect, it } from "vitest";
import {
  meetCodeFrom,
  recordingCheckDue,
  sessionsDueForRecording,
  videoDetailsFor,
  youtubeUrlFor,
  RECORDING_SEARCH_DELAY_MS,
  RECORDING_SEARCH_WINDOW_MS,
  RECORDING_RETRY_INTERVAL_MS,
  RECORDING_MAX_ATTEMPTS,
  type SessionRecordingState,
} from "./recordingPipeline";

const NOW = Date.UTC(2026, 8, 25, 18, 0, 0);
const HOUR = 60 * 60 * 1000;

/** A class that finished an hour ago and has no recording yet. */
function state(overrides: Partial<SessionRecordingState> = {}): SessionRecordingState {
  return {
    sessionId: 1,
    startsAtMs: NOW - 2 * HOUR,
    durationMins: 60,
    meetUrl: "https://meet.google.com/abc-defg-hij",
    recordingUrl: null,
    status: "pending",
    attempts: 0,
    lastCheckedAtMs: null,
    ...overrides,
  };
}

describe("meetCodeFrom", () => {
  it("pulls the code out of a Meet link", () => {
    expect(meetCodeFrom("https://meet.google.com/abc-defg-hij")).toBe("abc-defg-hij");
  });

  it("tolerates www, query strings and stray whitespace", () => {
    expect(meetCodeFrom("  https://www.meet.google.com/abc-defg-hij?authuser=0 ")).toBe("abc-defg-hij");
  });

  it("lower-cases the code", () => {
    expect(meetCodeFrom("https://meet.google.com/ABC-DEFG-HIJ")).toBe("abc-defg-hij");
  });

  it("returns null for a Zoom link rather than guessing", () => {
    expect(meetCodeFrom("https://zoom.us/j/1234567890")).toBeNull();
  });

  it("returns null for a Meet link with no code", () => {
    expect(meetCodeFrom("https://meet.google.com/")).toBeNull();
  });

  it("returns null for a malformed code", () => {
    expect(meetCodeFrom("https://meet.google.com/not-a-real-code-at-all")).toBeNull();
  });

  it("returns null for empty and unparseable input", () => {
    expect(meetCodeFrom(null)).toBeNull();
    expect(meetCodeFrom("")).toBeNull();
    expect(meetCodeFrom("meet.google.com/abc-defg-hij")).toBeNull(); // no scheme
  });
});

describe("recordingCheckDue", () => {
  it("checks a class that ended over the settling delay ago", () => {
    expect(recordingCheckDue(state(), NOW).due).toBe(true);
  });

  it("waits until the class has actually finished", () => {
    const s = state({ startsAtMs: NOW - 30 * 60 * 1000 }); // still running
    expect(recordingCheckDue(s, NOW)).toEqual({ due: false, reason: "not-ended" });
  });

  it("gives Meet time to write the file before looking", () => {
    const endsAt = NOW - 60 * 1000;
    const s = state({ startsAtMs: endsAt - 60 * 60 * 1000 });
    expect(recordingCheckDue(s, NOW).reason).toBe("too-soon");

    const later = NOW + RECORDING_SEARCH_DELAY_MS;
    expect(recordingCheckDue(s, later).due).toBe(true);
  });

  it("leaves a session alone once it has a recording", () => {
    const s = state({ recordingUrl: "https://youtu.be/xyz" });
    expect(recordingCheckDue(s, NOW)).toEqual({ due: false, reason: "already-have-one" });
  });

  it("never overwrites a link someone pasted by hand", () => {
    expect(recordingCheckDue(state({ status: "manual" }), NOW).reason).toBe("already-have-one");
  });

  it("skips a session with no Meet link", () => {
    expect(recordingCheckDue(state({ meetUrl: null }), NOW).reason).toBe("no-meet-code");
  });

  it("skips a session whose link is not a Meet room", () => {
    expect(recordingCheckDue(state({ meetUrl: "https://zoom.us/j/1" }), NOW).reason).toBe("no-meet-code");
  });

  it("skips an unscheduled session", () => {
    expect(recordingCheckDue(state({ startsAtMs: null }), NOW).reason).toBe("not-ended");
  });

  it("backs off between attempts", () => {
    const s = state({ lastCheckedAtMs: NOW - 60 * 1000, attempts: 1 });
    expect(recordingCheckDue(s, NOW).reason).toBe("backing-off");

    const afterBackoff = NOW + RECORDING_RETRY_INTERVAL_MS;
    expect(recordingCheckDue(s, afterBackoff).due).toBe(true);
  });

  it("gives up after too many attempts", () => {
    const s = state({ attempts: RECORDING_MAX_ATTEMPTS });
    expect(recordingCheckDue(s, NOW).reason).toBe("gave-up");
  });

  it("gives up once marked failed", () => {
    expect(recordingCheckDue(state({ status: "failed" }), NOW).reason).toBe("gave-up");
  });

  it("stops looking after the search window closes", () => {
    const wayLater = NOW + RECORDING_SEARCH_WINDOW_MS + HOUR;
    expect(recordingCheckDue(state(), wayLater).reason).toBe("window-closed");
  });
});

describe("sessionsDueForRecording", () => {
  it("returns only what is due, oldest class first", () => {
    const sessions = [
      state({ sessionId: 3, startsAtMs: NOW - 2 * HOUR }),
      state({ sessionId: 1, startsAtMs: NOW - 10 * HOUR }),
      state({ sessionId: 2, startsAtMs: NOW - 5 * HOUR }),
      state({ sessionId: 4, recordingUrl: "https://youtu.be/x" }), // done
      state({ sessionId: 5, meetUrl: null }), // not a Meet class
    ];
    expect(sessionsDueForRecording(sessions, NOW).map((s) => s.sessionId)).toEqual([1, 2, 3]);
  });

  it("returns nothing when there is nothing to do", () => {
    expect(sessionsDueForRecording([state({ recordingUrl: "https://youtu.be/x" })], NOW)).toEqual([]);
  });
});

describe("videoDetailsFor", () => {
  it("names the video after the programme and the module", () => {
    const d = videoDetailsFor({
      programTitle: "Strategic Energy Communications",
      sessionTitle: "Rewrite for radio",
      startsAtMs: NOW,
      instructorName: "Amina Ndlovu",
    });
    expect(d.title).toBe("Strategic Energy Communications — Rewrite for radio");
    expect(d.description).toContain("Led by Amina Ndlovu.");
    expect(d.description).toContain("Recorded 2026-09-25.");
    expect(d.description).toContain("unlisted");
  });

  it("keeps the title inside YouTube's 100-character limit", () => {
    const d = videoDetailsFor({
      programTitle: "A Programme With A Very Long Name Indeed For Testing Purposes",
      sessionTitle: "A module title that is also far too long to fit alongside all of that",
      startsAtMs: NOW,
    });
    expect(d.title.length).toBeLessThanOrEqual(100);
  });

  it("copes when even the module title alone is too long", () => {
    const d = videoDetailsFor({
      programTitle: "P".repeat(120),
      sessionTitle: "S".repeat(120),
      startsAtMs: NOW,
    });
    expect(d.title.length).toBeLessThanOrEqual(101);
  });

  it("strips angle brackets, which YouTube rejects", () => {
    const d = videoDetailsFor({
      programTitle: "Energy <Comms>",
      sessionTitle: "The <lede>",
      startsAtMs: null,
    });
    expect(d.title).not.toMatch(/[<>]/);
  });

  it("omits the instructor and date lines when they are unknown", () => {
    const d = videoDetailsFor({
      programTitle: "Programme",
      sessionTitle: "Module",
      startsAtMs: null,
    });
    expect(d.description).not.toContain("Led by");
    expect(d.description).not.toContain("Recorded");
  });
});

describe("youtubeUrlFor", () => {
  it("builds a watch URL the existing player understands", () => {
    expect(youtubeUrlFor("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });
});
