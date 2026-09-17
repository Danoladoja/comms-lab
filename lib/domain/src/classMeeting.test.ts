import { describe, expect, it } from "vitest";
import {
  eventWindow,
  eventSummary,
  eventDescription,
  meetLinkFrom,
  conferenceProgress,
  meetingProblem,
} from "./classMeeting";

describe("when the event runs", () => {
  it("ends the class after its own length", () => {
    const w = eventWindow(new Date("2026-09-24T14:00:00Z"), 60);
    expect(w.startIso).toBe("2026-09-24T14:00:00.000Z");
    expect(w.endIso).toBe("2026-09-24T15:00:00.000Z");
  });

  it("refuses to create an event that ends before it starts", () => {
    // Google rejects those with a message that explains nothing, so a module
    // with a nonsense length is given an hour rather than a failure.
    for (const bad of [0, -30, Number.NaN]) {
      const w = eventWindow(new Date("2026-09-24T14:00:00Z"), bad);
      expect(new Date(w.endIso).getTime()).toBeGreaterThan(new Date(w.startIso).getTime());
    }
  });
});

describe("what the event says", () => {
  it("names the programme, because a calendar holds every cohort at once", () => {
    expect(eventSummary("AfriEnergy Comms Lab", "Energy Fundamentals"))
      .toBe("AfriEnergy Comms Lab — Energy Fundamentals");
  });

  it("copes when one of them is missing", () => {
    expect(eventSummary("", "Energy Fundamentals")).toBe("Energy Fundamentals");
    expect(eventSummary("AfriEnergy Comms Lab", "  ")).toBe("AfriEnergy Comms Lab — Class");
  });

  it("warns whoever opens the event not to touch the link", () => {
    // Somebody tidying a calendar is one click from removing the conference,
    // and the consequence — attendance silently stopping — is invisible there.
    const d = eventDescription({ moduleUrl: "https://energycommslab.africa/classroom/12" });
    expect(d).toMatch(/same one the Lab shows learners/i);
    expect(d).toMatch(/stop attendance being recorded/i);
    expect(d).toContain("https://energycommslab.africa/classroom/12");
  });

  it("still reads properly with no link to give", () => {
    expect(eventDescription({ moduleUrl: null })).not.toMatch(/undefined|null/);
  });
});

describe("reading the joining link back", () => {
  const ready = {
    entryPoints: [
      { entryPointType: "more", uri: "https://tel.meet/abc-defg-hij" },
      { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" },
    ],
  };

  it("takes the video entry, not the first one", () => {
    // The dial-in entry comes first often enough that taking [0] would store a
    // phone URL as the class's joining link.
    expect(meetLinkFrom(ready)).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("returns nothing rather than something wrong", () => {
    expect(meetLinkFrom(null)).toBeNull();
    expect(meetLinkFrom({})).toBeNull();
    expect(meetLinkFrom({ entryPoints: [] })).toBeNull();
    expect(meetLinkFrom({ entryPoints: [{ entryPointType: "phone", uri: "tel:+123" }] })).toBeNull();
  });

  it("ignores a video entry that is not a Meet link", () => {
    // A calendar can carry a Zoom or Teams conference. Storing one as the Meet
    // link would make every attendance read afterwards ask about nothing.
    expect(meetLinkFrom({ entryPoints: [{ entryPointType: "video", uri: "https://zoom.us/j/123" }] }))
      .toBeNull();
  });
});

describe("Google still minting the conference", () => {
  it("knows a finished one", () => {
    expect(conferenceProgress({ entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/a-b-c" }] }))
      .toBe("ready");
  });

  it("knows one still being made", () => {
    // The event returns immediately with no link at all. Calling that a failure
    // is how an admin presses the button again and books two meetings for one
    // class.
    expect(conferenceProgress({ createRequest: { status: { statusCode: "pending" } } })).toBe("pending");
  });

  it("knows one Google gave up on", () => {
    expect(conferenceProgress({ createRequest: { status: { statusCode: "failure" } } })).toBe("failed");
  });

  it("knows an event that was never asked for one", () => {
    expect(conferenceProgress(null)).toBe("none");
    expect(conferenceProgress(undefined)).toBe("none");
  });
});

describe("refusing to make a meeting", () => {
  const ok = {
    startsAt: new Date("2026-09-24T14:00:00Z"),
    calendarConnected: true,
    calendarAuthorised: true,
    existingMeetUrl: null,
  };

  it("allows the ordinary case", () => {
    expect(meetingProblem(ok)).toBeNull();
  });

  it("names reconnecting when the permission was never granted", () => {
    // The commonest failure: a connection made before this feature existed has
    // every other permission and will fail only at the moment of use.
    const said = meetingProblem({ ...ok, calendarAuthorised: false });
    expect(said).toMatch(/before the Lab could create meetings/i);
    expect(said).toMatch(/Press Reconnect/i);
    expect(said).toMatch(/one extra permission/i);
  });

  it("asks for a date before anything else", () => {
    expect(meetingProblem({ ...ok, startsAt: null })).toMatch(/date and time first/i);
  });

  it("will not quietly replace a link learners may already hold", () => {
    // Replacing a link that is already in forty-five calendars is precisely how
    // this cohort lost three weeks of attendance. Refused, and said out loud.
    const said = meetingProblem({ ...ok, existingMeetUrl: "https://meet.google.com/old-link-xyz" });
    expect(said).toMatch(/already has a meeting link/i);
    expect(said).toMatch(/empty room/i);
  });

  it("treats a blank link as no link", () => {
    expect(meetingProblem({ ...ok, existingMeetUrl: "   " })).toBeNull();
  });

  it("says when Google is not connected at all", () => {
    expect(meetingProblem({ ...ok, calendarConnected: false })).toMatch(/not connected/i);
  });
});
