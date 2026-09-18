import { describe, expect, it } from "vitest";
import {
  groupSessionState,
  approvalProblem,
  mayEditSession,
  assignTeams,
  emptyTeams,
  beatsDue,
  minutesLeft,
  publicRecord,
  beatApprovalNote,
  wentLiveNote,
  GROUP_SESSION_MINUTES,
  MIN_NOTICE_MINUTES,
  type GroupBeat,
  type GroupObjective,
} from "./groupSession";

const NOW = Date.parse("2026-09-22T13:00:00Z");
const MIN = 60_000;

const objective = (over: Partial<GroupObjective> = {}): GroupObjective => ({
  id: "o1", text: "Say the hard number first", note: "Whether they lead with the figure that hurts.",
  enabled: true, ...over,
});

const beat = (over: Partial<GroupBeat> = {}): GroupBeat => ({
  id: "b1", atMinute: 0, scope: "all", title: "The wire has the memo",
  content: "The agency has the leaked note.", responsePrompt: "What do you say?",
  responseMinutes: 5, ...over,
});

const approvable = {
  objectives: [objective()],
  beats: [beat(), beat({ id: "b2", atMinute: 20, scope: "team" })],
  scheduledAt: new Date(NOW + 60 * MIN).toISOString(),
  durationMinutes: GROUP_SESSION_MINUTES,
  nowMs: NOW,
  learners: 12,
  teams: 4,
};

describe("where a session stands", () => {
  const base = { scheduledAt: null, approvedAt: null, startedAt: null, endedAt: null, durationMinutes: 45 };

  it("is a draft until somebody has approved it", () => {
    expect(groupSessionState(base, NOW)).toBe("draft");
    expect(mayEditSession("draft")).toBe(true);
  });

  it("is scheduled once approved, and can no longer be edited", () => {
    // The cohort has been told by this point. Editing the exercise underneath
    // people who have been told what they are turning up to is not an edit.
    const scheduled = { ...base, approvedAt: "2026-09-22T12:00:00Z" };
    expect(groupSessionState(scheduled, NOW)).toBe("scheduled");
    expect(mayEditSession("scheduled")).toBe(false);
  });

  it("is live once it has started", () => {
    const live = { ...base, approvedAt: "x", startedAt: new Date(NOW - 10 * MIN).toISOString() };
    expect(groupSessionState(live, NOW)).toBe("live");
  });

  it("finishes itself when the clock runs out, with nobody pressing anything", () => {
    // The whole point of an unfacilitated session: there is no one to end it.
    const over = { ...base, approvedAt: "x", startedAt: new Date(NOW - 46 * MIN).toISOString() };
    expect(groupSessionState(over, NOW)).toBe("finished");
  });

  it("stays finished once it has been ended, whatever the clock says", () => {
    const ended = { ...base, startedAt: new Date(NOW - 5 * MIN).toISOString(), endedAt: "2026-09-22T12:59:00Z" };
    expect(groupSessionState(ended, NOW)).toBe("finished");
  });
});

describe("refusing to let a session go live", () => {
  it("allows the ordinary case", () => {
    expect(approvalProblem(approvable)).toBeNull();
  });

  it("insists on at least one objective, because the debriefs are written against them", () => {
    expect(approvalProblem({ ...approvable, objectives: [objective({ enabled: false })] }))
      .toMatch(/at least one objective/);
    expect(approvalProblem({ ...approvable, objectives: [objective({ text: "   " })] }))
      .toMatch(/at least one objective/);
  });

  it("insists on enough notice for the cohort to be told", () => {
    // Teams are assigned when it goes live. A session approved for four
    // minutes' time is a session nobody attends.
    expect(approvalProblem({ ...approvable, scheduledAt: new Date(NOW + 4 * MIN).toISOString() }))
      .toMatch(new RegExp(`${MIN_NOTICE_MINUTES} minutes`));
    expect(approvalProblem({ ...approvable, scheduledAt: null })).toMatch(/Choose when/);
  });

  it("refuses an unreadable start time rather than scheduling nothing", () => {
    expect(approvalProblem({ ...approvable, scheduledAt: "whenever" })).toMatch(/could not be read/);
  });

  it("refuses a scenario with nobody to disagree with", () => {
    expect(approvalProblem({ ...approvable, teams: 1 })).toMatch(/nobody to disagree with/);
  });

  it("refuses when a team would be empty, and says the numbers", () => {
    const problem = approvalProblem({ ...approvable, learners: 3, teams: 4 });
    expect(problem).toMatch(/3 learners and 4 teams/);
    expect(problem).toMatch(/at least one team would be empty/);
  });

  it("refuses a running order where nothing happens to everybody", () => {
    // Without a shared beat the teams are four people in four separate rooms,
    // which is the individual exercise wearing a group exercise's name.
    expect(approvalProblem({ ...approvable, beats: [beat({ scope: "team" })] }))
      .toMatch(/never be in the same crisis/);
  });

  it("refuses a development scheduled after the session has ended", () => {
    const problem = approvalProblem({
      ...approvable,
      beats: [beat(), beat({ id: "b2", atMinute: 60 })],
    });
    expect(problem).toMatch(/after the session has finished/);
  });
});

