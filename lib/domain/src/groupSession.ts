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

/* ------------------------------------------------------------------ *
 * What each team sees of a shared run
 * ------------------------------------------------------------------ */

/**
 * The developments this team is entitled to.
 *
 * One run carries the whole session, so the feed has to be filtered rather than
 * duplicated — a beat aimed at the regulator must not appear on the operator's
 * screen, and a beat aimed at everybody must appear on all of them. Absent means
 * everybody, which is also what every run written before group sessions existed
 * means by it.
 */
export function developmentsForTeam<T extends { teamId?: string }>(
  developments: readonly T[],
  teamId: string | null,
): T[] {
  return developments.filter((d) => !d.teamId || d.teamId === teamId);
}

/**
 * What the ticker should do to this session right now.
 *
 * One function rather than a chain of ifs inside the timer, because the timer
 * runs unattended every few seconds and the thing it must never do is two of
 * these at once — start a session and immediately end it, or deliver a beat to
 * a session that has already finished.
 */
export type TickAction =
  | { do: "nothing" }
  | { do: "start" }
  | { do: "deliver"; beats: GroupBeat[] }
  | { do: "finish" };

export function whatTheTickerShouldDo(args: {
  facts: GroupSessionFacts;
  beats: readonly GroupBeat[];
  delivered: readonly string[];
  nowMs: number;
}): TickAction {
  const state = groupSessionState(args.facts, args.nowMs);

  if (state === "finished") return { do: "nothing" };

  if (state === "scheduled") {
    if (!args.facts.scheduledAt) return { do: "nothing" };
    const startsAt = new Date(args.facts.scheduledAt).getTime();
    return Number.isFinite(startsAt) && args.nowMs >= startsAt ? { do: "start" } : { do: "nothing" };
  }

  if (state === "live" && args.facts.startedAt) {
    const startedAtMs = new Date(args.facts.startedAt).getTime();
    const due = beatsDue({ beats: args.beats, startedAtMs, nowMs: args.nowMs, delivered: args.delivered });
    if (due.length > 0) return { do: "deliver", beats: due };
    return { do: "nothing" };
  }

  // Live by the dates but past its end: `groupSessionState` has already said
  // "finished" for that, so reaching here means a session whose clock ran out
  // without anybody closing it. The caller writes the debriefs.
  return { do: "nothing" };
}

/**
 * A session that is over but has not been closed.
 *
 * Separate from the tick action because closing one is expensive — a debrief per
 * team plus a shared one — and the timer must be able to ask the cheap question
 * on every pass and the expensive one only when the answer is yes.
 */
export function needsClosing(facts: GroupSessionFacts, nowMs: number): boolean {
  if (facts.endedAt || !facts.startedAt) return false;
  return groupSessionState(facts, nowMs) === "finished";
}

/* ------------------------------------------------------------------ *
 * What a learner on the cohort is told
 * ------------------------------------------------------------------ */

/**
 * The room is open.
 *
 * Only while it is live. Before that there is nothing to walk into — teams do
 * not exist until the session starts, because they are decided from who is
 * actually enrolled at that moment. After it, the door is the debrief rather
 * than the room.
 */
export function mayEnterRoom(state: GroupSessionState): boolean {
  return state === "live";
}

/** How long until it starts, in whole minutes. Null when nothing is scheduled. */
export function startsInMinutes(scheduledAt: string | null, nowMs: number): number | null {
  if (!scheduledAt) return null;
  const at = new Date(scheduledAt).getTime();
  if (!Number.isFinite(at)) return null;
  return Math.ceil((at - nowMs) / 60_000);
}

/**
 * The one sentence a learner reads about their cohort's session.
 *
 * Written to be true at every point on the clock, including the two awkward
 * ones: the minute before it starts, when there is no team to name because
 * nobody has been put in one yet, and the minute after it ends, when the room
 * is gone but the debrief is not.
 *
 * It says "it does not wait for you" on purpose. A learner who believes the
 * exercise pauses for them will treat a late arrival as free, and the thing
 * being practised here is precisely what happens when it is not.
 */
