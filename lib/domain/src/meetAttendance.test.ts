import { describe, expect, it } from "vitest";
import {
  normaliseMeetingCode,
  readCallEvents,
  secondsByEmail,
  reportWindow,
  reconcileSeconds,
} from "./meetAttendance";

/** One `call_ended` item in the shape the Reports API actually returns. */
const call = (over: {
  email?: string;
  seconds?: number | string;
  code?: string;
  time?: string;
  name?: string;
  identifierType?: string | null;
}) => ({
  id: { time: over.time ?? "2026-09-10T15:05:00.000Z" },
  events: [{
    type: "call",
    name: "call_ended",
    parameters: [
      { name: "identifier", value: over.email ?? "amina@example.test" },
      ...(over.identifierType === null
        ? []
        : [{ name: "identifier_type", value: over.identifierType ?? "email_address" }]),
      { name: "display_name", value: over.name ?? "Amina Bello" },
      { name: "duration_seconds", intValue: String(over.seconds ?? 3240) },
      { name: "meeting_code", value: over.code ?? "abcmnopxyz" },
    ],
  }],
});

describe("meeting codes", () => {
  it("matches a URL's code against a report's", () => {
    // Google writes the same code as abc-mnop-xyz in a link and abcmnopxyz in
    // a report. Compared raw they match nothing, and matching nothing looks
    // exactly like a class nobody attended.
    expect(normaliseMeetingCode("abc-mnop-xyz")).toBe("abcmnopxyz");
    expect(normaliseMeetingCode("ABC-MNOP-XYZ")).toBe("abcmnopxyz");
    expect(normaliseMeetingCode("abcmnopxyz")).toBe("abcmnopxyz");
    expect(normaliseMeetingCode(null)).toBe("");
  });
});

describe("reading what Google returned", () => {
  it("takes the email, the name and the seconds", () => {
    const [e] = readCallEvents({ items: [call({})] });
    expect(e).toMatchObject({
      email: "amina@example.test",
      displayName: "Amina Bello",
      durationSeconds: 3240,
      meetingCode: "abcmnopxyz",
    });
  });

  it("lower-cases the email, because matching is done on it", () => {
    const [e] = readCallEvents({ items: [call({ email: "Amina@Example.TEST" })] });
    expect(e.email).toBe("amina@example.test");
  });

  it("skips anybody there is nobody to credit", () => {
    // Dial-in numbers and anonymous guests have no account to match to.
    const events = readCallEvents({
      items: [
        call({ email: "+2348012345678", identifierType: "phone_number" }),
        call({ email: "guest", identifierType: null }),
        call({ email: "real@example.test" }),
      ],
    });
    expect(events.map((e) => e.email)).toEqual(["real@example.test"]);
  });

  it("survives a report with holes in it", () => {
    // One odd row must not cost a cohort its attendance, so everything here is
    // skipped rather than thrown.
    expect(readCallEvents(null)).toEqual([]);
    expect(readCallEvents({})).toEqual([]);
    expect(readCallEvents({ items: "not an array" })).toEqual([]);
    expect(readCallEvents({ items: [{}, { events: [] }, { events: [{ name: "call_started" }] }] })).toEqual([]);
    expect(readCallEvents({ items: [{ events: [{ name: "call_ended" }] }] })).toEqual([]);
  });

  it("treats a missing or absurd duration as nothing, not as a guess", () => {
    expect(readCallEvents({ items: [call({ seconds: "" })] })[0].durationSeconds).toBe(0);
    expect(readCallEvents({ items: [call({ seconds: "not a number" })] })[0].durationSeconds).toBe(0);
    expect(readCallEvents({ items: [call({ seconds: -50 })] })[0].durationSeconds).toBe(0);
    // A device left connected overnight has reported a fortnight. Credited
    // whole, it would complete every class in the programme at once.
    expect(readCallEvents({ items: [call({ seconds: 14 * 24 * 3600 })] })[0].durationSeconds)
      .toBe(24 * 60 * 60);
  });
});

describe("adding it up", () => {
  const WINDOW = { startMs: Date.parse("2026-09-10T14:00:00Z"), endMs: Date.parse("2026-09-10T19:00:00Z") };

  it("sums a learner whose line dropped", () => {
    // Two stints, one class. Taking the higher would lose the half they were
    // reconnecting through.
    const events = readCallEvents({
      items: [
        call({ email: "amina@example.test", seconds: 1500 }),
        call({ email: "amina@example.test", seconds: 1700, time: "2026-09-10T15:30:00.000Z" }),
      ],
    });
    expect(secondsByEmail(events, "abc-mnop-xyz", WINDOW).get("amina@example.test")).toBe(3200);
  });

  it("keeps each person separate", () => {
    const events = readCallEvents({
      items: [call({ email: "a@x.test", seconds: 600 }), call({ email: "b@x.test", seconds: 900 })],
    });
    const totals = secondsByEmail(events, "abc-mnop-xyz", WINDOW);
    expect(totals.get("a@x.test")).toBe(600);
    expect(totals.get("b@x.test")).toBe(900);
  });

  it("ignores a different room", () => {
    // The facilitator's other meeting, running the same afternoon.
    const events = readCallEvents({ items: [call({ code: "zzz-zzzz-zzz" })] });
    expect(secondsByEmail(events, "abc-mnop-xyz", WINDOW).size).toBe(0);
  });

  it("ignores last week's class in the same room", () => {
    // A Lab room is reused week after week. Without the window, week one's
    // attendance would credit week six.
    const events = readCallEvents({ items: [call({ time: "2026-09-03T15:05:00.000Z" })] });
    expect(secondsByEmail(events, "abc-mnop-xyz", WINDOW).size).toBe(0);
  });

  it("keeps a stint whose timestamp is unreadable", () => {
    // The code and the query window have already narrowed this. Throwing it
    // away would lose somebody's attendance over a formatting quirk.
    const events = readCallEvents({ items: [call({ time: "not a date" })] });
    expect(secondsByEmail(events, "abc-mnop-xyz", WINDOW).get("amina@example.test")).toBe(3240);
  });
});

describe("the window asked of Google", () => {
  it("reaches past the end of the class", () => {
    // The event is stamped when somebody *leaves*, so the last person out of a
    // class that overran is recorded well after the scheduled finish. Too
    // narrow a window drops exactly the people who stayed to the end.
    const start = Date.parse("2026-09-10T15:00:00Z");
    const w = reportWindow(start, 60);
    expect(w.startMs).toBeLessThan(start);
    expect(w.endMs).toBeGreaterThan(start + 60 * 60 * 1000 + 2 * 60 * 60 * 1000);
  });
});

describe("reconciling with what the app measured", () => {
  it("takes the higher, so nothing already credited is taken away", () => {
    expect(reconcileSeconds(600, 3200)).toBe(3200);
    // The app saw more than Google — somebody with the page open who joined
    // the call late. They did not attend twice; they attended once.
    expect(reconcileSeconds(3200, 600)).toBe(3200);
    expect(reconcileSeconds(0, 0)).toBe(0);
    expect(reconcileSeconds(-5, 100)).toBe(100);
  });
});
