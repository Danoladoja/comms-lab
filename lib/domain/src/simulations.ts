/**
 * The Simulation Studio's rules.
 *
 * The Studio is its own thing: a signed-in person opens it, asks for an
 * exercise on a subject, and works through it. It is deliberately not attached
 * to a module, a cohort or a live class, because the version that was could
 * only be found by an admin who already knew where to look, and could not be
 * tried at all outside a running class.
 *
 * Two ways to run one. **Autonomous**: one person, alone, with Claude playing
 * everyone else and writing the debrief at the end. **Facilitated**: a room,
 * where the person who made it holds the controls and everybody else answers.
 */

export type StudioMode = "autonomous" | "facilitated";
export type StudioRunStatus = "active" | "completed";

export function mayEnterStudio(isAdmin: boolean, hasInvitation: boolean, hasRedeemedCode: boolean): boolean {
  return isAdmin || hasInvitation || hasRedeemedCode;
}

export function mayCreateStudioRun(mode: StudioMode, ownerId: number, participantId: number): boolean {
  return mode === "facilitated" || ownerId === participantId;
}

export function mayJoinFacilitatedRun(mode: StudioMode, status: StudioRunStatus, hasJoinCode: boolean): boolean {
  return mode === "facilitated" && status === "active" && hasJoinCode;
}

export function mayAdvanceStudioRun(status: StudioRunStatus, hasSubmittedResponse: boolean): boolean {
  return status === "active" && hasSubmittedResponse;
}

export function mayCompleteStudioRun(status: StudioRunStatus): boolean {
  return status === "active";
}

/**
 * Who may move a run forward, or end it.
 *
 * The owner, in both modes. In an autonomous run the owner is the only person
 * in it. In a facilitated room the owner is the facilitator standing at the
 * front, and the whole point is that participants cannot skip ahead of the
 * person running the class.
 */
export function mayControlStudioRun(_mode: StudioMode, ownerId: number, userId: number): boolean {
  return ownerId === userId;
}

/**
 * The alphabet a join code is drawn from.
 *
 * A facilitator reads this out to a room, and somebody at the back types what
 * they heard. So: no zero against O, no one against I or L, and upper case
 * only. The code arrived as thirty-two hexadecimal characters, which is
 * unimpeachable and unusable.
 */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;

/**
 * What somebody typed, turned into what we stored.
 *
 * Spaces and dashes go, because people write codes out in pairs. So does any
 * character the alphabet does not contain, which quietly absorbs the stray
 * punctuation and leaves a genuinely wrong code wrong rather than guessing at
 * what the person meant.
 */
export function normaliseJoinCode(typed: string): string {
  const allowed = new Set(JOIN_CODE_ALPHABET);
  return [...typed.toUpperCase()].filter((c) => allowed.has(c)).join("").slice(0, JOIN_CODE_LENGTH);
}

