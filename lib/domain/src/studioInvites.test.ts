import { describe, expect, it } from "vitest";
import {
  inviteState,
  beginProblem,
  shouldResume,
  situationFor,
  situationBrief,
  situationSummary,
  objectiveFor,
  invitationProblem,
  invitationNote,
  SITUATION_COMBINATIONS,
} from "./studioInvites";

const NOW = Date.parse("2026-09-18T12:00:00Z");
const PAST = "2026-09-10T12:00:00Z";
const FUTURE = "2026-10-10T12:00:00Z";

const fresh = { runId: null, startedAt: null, completedAt: null, expiresAt: null };

describe("where an invitation stands", () => {
  it("is ready when it has been sent and nothing else has happened", () => {
    expect(inviteState(fresh, NOW)).toBe("ready");
    expect(beginProblem(fresh, NOW)).toBeNull();
  });

  it("is in progress once a run exists", () => {
    expect(inviteState({ ...fresh, runId: 7 }, NOW)).toBe("in-progress");
    expect(shouldResume({ ...fresh, runId: 7 }, NOW)).toBe(true);
  });

  it("is in progress from the moment they start, even before a run id lands", () => {
    // The window between claiming the invitation and writing the run. Without
    // this, two quick presses of Begin both read "ready" and both start a run.
    expect(inviteState({ ...fresh, startedAt: PAST }, NOW)).toBe("in-progress");
  });

  it("is spent once finished, and says where the debrief went", () => {
    const done = { ...fresh, runId: 7, startedAt: PAST, completedAt: PAST };
    expect(inviteState(done, NOW)).toBe("spent");
    expect(beginProblem(done, NOW)).toMatch(/practice record/);
  });

  it("expires only if it was never started", () => {
    expect(inviteState({ ...fresh, expiresAt: PAST }, NOW)).toBe("expired");
    expect(beginProblem({ ...fresh, expiresAt: PAST }, NOW)).toMatch(/passed its date/);
  });

  it("never throws somebody out of an exercise they are in the middle of", () => {
    // Started in time, still working, and the date passes. Ending their run on
    // a calendar boundary would lose work they cannot get back — and the
    // session's own clock finishes them soon enough anyway.
    const working = { ...fresh, runId: 7, startedAt: PAST, expiresAt: PAST };
    expect(inviteState(working, NOW)).toBe("in-progress");
  });

  it("does not expire an invitation with no date on it", () => {
    expect(inviteState({ ...fresh, expiresAt: null }, NOW)).toBe("ready");
    expect(inviteState({ ...fresh, expiresAt: FUTURE }, NOW)).toBe("ready");
  });

  it("refuses a second run rather than minting one", () => {
    // The whole point of the invitation. Pressing Begin again must resume, and
    // this is the sentence that stops it doing anything else.
    expect(beginProblem({ ...fresh, runId: 7 }, NOW)).toMatch(/already started/);
  });
});

describe("the situation each learner is dropped into", () => {
  it("is the same every time for the same invitation", () => {
    // A learner who refreshes the page must not find a different crisis. This
    // is the reason the seed is stored rather than rolled.
    expect(situationFor("invite-41")).toEqual(situationFor("invite-41"));
    expect(situationBrief(situationFor("invite-41"))).toBe(situationBrief(situationFor("invite-41")));
  });

  it("differs between learners", () => {
    const briefs = new Set(
      Array.from({ length: 45 }, (_, i) => situationBrief(situationFor(`invite-${i}`))),
    );
    // Forty-five learners, and the great majority get their own crisis. Exact
    // uniqueness is not the goal and would be a false promise — two people
    // sharing all four draws is possible and rare.
    expect(briefs.size).toBeGreaterThan(40);
  });

  it("varies each part independently rather than moving in lockstep", () => {
    // Salting each draw separately is what stops "setting 3" always arriving
    // with "flashpoint 3", which would collapse the real variety to the length
    // of one list.
    const settings = new Set<string>();
    const flashpoints = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const s = situationFor(`seed-${i}`);
      settings.add(s.setting);
      flashpoints.add(s.flashpoint);
    }
    expect(settings.size).toBeGreaterThan(6);
    expect(flashpoints.size).toBeGreaterThan(6);
  });

  it("has enough combinations for a cohort several times over", () => {
    expect(SITUATION_COMBINATIONS).toBeGreaterThan(2000);
  });

  it("reads as a sentence a learner can act on", () => {
    const summary = situationSummary(situationFor("invite-1"));
    expect(summary).toMatch(/^You speak for /);
    expect(summary).toMatch(/It begins with /);
  });

  it("copes with an empty seed rather than throwing on somebody's first run", () => {
    expect(() => situationFor("")).not.toThrow();
    expect(situationFor("").setting.length).toBeGreaterThan(0);
  });
});

