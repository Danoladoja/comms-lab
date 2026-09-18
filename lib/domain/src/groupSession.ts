/**
 * A group simulation with nobody at the front of the room.
 *
 * One crisis, four stakeholder teams inside it, forty-five minutes on a clock
 * that does not stop. The facilitated mode this replaces needed a person to
 * press "what happens next" at every beat, which meant a room without that
 * person stalled after the opening development — and the person pressing it was
 * also the only one who could see everything, so they were running the exercise
 * rather than watching it.
 *
 * ## What an admin approves, and what they cannot
 *
 * Nothing reaches a cohort unread. But the two halves of a session can be
 * vetted to different depths, and pretending otherwise would be the dishonest
 * part of this design.
 *
 *   - A **shared beat** lands on every team at the same minute. It is written
 *     before the session exists, so it is approved word for word.
 *   - A **team beat** lands on one team because of what that team just did. Its
 *     wording cannot be known in advance — it quotes a learner who has not
 *     answered yet. So what is approved is its *intent*: "the regulator is asked
 *     to confirm what the operator actually said."
 *
 * The admin screen says which is which. An approval that implied the second kind
 * had been read word for word would be a promise the mechanism cannot keep.
 *
 * ## Why the clock does not wait
 *
 * A session could pause at each beat until every team has answered. It would be
 * kinder to a slow team and it would be the wrong exercise: the thing being
 * practised is composure while a story moves without you, and a story that waits
 * is not that. Silence is an answer here, as it already is in the individual
 * exercise, and the next beat says so.
 */

export type GroupObjective = {
  id: string;
  /** What this session is testing, in the admin's words once they have edited it. */
  text: string;
  /** Why it is worth testing. Shown under the objective on the approval screen. */
  note: string;
  /** Switched off by an admin who judges the cohort has not covered it. */
  enabled: boolean;
};

export type GroupBeat = {
  id: string;
  /** Minutes from the start of the session. */
  atMinute: number;
  /**
   * Who it lands on.
   *
   * "all" is the story moving and is approved word for word. "team" is a
   * consequence of one team's own answer, and only its intent can be approved.
   */
  scope: "all" | "team";
  title: string;
  /**
   * What it says. Written up front for a shared beat; for a team beat this is
   * the intent, and the words the team actually reads are written during the
   * session from what they did.
   */
  content: string;
  responsePrompt: string;
  responseMinutes: number;
};

export type GroupSessionFacts = {
  scheduledAt: string | null;
  approvedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number;
};

export type GroupSessionState =
  /** Written by the Lab, not yet read by an admin. Invisible to everybody else. */
  | "draft"
  /** Approved and waiting for its start time. */
  | "scheduled"
  /** Running. */
  | "live"
  /** The clock ran out and the debriefs are written. */
  | "finished";

/** How long a session runs unless somebody says otherwise. */
export const GROUP_SESSION_MINUTES = 45;

/**
 * The shortest notice a session can be given.
 *
 * Teams are assigned when a session goes live and learners have to be told, so
 * a session approved for four minutes' time is one nobody attends. Fifteen
 * minutes is enough to send a message and no more than that.
 */
export const MIN_NOTICE_MINUTES = 15;

export function groupSessionState(facts: GroupSessionFacts, nowMs: number): GroupSessionState {
  if (facts.endedAt) return "finished";
  if (facts.startedAt) {
    const endsAt = new Date(facts.startedAt).getTime() + facts.durationMinutes * 60_000;
    return nowMs >= endsAt ? "finished" : "live";
  }
  if (!facts.approvedAt) return "draft";
  return "scheduled";
}

/**
 * Why this session cannot be approved.
 *
 * Every one of these is a thing an admin would otherwise discover in front of a
 * cohort, which is the worst possible moment and the reason the gate exists.
 */
export function approvalProblem(facts: {
  objectives: readonly GroupObjective[];
  beats: readonly GroupBeat[];
  scheduledAt: string | null;
  durationMinutes: number;
  nowMs: number;
  /** How many people are on the programme. */
  learners: number;
  /** How many stakeholder teams the scenario defines. */
  teams: number;
}): string | null {
  const enabled = facts.objectives.filter((o) => o.enabled && o.text.trim().length > 0);
  if (enabled.length === 0) {
    return "Leave at least one objective switched on — it is what the debriefs are written against.";
  }

  if (!facts.scheduledAt) return "Choose when this session runs.";
  const startsAt = new Date(facts.scheduledAt).getTime();
  if (!Number.isFinite(startsAt)) return "That start time could not be read. Pick it from the calendar.";
  if (startsAt < facts.nowMs + MIN_NOTICE_MINUTES * 60_000) {
    return `Give the cohort at least ${MIN_NOTICE_MINUTES} minutes' notice. Teams are assigned when the `
      + "session goes live, and nobody can be in a room they have not been told about.";
  }

  if (facts.teams < 2) {
    return "This scenario has fewer than two teams, so there is nobody to disagree with. "
      + "Ask for it to be written again.";
  }
  if (facts.learners < facts.teams) {
    return `There are ${facts.learners} learners and ${facts.teams} teams, so at least one team would `
      + "be empty. Either wait for more of the cohort or ask for a scenario with fewer teams.";
  }

  const shared = facts.beats.filter((b) => b.scope === "all");
  if (shared.length === 0) {
    return "Nothing happens to everybody in this running order, so the teams would never be in the "
      + "same crisis. Ask for it to be written again.";
  }

  const late = facts.beats.filter((b) => b.atMinute >= facts.durationMinutes);
  if (late.length > 0) {
    return `${late.length === 1 ? "One development lands" : `${late.length} developments land`} after `
      + `the session has finished. Either lengthen it or have the running order rewritten.`;
  }

  return null;
}