export function hasSecureJoinCodeFormat(joinCode: string): boolean {
  return new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`).test(joinCode);
}

export function operationLeaseIsActive(startedAt: Date | null, now: Date, leaseMs: number): boolean {
  return startedAt !== null && startedAt.getTime() > now.getTime() - leaseMs;
}

export function responseVersionMatches(claimedVersion: number, currentVersion: number): boolean {
  return claimedVersion === currentVersion;
}

export function maySeeConfidentialBrief(viewerGroupId: string | null, briefGroupId: string): boolean {
  return viewerGroupId === briefGroupId;
}

/* ---------- Whose exercise is it ---------- */

/**
 * May this person open this exercise?
 *
 * Three ways in, and the third is the one that makes a programme exercise worth
 * writing:
 *
 * - You wrote it. Always, published or not, so a half-finished exercise is
 *   yours alone until you say otherwise.
 * - You are an administrator. You are responsible for what the Lab teaches.
 * - It was written for a programme, it has been published, and you are
 *   enrolled on that programme. Forty people then have an exercise about the
 *   thing they are actually studying, without anybody sending anything.
 *
 * An unpublished programme exercise stays with its author. That is the whole
 * difference between drafting one and putting it in front of a cohort.
 */
export function maySeeStudioSimulation(
  simulation: { ownerId: number; programId: number | null; published: boolean },
  viewer: { id: number; isAdmin: boolean; enrolledProgramIds: readonly number[] },
): boolean {
  if (viewer.id === simulation.ownerId) return true;
  if (viewer.isAdmin) return true;
  if (!simulation.published || simulation.programId === null) return false;
  return viewer.enrolledProgramIds.includes(simulation.programId);
}

/**
 * How many access codes to make in one press.
 *
 * Bounded because each one is a row and a line of text somebody has to
 * distribute by hand, and a mistyped 500 helps nobody.
 */
export const MAX_ACCESS_CODES_AT_ONCE = 50;

export function accessCodeCount(requested: unknown): number {
  const n = typeof requested === "number" ? Math.floor(requested) : Number.parseInt(String(requested ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_ACCESS_CODES_AT_ONCE);
}

/* ---------- How long a solo exercise runs ---------- */

/**
 * How many things should happen before the debrief.
 *
 * A solo exercise should end by itself. Asking somebody to decide when they
 * have practised enough is asking the wrong person: they do not know what is
 * coming, and the honest answer is usually "when I get bored", which is not
 * where the learning is.
 *
 * So the length comes from the time they said they had. Roughly eight minutes
 * a turn, which is about what it takes to read a development properly and
 * write something you would actually send. Never fewer than three, because two
 * exchanges is an anecdote rather than an exercise; never more than six,
 * because attention goes and every turn costs a call.
 */
export const MIN_STUDIO_TURNS = 3;
export const MAX_STUDIO_TURNS = 6;

export function plannedTurns(durationMinutes: number): number {
  const minutes = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 30;
  return Math.max(MIN_STUDIO_TURNS, Math.min(MAX_STUDIO_TURNS, Math.round(minutes / 8)));
}

/** What happens after this answer: another development, or the debrief. */
export type NextStep = "continue" | "finish";

/**
 * Decides it for a solo run, once an answer is in.
 *
 * `developmentsSoFar` counts the opening one, so a run that has had its
 * opening and nothing else is on turn one.
 */
export function nextStudioStep(developmentsSoFar: number, planned: number): NextStep {
  return developmentsSoFar >= planned ? "finish" : "continue";
}

/* ---------- A practice record ---------- */

export type StudioRating = { name: string; score: number; note?: string };

export type CompletedRun = {
  endedAt: string | Date | null;
  title: string;
  score: number;
  ratings?: readonly StudioRating[];
  minutes?: number;
};

export type PracticeRecord = {
  runs: number;
  minutes: number;
  latestScore: number | null;
  bestScore: number | null;
  /** Mean across every run that scored it, strongest first. */
  strengths: { name: string; score: number; runs: number }[];
  /** The same list, weakest first. Same data, read the other way. */
  toWorkOn: { name: string; score: number; runs: number }[];
  /** Most recent last, for a line that goes somewhere. */
  trend: { title: string; score: number; endedAt: string | null }[];
};

/**
 * What somebody has actually done in the Studio.
 *
 * Deliberately not a grade and deliberately not comparative. There is no rank,
 * no badge and nobody else's number anywhere in it. Senior people do not
 * practise in a place that scores them against their peers; they practise
 * where they can be bad at something privately and watch it improve.
 *
 * So what it shows is: how much you have done, what you are reliably good at,
 * and what has not moved yet. The reward is the second and third of those
 * becoming visible, which is a thing you cannot see from inside a single run.
 */
export function practiceRecord(runs: readonly CompletedRun[]): PracticeRecord {
  const done = [...runs].sort((a, b) => time(a.endedAt) - time(b.endedAt));

  const totals = new Map<string, { total: number; runs: number }>();
  for (const run of done) {
    for (const rating of run.ratings ?? []) {
      const name = rating.name.trim();
      if (!name || !Number.isFinite(rating.score)) continue;
      const soFar = totals.get(name) ?? { total: 0, runs: 0 };
      totals.set(name, { total: soFar.total + rating.score, runs: soFar.runs + 1 });
    }
  }

  const averaged = [...totals.entries()]
    .map(([name, { total, runs: n }]) => ({ name, score: Math.round(total / n), runs: n }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  const scores = done.map((run) => run.score).filter((s) => Number.isFinite(s));

  return {
    runs: done.length,
    minutes: done.reduce((sum, run) => sum + (Number.isFinite(run.minutes) ? (run.minutes as number) : 0), 0),
    latestScore: scores.length > 0 ? scores[scores.length - 1] : null,
    bestScore: scores.length > 0 ? Math.max(...scores) : null,
    strengths: averaged.slice(0, 3),
    toWorkOn: [...averaged].reverse().slice(0, 3),
    trend: done.slice(-8).map((run) => ({
      title: run.title,
      score: run.score,
      endedAt: run.endedAt ? new Date(run.endedAt).toISOString() : null,
    })),
  };
}

function time(value: string | Date | null): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/* ---------- The clock ---------- */

/**
 * Two clocks, and they do different jobs.
 *
 * The **session** clock is the exercise's length. When it runs out the
 * exercise is over and the debrief is written, whatever state the current turn
 * is in. That is the honest end: you had half an hour, and half an hour is
 * what you got.
 *
 * The **response** clock is the deadline on the thing in front of you. A
 * reporter files at six whether or not you called back. When it runs out the
 * turn is over and the story moves on without your answer, which is not a
 * punishment but the actual consequence, and it is the reason the room goes
 * quiet when the number gets low.
 *
 * Both are computed from timestamps rather than counted down anywhere, because
 * a countdown in a browser is a guess: laptops sleep, tabs are backgrounded,
 * phones throttle timers. The browser shows a clock; the server decides what
 * time it is.
 */

export type RunClock = {
  /** Seconds left in the exercise. Zero once it is up. */
  sessionSecondsLeft: number;
  /** Seconds left to answer the thing on the table, or null when there is no deadline. */
  responseSecondsLeft: number | null;
  sessionExpired: boolean;
  responseExpired: boolean;
};

/** Never less than a minute: a deadline nobody can meet teaches nothing. */
export const MIN_RESPONSE_SECONDS = 60;
export const MAX_RESPONSE_SECONDS = 15 * 60;

export function clampResponseSeconds(seconds: unknown): number {
  const n = typeof seconds === "number" ? seconds : Number.parseInt(String(seconds ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 4 * 60;
  return Math.max(MIN_RESPONSE_SECONDS, Math.min(MAX_RESPONSE_SECONDS, Math.round(n)));
}

/**
 * How long the whole exercise lasts, from when it started.
 *
 * A grace of one turn's worth is added, because the person is answering in
 * prose and the clock should not cut them off mid sentence on the last one.
 */
export function sessionEndsAt(startedAt: Date | string | null, durationMinutes: number, graceSeconds = 60): Date | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return null;
  const minutes = Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 30;
  return new Date(start + minutes * 60_000 + graceSeconds * 1000);
}

export function runClock(args: {
  startedAt: Date | string | null;
  durationMinutes: number;
  /** When the answer to the current development is due. */
  responseDueAt: Date | string | null;
  status: StudioRunStatus;
  now?: Date;
}): RunClock {
  const now = (args.now ?? new Date()).getTime();
  const ends = sessionEndsAt(args.startedAt, args.durationMinutes);
  const sessionSecondsLeft = ends ? Math.max(0, Math.round((ends.getTime() - now) / 1000)) : 0;

  const due = args.responseDueAt ? new Date(args.responseDueAt).getTime() : NaN;
  const responseSecondsLeft = Number.isFinite(due) ? Math.max(0, Math.round((due - now) / 1000)) : null;

  // A finished run has no clock. Reporting one would make a completed exercise
  // look as though it were still going, and would keep the debrief hidden.
  if (args.status !== "active") {
    return { sessionSecondsLeft: 0, responseSecondsLeft: null, sessionExpired: false, responseExpired: false };
  }

  return {
    sessionSecondsLeft,
    responseSecondsLeft,
    sessionExpired: !!ends && sessionSecondsLeft === 0,
    responseExpired: responseSecondsLeft === 0,
  };
}

/** "4:05", or "0:12" when it is getting interesting. */
export function formatClock(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * What to do with a run somebody has just looked at.
 *
 * The clocks only bite when a request arrives, which is enough: an exercise
 * nobody is watching is not one anybody is being timed on, and the moment they
 * come back the right thing happens.
 */
export type ClockAction = "nothing" | "finish" | "moveOn";

export function whatTheClockSays(clock: RunClock, mode: StudioMode): ClockAction {
  if (clock.sessionExpired) return "finish";
  // Only a solo run moves itself on. A room's facilitator is the clock.
  if (clock.responseExpired && mode === "autonomous") return "moveOn";
  return "nothing";
}