describe("what they are asked to get better at", () => {
  it("prefers the module's own description", () => {
    expect(objectiveFor({
      programmeTitle: "Energy Comms", programmeDescription: "The programme blurb",
      moduleTitle: "Module two", moduleDescription: "Explain a tariff rise without losing trust.",
    })).toBe("Explain a tariff rise without losing trust.");
  });

  it("falls back to the module's title, then the programme", () => {
    expect(objectiveFor({
      programmeTitle: "Energy Comms", programmeDescription: "The programme blurb",
      moduleTitle: "Module two", moduleDescription: "   ",
    })).toMatch(/Module two/);

    expect(objectiveFor({
      programmeTitle: "Energy Comms", programmeDescription: "The programme blurb",
      moduleTitle: null, moduleDescription: null,
    })).toBe("The programme blurb");
  });

  it("never invents an objective out of nothing", () => {
    // An objective this file made up would be one more thing for a facilitator
    // to find disagreeing with what they actually taught. With nothing written
    // down it names the programme and says no more.
    const objective = objectiveFor({
      programmeTitle: "Energy Comms", programmeDescription: "",
      moduleTitle: null, moduleDescription: null,
    });
    expect(objective).toMatch(/Energy Comms/);
  });
});

describe("refusing an invitation an admin should not send", () => {
  const base = { objective: "Explain a tariff rise without losing trust.", hasOpenInvitation: false, enrolled: true };

  it("refuses somebody who is not on the programme", () => {
    expect(invitationProblem({ ...base, enrolled: false })).toMatch(/not on this programme/);
  });

  it("refuses a second invitation while the first is unused", () => {
    // An admin pressing "invite the cohort" twice in a week would otherwise
    // hand out two runs each, and the quiet version of that is a token bill
    // nobody can account for.
    expect(invitationProblem({ ...base, hasOpenInvitation: true })).toMatch(/already have an invitation/);
  });

  it("refuses when the programme says nothing to practise, and says what to fix", () => {
    expect(invitationProblem({ ...base, objective: "short" }))
      .toMatch(/Give the module a description first/);
  });

  it("allows the ordinary case", () => {
    expect(invitationProblem(base)).toBeNull();
  });
});

describe("what the admin reads back", () => {
  it("counts who was invited and who was left alone", () => {
    expect(invitationNote({ invited: 31, alreadyHad: 4, moduleTitle: "Module two" }))
      .toBe("31 learners can now run Module two in the Studio, once each. 4 already had one and were left alone.");
  });

  it("speaks about one person as one person", () => {
    expect(invitationNote({ invited: 1, alreadyHad: 0, moduleTitle: "Module two" }))
      .toBe("1 learner can now run Module two in the Studio, once each.");
  });

  it("says plainly when it did nothing, and why", () => {
    expect(invitationNote({ invited: 0, alreadyHad: 12, moduleTitle: "Module two" }))
      .toMatch(/all of them already have an unused invitation/);
  });
});
