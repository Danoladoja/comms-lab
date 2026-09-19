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
  levelNote,
  lengthNote,
  durationProblem,
  STUDIO_MIN_MINUTES,
  STUDIO_MAX_MINUTES,
  exerciseSubject,
  MAX_STEER_CHARS,
  type StudioInviteFacts,
  validityProblem,
  opensInNote,
  timeLeftNote,
  studioStanding,
  byStanding,
  cohortStandingNote,
  needsChasing,
  cohortTally,
  attachProblem,
  attachedNote,
  resendProblem,
  resentNote,
} from "./studioInvites";
import { plannedTurns } from "./simulations";

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

  it("says what each dial actually does", () => {
    // A dial whose effect nobody can predict is a guess with extra steps.
    expect(levelNote("foundation")).toMatch(/one thing going wrong/i);
    expect(levelNote("advanced")).toMatch(/no clean answer/i);
    // Says the turn count, because that is the thing the number actually
    // changes — and it is not guessable: fifteen minutes and twenty-four both
    // buy three turns.
    expect(lengthNote(15, 3)).toMatch(/About 3 turns/);
    expect(lengthNote(30, 4)).toMatch(/About 4 turns/);
    expect(lengthNote(90, 6)).toMatch(/twice over/i);
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


describe("a validity window rather than a deadline", () => {
  const NOW = Date.parse("2026-09-18T09:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;
  const at = (ms: number) => new Date(NOW + ms).toISOString();

  const facts = (over: Partial<StudioInviteFacts> = {}): StudioInviteFacts => ({
    runId: null, startedAt: null, completedAt: null, opensAt: null, expiresAt: null, ...over,
  });

  it("holds an invitation shut until its hour comes", () => {
    // The case this exists for: an admin preparing next week's exercise on a
    // Friday, who does not want the keen half of the cohort doing it that
    // afternoon, before they have sat through Tuesday's module.
    expect(inviteState(facts({ opensAt: at(2 * DAY) }), NOW)).toBe("not-yet-open");
    expect(beginProblem(facts({ opensAt: at(2 * DAY) }), NOW)).toMatch(/has not opened/i);
    expect(inviteState(facts({ opensAt: at(-DAY) }), NOW)).toBe("ready");
  });

  it("does not hold shut something already in progress or finished", () => {
    // Somebody who began is past the question, and a window reopening behind
    // them must not take their run away.
    expect(inviteState(facts({ opensAt: at(2 * DAY), runId: 7 }), NOW)).toBe("in-progress");
    expect(inviteState(facts({ opensAt: at(2 * DAY), completedAt: at(-DAY) }), NOW)).toBe("spent");
  });

  it("reads a backwards window as closed rather than as forever pending", () => {
    // Both ends wrong. "Come back later" for something that can never open is
    // the worse of the two lies.
    const backwards = facts({ opensAt: at(2 * DAY), expiresAt: at(-DAY) });
    expect(inviteState(backwards, NOW)).toBe("expired");
  });

  it("refuses the three ways a window goes wrong", () => {
    expect(validityProblem({ opensAt: null, expiresAt: at(-DAY) }, NOW)).toMatch(/has gone/i);
    expect(validityProblem({ opensAt: at(5 * DAY), expiresAt: at(2 * DAY) }, NOW))
      .toMatch(/closes before it opens/i);
    // A mistyped year opens an exercise nobody can ever start.
    expect(validityProblem({ opensAt: at(400 * DAY), expiresAt: null }, NOW)).toMatch(/check the year/i);
    expect(validityProblem({ opensAt: null, expiresAt: at(400 * DAY) }, NOW))
      .toMatch(/not really a deadline/i);
  });

  it("accepts a window, one end of a window, or neither", () => {
    expect(validityProblem({ opensAt: at(DAY), expiresAt: at(3 * DAY) }, NOW)).toBeNull();
    expect(validityProblem({ opensAt: at(DAY), expiresAt: null }, NOW)).toBeNull();
    expect(validityProblem({ opensAt: null, expiresAt: at(DAY) }, NOW)).toBeNull();
    // Both empty is the old behaviour: open from the moment it is sent.
    expect(validityProblem({ opensAt: null, expiresAt: null }, NOW)).toBeNull();
  });

  it("refuses a date that is not a date, at either end", () => {
    expect(validityProblem({ opensAt: "soon", expiresAt: null }, NOW)).toMatch(/opening date is not/i);
    expect(validityProblem({ opensAt: null, expiresAt: "later" }, NOW)).toMatch(/closing date is not/i);
  });

  it("says how long until it opens, and nothing once it has", () => {
    expect(opensInNote(at(30 * 60_000), NOW)).toMatch(/Opens in 30 minutes/);
    expect(opensInNote(at(5 * 60 * 60_000), NOW)).toBe("Opens in 5 hours.");
    expect(opensInNote(at(DAY + 60_000), NOW)).toBe("Opens tomorrow.");
    expect(opensInNote(at(4 * DAY), NOW)).toBe("Opens in 4 days.");
    // Already open, or never shut: nothing to say.
    expect(opensInNote(at(-DAY), NOW)).toBeNull();
    expect(opensInNote(null, NOW)).toBeNull();
  });
});

describe("how long an exercise may be set to run", () => {
  it("refuses a length the exercise cannot fit into", () => {
    // The harmful end. Three turns is the floor, and below a quarter of an hour
    // the wall stops the exercise part-way — the learner is cut off and then
    // handed a debrief judging turns they never saw.
    expect(durationProblem(5)).toMatch(/too short/i);
    expect(durationProblem(10)).toMatch(/cut off/i);
    expect(durationProblem(STUDIO_MIN_MINUTES)).toBeNull();
  });

  it("refuses a length that buys nothing", () => {
    // Turns are capped at six, so past this the extra time is a number that
    // never happens.
    expect(durationProblem(240)).toMatch(/never happens/i);
    expect(durationProblem(STUDIO_MAX_MINUTES)).toBeNull();
  });

  it("refuses something that is not a number of minutes", () => {
    expect(durationProblem("soon")).toMatch(/not a number/i);
    expect(durationProblem(null)).toMatch(/not a number/i);
  });

  it("keeps the whole allowed range inside what the turns can use", () => {
    // The guarantee the two bounds exist for: at every length an admin may
    // choose, the planned turns fit inside the clock at four minutes each.
    for (let m = STUDIO_MIN_MINUTES; m <= STUDIO_MAX_MINUTES; m++) {
      const turns = plannedTurns(m);
      expect(turns * 4, `${m} minutes plans ${turns} turns`).toBeLessThanOrEqual(m + 1);
    }
  });
});

describe("what the admin is told after inviting", () => {
  it("says how many were actually told, not just how many were invited", () => {
    // The whole point. "50 learners can now run it" was true and useless while
    // nothing was sent to any of them.
    const note = invitationNote({
      invited: 50, alreadyHad: 0, moduleTitle: "Energy Comms",
      emailed: 50, emailFailed: 0, emailConfigured: true,
    });
    expect(note).toContain("50 learners");
    expect(note).toContain("50 told by email");
  });

  it("names the ones whose address bounced, and says they were not told", () => {
    const note = invitationNote({
      invited: 12, alreadyHad: 0, moduleTitle: "Energy Comms",
      emailed: 10, emailFailed: 2, emailConfigured: true,
    });
    expect(note).toContain("10 told by email");
    expect(note).toMatch(/2 addresses would not take it/);
    expect(note).toMatch(/still have their exercise/);
  });

  it("says plainly when there is no email set up at all", () => {
    const note = invitationNote({
      invited: 5, alreadyHad: 0, moduleTitle: "Energy Comms", emailConfigured: false,
    });
    expect(note).toMatch(/nobody has been told/i);
    expect(note).toMatch(/next open the Studio/);
  });
});

describe("the cohort as the admin needs to see it", () => {
  const NOW = Date.parse("2026-09-19T09:00:00Z");
  const DAY = 24 * 60 * 60 * 1000;
  const at = (ms: number) => new Date(NOW + ms).toISOString();
  const facts = (over: Partial<StudioInviteFacts> = {}): StudioInviteFacts => ({
    runId: null, startedAt: null, completedAt: null, opensAt: null, expiresAt: null, ...over,
  });

  it("reads each of the five places somebody can be", () => {
    expect(studioStanding(facts({ opensAt: at(DAY) }), NOW)).toBe("waiting");
    expect(studioStanding(facts(), NOW)).toBe("not-started");
    expect(studioStanding(facts({ runId: 7 }), NOW)).toBe("in-progress");
    expect(studioStanding(facts({ completedAt: at(-DAY) }), NOW)).toBe("finished");
    expect(studioStanding(facts({ expiresAt: at(-DAY) }), NOW)).toBe("missed");
  });

  it("puts the people who need something first", () => {
    // An admin opens this to find out who to chase, not to admire the finishers.
    const rows = [
      { name: "Ama", standing: "finished" as const },
      { name: "Kofi", standing: "not-started" as const },
      { name: "Zuri", standing: "missed" as const },
      { name: "Bala", standing: "in-progress" as const },
      { name: "Ada", standing: "not-started" as const },
    ];
    expect(byStanding(rows).map((r) => r.name)).toEqual(["Zuri", "Ada", "Kofi", "Bala", "Ama"]);
  });

  it("keeps the same order between one look and the next", () => {
    // A list that reshuffles under you is a list nobody trusts.
    const rows = [
      { name: "Bala", standing: "not-started" as const },
      { name: "Ada", standing: "not-started" as const },
    ];
    expect(byStanding(rows).map((r) => r.name)).toEqual(byStanding(byStanding(rows)).map((r) => r.name));
  });

  it("says the shape of the cohort in one line", () => {
    const note = cohortStandingNote([
      { standing: "finished" }, { standing: "finished" },
      { standing: "not-started" }, { standing: "in-progress" }, { standing: "missed" },
    ]);
    expect(note).toContain("2 of 5 finished");
    expect(note).toContain("1 not started");
    expect(note).toContain("1 part-way through");
    expect(note).toContain("1 ran out of time");
  });

  it("does not report nothings", () => {
    const note = cohortStandingNote([{ standing: "finished" }, { standing: "finished" }]);
    expect(note).toBe("2 of 2 finished.");
  });

  it("says plainly when nobody has been invited", () => {
    expect(cohortStandingNote([])).toMatch(/Nobody has been invited/);
  });

  it("keeps only the people who need something", () => {
    // The finished need nothing. Neither does somebody whose door has not
    // opened yet — the clock opens it, and there is nothing to chase until it
    // has.
    expect(needsChasing("missed")).toBe(true);
    expect(needsChasing("not-started")).toBe(true);
    expect(needsChasing("in-progress")).toBe(true);
    expect(needsChasing("finished")).toBe(false);
    expect(needsChasing("waiting")).toBe(false);
  });

  it("counts each place, worst first", () => {
    expect(cohortTally([
      { standing: "finished" }, { standing: "finished" },
      { standing: "missed" }, { standing: "not-started" },
    ])).toEqual([
      { standing: "missed", count: 1 },
      { standing: "not-started", count: 1 },
      { standing: "finished", count: 2 },
    ]);
  });

  it("does not count out the places nobody is in", () => {
    // A screen full of noughts has to be read before it can be dismissed.
    expect(cohortTally([{ standing: "finished" }])).toEqual([{ standing: "finished", count: 1 }]);
    expect(cohortTally([])).toEqual([]);
  });

  it("refuses to file exercises against a live class", () => {
    // A class already tells a cohort what it asks of them. Adding a fourth
    // thing to it afterwards is moving a gate people have been told about.
    expect(attachProblem({ moduleIsSimulation: false, moduleOnProgramme: true, unattached: 5 }))
      .toMatch(/live class/);
    expect(attachProblem({ moduleIsSimulation: true, moduleOnProgramme: false, unattached: 5 }))
      .toMatch(/not on this programme/);
    expect(attachProblem({ moduleIsSimulation: true, moduleOnProgramme: true, unattached: 0 }))
      .toMatch(/already filed/);
    expect(attachProblem({ moduleIsSimulation: true, moduleOnProgramme: true, unattached: 5 }))
      .toBeNull();
  });

  it("says what filing them did, and what it shut", () => {
    expect(attachedNote(12, "Crisis exercise", "Module 4"))
      .toBe("12 exercises are now the work for Crisis exercise. Whoever has not finished cannot open Module 4.");
    expect(attachedNote(1, "Crisis exercise", null))
      .toMatch(/^One exercise is now the work for Crisis exercise\./);
    expect(attachedNote(1, "Crisis exercise", null)).toMatch(/opens nothing/);
  });

  it("sends a fresh exercise only to somebody who ran out of time", () => {
    // Anybody still holding one they could use is refused: a second run is a
    // second model call, and two live invitations is one learner wondering
    // which situation is theirs.
    expect(resendProblem("missed")).toBeNull();
    expect(resendProblem("finished")).toMatch(/already done it/);
    expect(resendProblem("in-progress")).toMatch(/part-way/);
    expect(resendProblem("not-started")).toMatch(/has not closed/);
    expect(resendProblem("waiting")).toMatch(/not opened yet/);
  });

  it("says a fresh exercise is a new situation, not the old one", () => {
    // The commonest wrong expectation: that "resend" means "reopen the one
    // they missed". It does not, and cannot — the situation was generated for
    // an invitation that is spent.
    expect(resentNote("Femi", "Friday 5pm WAT")).toContain("new situation");
    expect(resentNote("Femi", "Friday 5pm WAT")).toContain("Friday 5pm WAT");
    expect(resentNote("", null)).toMatch(/^They have a fresh exercise with no closing date/);
  });
});
