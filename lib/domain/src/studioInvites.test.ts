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
  steerProblem,
  standaloneProblem,
  expiryProblem,
  levelNote,
  lengthNote,
  exerciseSubject,
  MAX_STEER_CHARS,
  expiryFromInputs,
  expiryIntent,
  timeLeftNote,
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
  it("is the programme's, not the most recent module's", () => {
    // The correction that matters here. A communicator's job is not divided
    // into weeks: handling a tariff announcement wants what one module said
    // about explaining a price and what another said about the regulator.
    // Pinning the exercise to one module rehearsed the timetable, not the work.
    expect(objectiveFor({
      programmeTitle: "Energy Comms",
      programmeDescription: "Hold the line in public when the facts are moving.",
      moduleTitles: ["Module one", "Module two", "Module three"],
    })).toBe("Hold the line in public when the facts are moving.");
  });

  it("names the ground covered when the programme says nothing about itself", () => {
    const objective = objectiveFor({
      programmeTitle: "Energy Comms",
      programmeDescription: "   ",
      moduleTitles: ["Explaining a tariff", "Facing the regulator"],
    });
    expect(objective).toMatch(/whole of Energy Comms/);
    expect(objective).toMatch(/Explaining a tariff, Facing the regulator/);
  });

  it("never invents an objective out of nothing", () => {
    // An objective this file made up would be one more thing for a facilitator
    // to find disagreeing with what they actually taught. With nothing written
    // down it names the programme and says no more.
    expect(objectiveFor({
      programmeTitle: "Energy Comms", programmeDescription: "", moduleTitles: [],
    })).toBe("Handle a live communications crisis to the standard Energy Comms sets.");
  });

  it("copes with a programme that has no name either", () => {
    expect(objectiveFor({ programmeTitle: "  ", programmeDescription: "" }))
      .toMatch(/this programme/);
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
      .toMatch(/Give the programme a description first/);
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

describe("the dials an admin turns", () => {
  const NOW = Date.parse("2026-09-18T09:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;

  it("takes a sentence of steer and refuses a brief", () => {
    expect(steerProblem("Lean on the regulator side of it.")).toBeNull();
    expect(steerProblem("")).toBeNull();
    expect(steerProblem(null)).toBeNull();
    // A paragraph is an admin writing the brief by hand, which drifts from the
    // programme the moment anybody is in a hurry.
    expect(steerProblem("x".repeat(MAX_STEER_CHARS + 1))).toMatch(/under 240/);
  });

  it("will not send an exercise with no programme and nothing to go on", () => {
    expect(standaloneProblem({ subject: "", objective: "" })).toMatch(/what the exercise is about/i);
    expect(standaloneProblem({ subject: "A tariff rise at a partner utility", objective: "" }))
      .toMatch(/get better at/i);
    expect(standaloneProblem({
      subject: "A tariff rise at a partner utility",
      objective: "Explaining a price increase without hiding the number.",
    })).toBeNull();
  });

  it("refuses an expiry date that has already gone", () => {
    // Dead on arrival reads to a learner as the Studio being broken.
    expect(expiryProblem(new Date(NOW - DAY).toISOString(), NOW)).toMatch(/has gone/i);
    expect(expiryProblem(new Date(NOW + 7 * DAY).toISOString(), NOW)).toBeNull();
    expect(expiryProblem(null, NOW)).toBeNull();
    expect(expiryProblem("whenever", NOW)).toMatch(/not a date/i);
    expect(expiryProblem(new Date(NOW + 400 * DAY).toISOString(), NOW)).toMatch(/not really a deadline/i);
  });

  it("says what each dial actually does", () => {
    // A dial whose effect nobody can predict is a guess with extra steps.
    expect(levelNote("foundation")).toMatch(/one thing going wrong/i);
    expect(levelNote("advanced")).toMatch(/no clean answer/i);
    expect(lengthNote(10)).toMatch(/short/i);
    expect(lengthNote(90)).toMatch(/hour of somebody's day/i);
    expect(lengthNote(30)).toMatch(/two or three times/i);
  });

  it("lets a subject replace the drawn situation only when there is no programme", () => {
    const drawn = "A refinery outage during a heatwave.";

    // Standalone: the subject is the only thing saying what this is.
    expect(exerciseSubject({ subject: "A partner's tariff rise", drawn, hasProgramme: false }))
      .toBe("A partner's tariff rise");

    // On a programme it steers instead, because the drawn situation is what
    // makes forty-five learners' crises different from one another. Replacing
    // it would flatten the whole cohort into one exercise.
    const steered = exerciseSubject({ subject: "the regulator", drawn, hasProgramme: true });
    expect(steered).toContain(drawn);
    expect(steered).toContain("the regulator");

    // Nothing typed: the drawn situation, untouched.
    expect(exerciseSubject({ subject: "", drawn, hasProgramme: true })).toBe(drawn);
  });
});

describe("a deadline with an hour on it", () => {
  const NOW = Date.parse("2026-09-18T09:00:00Z");

  it("takes the hour when one is given", () => {
    expect(expiryFromInputs("2026-09-30", "17:00")).toBe("2026-09-30T17:00:00");
  });

  it("gives them all of the last day when no hour is given", () => {
    // "Use it by the 30th" has to include the 30th.
    expect(expiryFromInputs("2026-09-30", "")).toBe("2026-09-30T23:59:59");
  });

  it("is no deadline at all without a date", () => {
    expect(expiryFromInputs("", "17:00")).toBeNull();
    expect(expiryFromInputs("", "")).toBeNull();
  });

  it("says which of those three the admin is about to do", () => {
    // The end-of-day assumption was being made silently before, and was
    // sometimes wrong: "by Friday" often means before Friday's class.
    expect(expiryIntent("2026-09-30", "17:00")).toMatch(/at that time/);
    expect(expiryIntent("2026-09-30", "")).toMatch(/end of that day/);
    expect(expiryIntent("", "")).toMatch(/No deadline/);
  });

  it("tells the learner how long they have, in the unit they would use", () => {
    const iso = (h: number) => new Date(NOW + h * 60 * 60 * 1000).toISOString();
    expect(timeLeftNote(iso(0.25), NOW)).toMatch(/Less than an hour/);
    expect(timeLeftNote(iso(5), NOW)).toBe("5 hours left to start it.");
    expect(timeLeftNote(iso(25), NOW)).toBe("One day left to start it.");
    expect(timeLeftNote(iso(24 * 4), NOW)).toBe("4 days left to start it.");
    expect(timeLeftNote(iso(-1), NOW)).toMatch(/expired/);
    // No deadline is not a deadline of zero.
    expect(timeLeftNote(null, NOW)).toBeNull();
  });
});