export function cohortNote(args: {
  state: GroupSessionState;
  startsIn: number | null;
  teamName: string | null;
  durationMinutes: number;
  minutesLeft: number | null;
}): string {
  if (args.state === "finished") {
    return "This one has finished. Your team's debrief is below.";
  }

  if (args.state === "live") {
    const team = args.teamName
      ? `You are on ${args.teamName}.`
      : "You are being put in a team now.";
    const left = args.minutesLeft !== null && args.minutesLeft > 0
      ? `${args.minutesLeft} ${args.minutesLeft === 1 ? "minute" : "minutes"} left.`
      : "It is about to end.";
    return `${team} ${left} Go in — it does not wait for you.`;
  }

  const runs = `It runs for ${args.durationMinutes} minutes and teams are decided when it starts.`;
  if (args.startsIn === null) return `Your cohort has a group exercise coming. ${runs}`;
  if (args.startsIn <= 0) return `It is starting now. ${runs}`;
  if (args.startsIn < 60) {
    return `Starts in ${args.startsIn} ${args.startsIn === 1 ? "minute" : "minutes"}. ${runs}`;
  }
  const hours = Math.round(args.startsIn / 60);
  if (hours < 48) {
    return `Starts in about ${hours} ${hours === 1 ? "hour" : "hours"}. ${runs}`;
  }
  const days = Math.round(hours / 24);
  return `Starts in about ${days} days. ${runs}`;
}

/**
 * This team's debrief, out of the set written for the room.
 *
 * Each team only ever saw its own side of the crisis, so each team is judged on
 * its own side of it. Null rather than a fallback to somebody else's: a learner
 * reading another team's verdict on their own screen is worse than a learner
 * reading nothing.
 */
export function debriefForTeam<T extends { teamId: string }>(
  debriefs: readonly T[] | null | undefined,
  teamId: string | null,
): T | null {
  if (!debriefs || !teamId) return null;
  return debriefs.find((d) => d.teamId === teamId) ?? null;
}

/**
 * A run nobody is driving.
 *
 * A facilitated run made by an admin has a code they read out to the room; a
 * cohort session has none, because the cohort *is* the room and a code would be
 * a way in for somebody who is not on it. So the absence of the code is the
 * fact that tells the screen there is no facilitator to wait for — which
 * matters, because the old room screen told participants to wait for one.
 */
export function isUnattendedRoom(run: { mode: string; joinCode: string | null }): boolean {
  return run.mode === "facilitated" && !run.joinCode;
}

/* ------------------------------------------------------------------ *
 * When planning is refused
 * ------------------------------------------------------------------ */

/**
 * What to do about a refusal, as well as what it said.
 *
 * Planning a session is the longest chain of preconditions in the Lab: a role,
 * a key on the server, a model that is still served, a programme, and two model
 * calls that each have to come back usable. Every one of those produced the
 * same four words on the screen — "Could not plan the session" — in a toast
 * that cleared itself before anybody could write it down. The reason had been
 * written by the server, sent over the wire, received by the browser and shown
 * for four seconds, which from the outside is the same as never saying it.
 *
 * The reason now stays on the screen. This adds the second half of it: the
 * thing to actually do, which the server cannot say because it is a thing in
 * Railway or in somebody's Clerk role and not in the request.
 *
 * Deliberately not a mapping of every code. Where there is nothing useful to
 * add, this says nothing and the server's own sentence stands alone — a made-up
 * suggestion is worse than none, because it sends somebody looking in the wrong
 * place.
 */
