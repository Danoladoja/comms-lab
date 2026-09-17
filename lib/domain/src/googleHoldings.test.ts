import { describe, expect, it } from "vitest";
import { readHoldings, summariseHoldings, type HoldingsFacts } from "./googleHoldings";

const facts = (over: Partial<HoldingsFacts> = {}): HoldingsFacts => ({
  conferences: 1,
  recordings: 0,
  transcriptsReady: 0,
  transcriptsUnfinished: 0,
  hasRecordingLink: false,
  hasPastedMaterial: false,
  ...over,
});

describe("when Google has never seen the room", () => {
  it("points at the meeting link rather than at the class", () => {
    // The overwhelmingly likely cause, and the one thing an admin can check in
    // ten seconds. "No record" on its own sends people looking at Google.
    const v = readHoldings(facts({ conferences: 0 }));
    expect(v.ready).toBe(false);
    expect(v.advice).toMatch(/meeting link saved on this module/i);
    expect(v.advice).toMatch(/calendar invite with a different link/i);
  });

  it("is blunter when a recording was pasted in by hand", () => {
    // A pasted replay is proof the class happened. So the link is wrong — that
    // is not a possibility any more, it is the answer, and hedging wastes time.
    const v = readHoldings(facts({ conferences: 0, hasRecordingLink: true }));
    expect(v.advice).toMatch(/the class clearly ran/i);
    expect(v.advice).toMatch(/is not the room it ran in/i);
  });
});

describe("when everything is there", () => {
  it("says so, and that this is what the automation needs", () => {
    const v = readHoldings(facts({ recordings: 1, transcriptsReady: 1 }));
    expect(v.ready).toBe(true);
    expect(v.headline).toMatch(/recording and the transcript/i);
    expect(v.advice).toMatch(/automation needs/i);
  });

  it("does not pretend there is work to do when the box is already filled", () => {
    const v = readHoldings(facts({ recordings: 1, transcriptsReady: 1, hasPastedMaterial: true }));
    expect(v.ready).toBe(true);
    expect(v.advice).toMatch(/nothing needs doing/i);
  });
});

describe("when the transcript is missing", () => {
  it("names both ways of switching transcription on", () => {
    // The decisive answer for this whole question: no transcript means nobody
    // started one, and there are exactly two remedies.
    const v = readHoldings(facts({ recordings: 1 }));
    expect(v.ready).toBe(false);
    expect(v.headline).toMatch(/recording, but no transcript/i);
    expect(v.advice).toMatch(/Start transcript/);
    expect(v.advice).toMatch(/automatic transcription/i);
    expect(v.advice).toMatch(/nothing for the app to fetch/i);
  });

  it("distinguishes one that was started from one that never was", () => {
    // Completely different remedies: wait, versus change a setting. Reporting
    // both as "no transcript" would send somebody to the admin console over a
    // file Google was still writing.
    const v = readHoldings(facts({ recordings: 1, transcriptsUnfinished: 1 }));
    expect(v.advice).toMatch(/started but never finished/i);
    expect(v.advice).toMatch(/try again in an hour/i);
    expect(v.advice).not.toMatch(/Admin console/i);
  });
});

describe("when only the transcript is there", () => {
  it("counts as ready, because the transcript is the part being automated", () => {
    // A class nobody recorded still has everything the drafting needs. Marking
    // it not-ready would understate the case for building this.
    const v = readHoldings(facts({ transcriptsReady: 1 }));
    expect(v.ready).toBe(true);
    expect(v.advice).toMatch(/pasted in by hand/i);
  });
});

describe("when the room was used and nothing was captured", () => {
  it("says the class ran but nothing was kept", () => {
    const v = readHoldings(facts({ conferences: 2 }));
    expect(v.ready).toBe(false);
    expect(v.headline).toMatch(/neither a recording nor a transcript/i);
    expect(v.advice).toMatch(/each have to be started/i);
  });
});

describe("the pattern across a programme", () => {
  it("says to fix the setting first when nothing has a transcript", () => {
    const s = summariseHoldings([{ ready: false }, { ready: false }, { ready: false }]);
    expect(s).toMatch(/None of the 3/);
    expect(s).toMatch(/before any of this is worth automating/i);
  });

  it("says it is ready when every class has one", () => {
    expect(summariseHoldings([{ ready: true }, { ready: true }]))
      .toMatch(/All 2 classes.*everything it needs/i);
  });

  it("reads a partial result as the argument for automating it", () => {
    // Some but not all means a person is remembering and sometimes forgetting.
    // That is the strongest case for the feature, not a discouraging result.
    const s = summariseHoldings([{ ready: true }, { ready: false }, { ready: true }]);
    expect(s).toMatch(/2 of 3/);
    expect(s).toMatch(/somebody forgot/i);
  });

  it("does not divide by nothing", () => {
    expect(summariseHoldings([])).toMatch(/No past classes/i);
  });
});
