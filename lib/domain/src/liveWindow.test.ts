import { describe, expect, it } from "vitest";
import { liveWindow, JOIN_OPENS_BEFORE_MS, ON_TIME_GRACE_MS } from "./liveWindow";

const START = new Date("2026-09-10T14:00:00Z");
const startMs = START.getTime();
const session = { startsAt: START, durationMins: 60 };

describe("liveWindow", () => {
  it("is closed well before the class", () => {
    const w = liveWindow(session, startMs - 60 * 60 * 1000);
    expect(w.state).toBe("before");
    expect(w.canJoin).toBe(false);
    expect(w.msUntilOpen).toBe(60 * 60 * 1000 - JOIN_OPENS_BEFORE_MS);
  });

  it("opens exactly when the client says it does — the T-15/T-5 bug", () => {
    // The old client offered the button at T-15 while the server refused until
    // T-5. Both now read this one function.
    const atOpen = liveWindow(session, startMs - JOIN_OPENS_BEFORE_MS);
    expect(atOpen.canJoin).toBe(true);
    expect(atOpen.state).toBe("open");

    const oneMsEarlier = liveWindow(session, startMs - JOIN_OPENS_BEFORE_MS - 1);
    expect(oneMsEarlier.canJoin).toBe(false);
  });

  it("counts an early join as on time", () => {
    const w = liveWindow(session, startMs - 2 * 60 * 1000);
    expect(w.canJoin).toBe(true);
    expect(w.countsAsOnTime).toBe(true);
  });

  it("stops counting as on time after the grace window", () => {
    const justInside = liveWindow(session, startMs + ON_TIME_GRACE_MS);
    expect(justInside.countsAsOnTime).toBe(true);

    const justOutside = liveWindow(session, startMs + ON_TIME_GRACE_MS + 1);
    expect(justOutside.countsAsOnTime).toBe(false);
    expect(justOutside.canJoin).toBe(true); // still joinable, just not on time
    expect(justOutside.state).toBe("live");
  });

  it("closes once the class has ended", () => {
    const w = liveWindow(session, startMs + 61 * 60 * 1000);
    expect(w.state).toBe("ended");
    expect(w.canJoin).toBe(false);
  });

  it("counts down to the late mark so the UI can warn before it passes", () => {
    const w = liveWindow(session, startMs + 60 * 1000);
    expect(w.msUntilLateMark).toBe(ON_TIME_GRACE_MS - 60 * 1000);
  });

  it("handles an unscheduled session without throwing", () => {
    const w = liveWindow({ startsAt: null, durationMins: 60 }, startMs);
    expect(w.state).toBe("unscheduled");
    expect(w.canJoin).toBe(false);
    expect(w.startsAtMs).toBeNull();
  });

  it("accepts an ISO string, which is what the API returns", () => {
    const w = liveWindow({ startsAt: START.toISOString(), durationMins: 60 }, startMs);
    expect(w.state).toBe("live");
  });

  it("treats an unparseable date as unscheduled rather than NaN", () => {
    const w = liveWindow({ startsAt: "not a date", durationMins: 60 }, startMs);
    expect(w.state).toBe("unscheduled");
  });
});