/** Whether an admin may still change this session. */
export function mayEditSession(state: GroupSessionState): boolean {
  // Once it is scheduled the cohort has been told; once it is live the teams are
  // inside it. Editing either would change the exercise underneath people.
  return state === "draft";
}

/**
 * How the teams are filled.
 *
 * Round robin, in the order people were enrolled, so the teams come out within
 * one of each other however many turn up. Nobody chooses and nobody swaps: the
 * value of running this with people is that the operator and the community
 * argue from briefs that genuinely do not agree, and a room that picks its own
 * teams sorts itself into friends.
 */
export function assignTeams<T>(learners: readonly T[], teams: readonly string[]): Map<string, T[]> {
  const filled = new Map<string, T[]>();
  for (const team of teams) filled.set(team, []);
  if (teams.length === 0) return filled;

  for (const [index, learner] of learners.entries()) {
    const team = teams[index % teams.length];
    filled.get(team)!.push(learner);
  }
  return filled;
}

/** A team with nobody in it, which the admin should know about before it starts. */
export function emptyTeams(filled: Map<string, unknown[]>): string[] {
  return [...filled.entries()].filter(([, members]) => members.length === 0).map(([team]) => team);
}

/**
 * Which beats are due now and have not been delivered.
 *
 * The session has no facilitator, so something has to decide this on a timer.
 * It reads from the session's own start time rather than counting ticks, so a
 * server that restarts mid-session picks up exactly where the clock says it
 * should be rather than where a counter had got to.
 */
export function beatsDue(args: {
  beats: readonly GroupBeat[];
  startedAtMs: number;
  nowMs: number;
  /** Beat ids already on the table. */
  delivered: readonly string[];
}): GroupBeat[] {
  const done = new Set(args.delivered);
  const elapsed = (args.nowMs - args.startedAtMs) / 60_000;
  return args.beats
    .filter((beat) => !done.has(beat.id))
    .filter((beat) => beat.atMinute <= elapsed)
    .sort((a, b) => a.atMinute - b.atMinute);
}

/** How long is left, for the header every team is watching. */
export function minutesLeft(facts: { startedAtMs: number; durationMinutes: number; nowMs: number }): number {
  const endsAt = facts.startedAtMs + facts.durationMinutes * 60_000;
  return Math.max(0, Math.ceil((endsAt - facts.nowMs) / 60_000));
}

/**
 * What one team is allowed to know about another.
 *
 * The answer is: what they said in public, and nothing else. A team beat can
 * quote the operator's statement to the regulator, because in a real crisis the
 * regulator reads the operator's statement. It must never carry the operator's
 * confidential brief, their private discussion, or the fact that they have said
 * nothing at all — that last one is what a real regulator would have to work out
 * for themselves, and handing it over removes the judgement being practised.
 */
export function publicRecord(answers: readonly { teamId: string; body: string }[], exceptTeamId: string): {
  teamId: string;
  body: string;
}[] {
  return answers
    .filter((answer) => answer.teamId !== exceptTeamId)
    .filter((answer) => answer.body.trim().length > 0)
    .map((answer) => ({ teamId: answer.teamId, body: answer.body.trim() }));
}

/** The line the approval screen puts on each beat, so nobody over-reads the vetting. */
export function beatApprovalNote(beat: GroupBeat): string {
  return beat.scope === "all"
    ? "Lands on every team at this minute, in these words."
    : "Lands on one team, written during the session from what that team has just done. "
      + "You are approving what it is for, not its wording.";
}

/** What the admin reads when a session goes live. */
export function wentLiveNote(facts: {
  learners: number;
  teams: number;
  empty: readonly string[];
  durationMinutes: number;
}): string {
  const who = `${facts.learners} ${facts.learners === 1 ? "learner" : "learners"}`;
  const base = `${who} split across ${facts.teams} teams. It runs for ${facts.durationMinutes} minutes `
    + "and ends itself.";
  if (facts.empty.length === 0) return base;
  return `${base} ${facts.empty.length === 1 ? "One team has" : `${facts.empty.length} teams have`} `
    + `nobody in ${facts.empty.length === 1 ? "it" : "them"}: ${facts.empty.join(", ")}. `
    + "The exercise runs anyway, and the other teams will be answering nobody on that side.";
}