describe("filling the teams", () => {
  it("spreads people evenly, in turn", () => {
    const filled = assignTeams([1, 2, 3, 4, 5, 6, 7], ["a", "b", "c"]);
    expect(filled.get("a")).toEqual([1, 4, 7]);
    expect(filled.get("b")).toEqual([2, 5]);
    expect(filled.get("c")).toEqual([3, 6]);
  });

  it("never leaves the teams more than one apart", () => {
    for (let people = 4; people <= 45; people++) {
      const filled = assignTeams(Array.from({ length: people }, (_, i) => i), ["a", "b", "c", "d"]);
      const sizes = [...filled.values()].map((m) => m.length);
      expect(Math.max(...sizes) - Math.min(...sizes), `${people} learners`).toBeLessThanOrEqual(1);
    }
  });

  it("names a team nobody landed in", () => {
    // Worth saying out loud before the session starts: the other teams will be
    // answering nobody on that side, and an admin should know that in advance.
    const filled = assignTeams([1, 2], ["a", "b", "c"]);
    expect(emptyTeams(filled)).toEqual(["c"]);
  });

  it("does not fall over with no teams at all", () => {
    expect(assignTeams([1, 2], []).size).toBe(0);
  });
});

describe("the clock, with nobody driving it", () => {
  const beats = [
    beat({ id: "b1", atMinute: 0 }),
    beat({ id: "b2", atMinute: 10 }),
    beat({ id: "b3", atMinute: 25 }),
  ];

  it("delivers a beat once its minute has come", () => {
    const due = beatsDue({ beats, startedAtMs: NOW - 12 * MIN, nowMs: NOW, delivered: [] });
    expect(due.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("never delivers the same beat twice", () => {
    const due = beatsDue({ beats, startedAtMs: NOW - 12 * MIN, nowMs: NOW, delivered: ["b1"] });
    expect(due.map((b) => b.id)).toEqual(["b2"]);
  });

  it("reads the session's own start time rather than counting ticks", () => {
    // A server that restarts mid-session must pick up where the clock says it
    // is, not where a counter had got to. Everything overdue arrives at once.
    const due = beatsDue({ beats, startedAtMs: NOW - 40 * MIN, nowMs: NOW, delivered: [] });
    expect(due.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("holds back anything whose minute has not come", () => {
    expect(beatsDue({ beats, startedAtMs: NOW, nowMs: NOW, delivered: [] }).map((b) => b.id))
      .toEqual(["b1"]);
  });

  it("counts down to the end for the header everybody is watching", () => {
    expect(minutesLeft({ startedAtMs: NOW - 20 * MIN, durationMinutes: 45, nowMs: NOW })).toBe(25);
    expect(minutesLeft({ startedAtMs: NOW - 90 * MIN, durationMinutes: 45, nowMs: NOW })).toBe(0);
  });
});

describe("what one team learns about another", () => {
  const answers = [
    { teamId: "operator", body: "We confirm the rise and publish the schedule." },
    { teamId: "regulator", body: "We have asked the operator for the filing." },
    { teamId: "community", body: "   " },
  ];

  it("passes on what another team said in public", () => {
    // The valuable half. In a real crisis the regulator reads the operator's
    // statement, and an exercise where they cannot is four people in four rooms.
    const seen = publicRecord(answers, "regulator");
    expect(seen.map((a) => a.teamId)).toEqual(["operator"]);
    expect(seen[0].body).toMatch(/confirm the rise/);
  });

  it("never hands over a team's own words to itself as though from outside", () => {
    expect(publicRecord(answers, "operator").map((a) => a.teamId)).not.toContain("operator");
  });

  it("says nothing at all about a team that has said nothing", () => {
    // Silence is information a real regulator would have to work out for
    // themselves. Reporting "the community has not responded" hands over the
    // judgement being practised.
    expect(publicRecord(answers, "operator").map((a) => a.teamId)).not.toContain("community");
  });
});

describe("being honest about what was approved", () => {
  it("says a shared beat was approved word for word", () => {
    expect(beatApprovalNote(beat({ scope: "all" }))).toMatch(/in these words/);
  });

  it("says a team beat was approved only for what it is for", () => {
    // The dishonest version of this screen would imply an admin had read
    // wording that cannot exist yet, because it quotes a learner who has not
    // answered.
    const note = beatApprovalNote(beat({ scope: "team" }));
    expect(note).toMatch(/written during the session/);
    expect(note).toMatch(/approving what it is for, not its wording/);
  });
});

describe("what the admin reads when it starts", () => {
  it("says how many people and how long", () => {
    expect(wentLiveNote({ learners: 12, teams: 4, empty: [], durationMinutes: 45 }))
      .toBe("12 learners split across 4 teams. It runs for 45 minutes and ends itself.");
  });

  it("names an empty team rather than letting it be discovered mid-session", () => {
    const note = wentLiveNote({ learners: 3, teams: 4, empty: ["The press"], durationMinutes: 45 });
    expect(note).toMatch(/One team has nobody in it: The press/);
    expect(note).toMatch(/answering nobody on that side/);
  });
});