export function whatToDoAboutPlanning(status: number | null): string | null {
  if (status === 403) {
    return "Planning a session needs an admin role. If that is you, sign out and back in — "
      + "a role changed in Clerk reaches the Lab on your next sign-in.";
  }
  if (status === 503) {
    return "The server has no AI key set, so it cannot write anything. Set ANTHROPIC_API_KEY "
      + "in Railway, then redeploy.";
  }
  if (status === 404) {
    return "That programme is no longer there. Refresh the page and choose it again.";
  }
  if (status === 502) {
    return "Nothing is wrong with the Lab: the AI either refused or came back with something "
      + "unusable. Pressing it again usually works, because each attempt writes a different "
      + "crisis. If the message mentions a model, the model named in ANTHROPIC_MODEL is the "
      + "thing to change.";
  }
  if (status !== null && status >= 500) {
    // The server now names the step it crashed at and the kind of fault, so the
    // useful thing to do with this is pass the sentence on rather than go
    // looking for a log. Trying again is still worth one attempt: a crash in
    // one of the two AI steps can be a one-off reply in an odd shape.
    return "This is a fault in the Lab, not in anything you did, and nothing reached the cohort. "
      + "Try once more; if it says the same thing, send the sentence above on — it names the "
      + "step that broke.";
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The two shapes a session can take
 * ------------------------------------------------------------------ */

/**
 * One crisis, two ways of being in it.
 *
 * These are different exercises, not a setting and its default, and the words
 * on the screen say so: picking one decides what the cohort is being tested on
 * for forty-five minutes.
 *
 *   **Rapid Response Session.** Anyone on the team can answer and the first
 *   answer in is the team's answer. Nerve, speed, and the judgement to go
 *   without waiting to be told you may. It is the shape the Lab started with
 *   and the one learners ask for by name.
 *
 *   **Group Session.** The team argues in a room nobody else sees, chooses
 *   somebody to speak for it, and sends nothing until seventy per cent of the
 *   people present are behind the words. Deliberation under a clock that does
 *   not stop for it.
 *
 * Nothing shares a rule between them, which is the point. A rapid session with
 * a seventy per cent threshold is not rapid, and a room where anybody can post
 * around the room is not a room.
 */
export type SessionFormat = "rapid" | "room";

export const SESSION_FORMATS: readonly SessionFormat[] = ["rapid", "room"];

export function isSessionFormat(value: unknown): value is SessionFormat {
  return value === "rapid" || value === "room";
}

/** What it is called on the screen, in the Lab's own words. */
export function formatName(format: SessionFormat): string {
  return format === "room" ? "Group Session" : "Rapid Response Session";
}

/** The one line that tells an admin what they are choosing. */
export function formatNote(format: SessionFormat): string {
  return format === "room"
    ? "Each team talks in a room only they can see, chooses somebody to speak for it, and sends "
      + "nothing until 70% of the people present are behind the words."
    : "Anyone on a team can answer, and the first answer in is the team's answer. No chat, no "
      + "leader, no threshold — speed and nerve.";
}

/** What a learner is told before they type. */
export function formatBrief(format: SessionFormat): string {
  return format === "room"
    ? "Your team agrees before anything is sent."
    : "Fastest finger. The first answer from your team is the one that lands.";
}

/** Whether the first answer in wins and the rest are too late. */
export function firstAnswerWins(format: SessionFormat): boolean {
  return format === "rapid";
}

/** Whether this session's teams get a room to argue in. */
export function usesTeamRoom(format: SessionFormat): boolean {
  return format === "room";
}

/**
 * What to tell somebody whose answer arrived second.
 *
 * Not an error. They did the exercise, somebody on their team was quicker, and
 * that is the result rather than a fault — so it names who got there and shows
 * what went, because a person told only "too late" will spend the next beat
 * wondering whether the Lab lost their work.
 */
export function beatenToIt(by: string | null): string {
  return by
    ? `${by} got there first. Theirs is your team's answer for this one.`
    : "Somebody on your team got there first. Theirs is your team's answer for this one.";
}
