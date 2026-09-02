import { describe, expect, it } from "vitest";
import {
  canRegisterForLiveSession,
  liveSessionCallToAction,
  liveSessionState,
  mayJoinLiveSession,
  maySeeLiveSessionRecording,
  showsInLiveSessionList,
  sortLiveSessions,
} from "./liveSession";

const START = Date.parse("2026-09-10T17:00:00Z");
const at = (mins: number) => START + mins * 60_000;

const session = (over: Record<string, unknown> = {}) => ({
  startsAt: new Date(START).toISOString(),
  durationMins: 60,
  status: "published",
  capacity: 0,
  recordingUrl: null as string | null,
  ...over,
});

describe("what is listed", () => {
  it("lists only a published session", () => {
    expect(showsInLiveSessionList("published")).toBe(true);
    expect(showsInLiveSessionList("draft")).toBe(false);
    expect(showsInLiveSessionList("cancelled")).toBe(false);
  });
});

describe("where a session is in its life", () => {
  it("is upcoming well before it starts", () => {
    expect(liveSessionState(session(), at(-120))).toBe("upcoming");
  });

  it("is live once the room opens, and while it runs", () => {
    // The room opens ten minutes early, as it does for a module.
    expect(liveSessionState(session(), at(-5))).toBe("live");
    expect(liveSessionState(session(), at(30))).toBe("live");
  });

  it("is past once it has finished", () => {
    expect(liveSessionState(session(), at(61))).toBe("past");
  });

  it("is unscheduled when it is announced without a date", () => {
    expect(liveSessionState(session({ startsAt: null }), at(0))).toBe("unscheduled");
  });

  it("is cancelled whatever the clock says", () => {
    expect(liveSessionState(session({ status: "cancelled" }), at(-120))).toBe("cancelled");
  });
});

describe("registering", () => {
  it("opens as soon as the session is published, long before the date", () => {
    // The whole point: the call goes out, people put their names down.
    expect(canRegisterForLiveSession(session(), 0, false, at(-10_000)).allowed).toBe(true);
  });

  it("is still open once it has started, because that is when people find it", () => {
    expect(canRegisterForLiveSession(session(), 0, false, at(20)).allowed).toBe(true);
  });

  it("closes once it has finished", () => {
    const outcome = canRegisterForLiveSession(session(), 0, false, at(90));
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/finished/i);
  });

  it("says so rather than silently doing nothing when you already registered", () => {
    expect(canRegisterForLiveSession(session(), 1, true, at(-60))).toEqual({
      allowed: false, reason: "You are already registered.",
    });
  });

  it("refuses for a draft or a cancelled session", () => {
    expect(canRegisterForLiveSession(session({ status: "draft" }), 0, false, at(-60)).allowed).toBe(false);
    expect(canRegisterForLiveSession(session({ status: "cancelled" }), 0, false, at(-60)).reason).toMatch(/cancelled/i);
  });

  it("treats no capacity as no limit, which is the usual case", () => {
    expect(canRegisterForLiveSession(session({ capacity: 0 }), 5000, false, at(-60)).allowed).toBe(true);
  });

  it("turns people away once a capped session is full", () => {
    const outcome = canRegisterForLiveSession(session({ capacity: 50 }), 50, false, at(-60));
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toMatch(/full/i);
  });

  it("takes people right up to the cap", () => {
    expect(canRegisterForLiveSession(session({ capacity: 50 }), 49, false, at(-60)).allowed).toBe(true);
  });
});

describe("the joining link", () => {
  it("appears only when the room is open", () => {
    // Handing it out a week early guarantees somebody wanders in mid sound check.
    expect(mayJoinLiveSession(session(), true, at(-120))).toBe(false);
    expect(mayJoinLiveSession(session(), true, at(-5))).toBe(true);
    expect(mayJoinLiveSession(session(), true, at(30))).toBe(true);
    expect(mayJoinLiveSession(session(), true, at(90))).toBe(false);
  });

  it("never goes to somebody who did not register", () => {
    expect(mayJoinLiveSession(session(), false, at(0))).toBe(false);
  });

  it("never goes out for a draft", () => {
    expect(mayJoinLiveSession(session({ status: "draft" }), true, at(0))).toBe(false);
  });
});

describe("the recording", () => {
  const recorded = session({ recordingUrl: "https://youtu.be/x" });

  it("goes to everyone who registered", () => {
    expect(maySeeLiveSessionRecording(recorded, true)).toBe(true);
  });

  it("goes to somebody who registered and then missed it", () => {
    // A power cut is not misconduct, and withholding the replay from the
    // people most likely to need it would be the wrong lesson.
    expect(maySeeLiveSessionRecording(recorded, true)).toBe(true);
  });

  it("does not go to somebody who never registered", () => {
    expect(maySeeLiveSessionRecording(recorded, false)).toBe(false);
  });

  it("is nothing to offer before one exists", () => {
    expect(maySeeLiveSessionRecording(session(), true)).toBe(false);
  });
});

describe("what the button says", () => {
  it("asks for a registration, then confirms it", () => {
    expect(liveSessionCallToAction("upcoming", false)).toBe("Register");
    expect(liveSessionCallToAction("upcoming", true)).toBe("You are registered");
  });

  it("lets a registered person straight in when it is live", () => {
    expect(liveSessionCallToAction("live", true)).toBe("Join now");
    expect(liveSessionCallToAction("live", false)).toBe("Register and join");
  });

  it("offers the recording afterwards, to the people who signed up", () => {
    expect(liveSessionCallToAction("past", true)).toBe("Watch the recording");
    expect(liveSessionCallToAction("past", false)).toBe("Finished");
  });
});

describe("ordering a page of them", () => {
  it("puts what is coming soonest first, and what has been most recent first", () => {
    const list = [
      session({ startsAt: new Date(at(-10_000)).toISOString() }),
      session({ startsAt: new Date(at(20_000)).toISOString() }),
      session({ startsAt: new Date(at(10_000)).toISOString() }),
      session({ startsAt: new Date(at(-500)).toISOString() }),
    ];
    const { upcoming, past } = sortLiveSessions(list, at(0));
    expect(upcoming.map((s) => s.startsAt)).toEqual([
      new Date(at(10_000)).toISOString(), new Date(at(20_000)).toISOString(),
    ]);
    expect(past.map((s) => s.startsAt)).toEqual([
      new Date(at(-500)).toISOString(), new Date(at(-10_000)).toISOString(),
    ]);
  });

  it("keeps an undated one among what is coming, at the end", () => {
    const { upcoming } = sortLiveSessions([
      session({ startsAt: null }),
      session({ startsAt: new Date(at(1000)).toISOString() }),
    ], at(0));
    expect(upcoming[0].startsAt).not.toBeNull();
    expect(upcoming[1].startsAt).toBeNull();
  });
});
