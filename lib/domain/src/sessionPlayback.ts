/**
 * What actually happened, in the order it happened.
 *
 * A session is forty-five minutes long, runs in four rooms at once, and nobody
 * can be in more than one of them. The admin who planned it watched a list of
 * names go green and read four debriefs afterwards, which is the outcome
 * without any of the behaviour — and the behaviour is the thing being taught.
 *
 * So this reassembles the session from what was already being recorded for
 * other reasons: when each person walked in, when each development landed and
 * on whom, what each team said to each other on the way to an answer, when the
 * answer went, and who was behind it. Nothing new is captured. The record
 * existed; there was no way to read it.
 *
 * ## What it is honest about
 *
 * Timings are as good as the record allows and no better. A development's
 * delivery is derived from its deadline and the time it allowed, because that
 * is what was stored; where neither exists the entry has no clock on it and
 * says so rather than inventing one. A thing shown at minute 12 was at minute
 * 12; a thing shown without a minute is a thing whose minute is not known.
 *
 * ## What it withholds
 *
 * A team's room, from sessions whose learners were told nobody but their own
 * team would ever read it. That promise was made in the room itself, and a
 * promise made to twenty-nine people is not undone by changing a sentence
 * afterwards — so the cut-off below is a date, and sessions before it keep the
 * terms they were run under.
 */

export type PlaybackKind =
  | "started" | "arrived" | "beat" | "answer"
  | "message" | "vote" | "draft" | "nod" | "ended";

export type PlaybackEntry = {
  /** Milliseconds since the epoch, or null when the record does not say. */
  atMs: number | null;
  /** Minutes from the start, or null when the time is not known. */
  minute: number | null;
  kind: PlaybackKind;
  /** The team this belongs to. Null means the whole room. */
  teamId: string | null;
  /** Who did it, where a person did it. */
  who: string | null;
  /** One line, already written for a reader. */
  title: string;
  /** The words themselves, where there are any. */
  body: string | null;
};

/**
 * When the room started telling learners that facilitators can read it.
 *
 * Sessions that began before this ran under the old sentence — "Only your team
 * sees this" — and their rooms stay closed. The same shape as the Lab's other
 * dated rule changes, and for the same reason: a rule that applies to what has
 * already happened is a rule nobody agreed to.
 */
export const ROOM_REVIEW_NOTICE_FROM = "2026-10-04T00:00:00.000Z";

/** Whether this session's rooms may be read back. */
export function roomIsReviewable(startedAt: string | null): boolean {
  if (!startedAt) return false;
  const began = new Date(startedAt).getTime();
  const from = new Date(ROOM_REVIEW_NOTICE_FROM).getTime();
  return Number.isFinite(began) && began >= from;
}

/** What to say where a room is withheld, rather than showing an empty panel. */
export function roomWithheldNote(): string {
  return "This session's team rooms are not shown. The people in them were told that only their "
    + "own team would ever read what they typed, and that was true when they typed it.";
}

function minutesFrom(startedAtMs: number | null, atMs: number | null): number | null {
  if (startedAtMs === null || atMs === null) return null;
  return Math.max(0, Math.floor((atMs - startedAtMs) / 60_000));
}

function ms(value: string | null | undefined): number | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
}

/**
 * When a development was put on the table.
 *
 * Derived, because nothing stored the moment itself: the deadline was written
 * when it landed, and the time allowed is beside it. Where either is missing
 * this gives null rather than a guess — a wrong minute on a timeline is worse
 * than no minute, because it reads as a fact.
 */
export function beatLandedAt(beat: { dueAt?: string | null; responseSeconds?: number | null }): number | null {
  const due = ms(beat.dueAt ?? null);
  if (due === null) return null;
  const allowed = beat.responseSeconds;
  return typeof allowed === "number" && Number.isFinite(allowed) ? due - allowed * 1000 : due;
}

export type PlaybackInput = {
  startedAt: string | null;
  endedAt: string | null;
  teams: readonly { id: string; name: string }[];
  /** Everybody who was put in a team, and when they walked in. */
  people: readonly {
    userId: number; name: string; teamId: string; enteredAt: string | null;
    /** An admin or instructor who sat in, rather than somebody being examined. */
    isStaff?: boolean;
  }[];
  developments: readonly {
    id: string; title: string; content: string;
    teamId?: string | null; dueAt?: string | null; responseSeconds?: number | null;
  }[];
  answers: readonly {
    teamId: string; injectId: string; body: string; authorId: number; createdAt: string;
  }[];
  /** The rooms. Empty for a Rapid Response Session, and withheld where the promise says so. */
  messages?: readonly { teamId: string; userId: number; body: string; createdAt: string }[];
  votes?: readonly { teamId: string; voterId: number; forUserId: number; createdAt: string }[];
  drafts?: readonly { teamId: string; version: number; body: string; authorId: number; createdAt: string }[];
  nods?: readonly { teamId: string; userId: number; version: number; createdAt: string }[];
};

/**
 * The session, as a list a person can read top to bottom.
 *
 * Sorted by time, with everything whose time is unknown kept in the order the
 * record had it and shown after the things that are placed — so an older run
 * with no deadlines still reads as a sequence rather than collapsing into the
 * first minute.
 */
export function buildPlayback(input: PlaybackInput): PlaybackEntry[] {
  const startedAtMs = ms(input.startedAt);
  /*
    Staff are named as staff, everywhere they appear.

    An admin does join a live session, and when the room is read back months
    later their messages are indistinguishable from a learner's unless the
    label travels with the name. A facilitator's nudge read as a learner's idea
    would change what the debrief appears to show about that team.
  */
  const nameOf = new Map(input.people.map((p) => [
    p.userId, p.isStaff ? `${p.name} (facilitator)` : p.name,
  ]));
  const teamName = new Map(input.teams.map((t) => [t.id, t.name]));
  const entries: PlaybackEntry[] = [];

  const add = (e: Omit<PlaybackEntry, "minute">) =>
    entries.push({ ...e, minute: minutesFrom(startedAtMs, e.atMs) });

  if (startedAtMs !== null) {
    add({
      atMs: startedAtMs, kind: "started", teamId: null, who: null,
      title: "The session opened", body: null,
    });
  }

  for (const person of input.people) {
    if (!person.enteredAt) continue;
    const who = nameOf.get(person.userId) ?? person.name;
    add({
      atMs: ms(person.enteredAt), kind: "arrived", teamId: person.teamId, who,
      title: person.isStaff ? `${who} sat in` : `${who} walked in`, body: null,
    });
  }

  for (const beat of input.developments) {
    const landedOn = beat.teamId ? teamName.get(beat.teamId) ?? beat.teamId : null;
    add({
      atMs: beatLandedAt(beat), kind: "beat", teamId: beat.teamId ?? null, who: null,
      title: landedOn ? `${beat.title} — to ${landedOn} only` : beat.title,
      body: beat.content,
    });
  }

  for (const answer of input.answers) {
    const who = nameOf.get(answer.authorId) ?? null;
    add({
      atMs: ms(answer.createdAt), kind: "answer", teamId: answer.teamId, who,
      title: `${teamName.get(answer.teamId) ?? answer.teamId} answered${who ? `, sent by ${who}` : ""}`,
      body: answer.body,
    });
  }

  for (const said of input.messages ?? []) {
    const who = nameOf.get(said.userId) ?? "Somebody";
    add({
      atMs: ms(said.createdAt), kind: "message", teamId: said.teamId, who,
      title: who, body: said.body,
    });
  }

  for (const vote of input.votes ?? []) {
    const voter = nameOf.get(vote.voterId) ?? "Somebody";
    const choice = nameOf.get(vote.forUserId) ?? "somebody";
    add({
      atMs: ms(vote.createdAt), kind: "vote", teamId: vote.teamId, who: voter,
      title: `${voter} voted for ${choice}`, body: null,
    });
  }

  for (const draft of input.drafts ?? []) {
    const who = nameOf.get(draft.authorId) ?? "The leader";
    add({
      atMs: ms(draft.createdAt), kind: "draft", teamId: draft.teamId, who,
      title: draft.version > 1
        ? `${who} rewrote the reply (version ${draft.version}) — every nod cleared`
        : `${who} drafted the reply`,
      body: draft.body,
    });
  }

  for (const nod of input.nods ?? []) {
    const who = nameOf.get(nod.userId) ?? "Somebody";
    add({
      atMs: ms(nod.createdAt), kind: "nod", teamId: nod.teamId, who,
      title: `${who} agreed to the reply as it stood`, body: null,
    });
  }

  const endedAtMs = ms(input.endedAt);
  if (endedAtMs !== null) {
    add({
      atMs: endedAtMs, kind: "ended", teamId: null, who: null,
      title: "The session ended", body: null,
    });
  }

  // Placed things first, in time order; unplaced things after, in the order the
  // record held them. A stable sort, so two things in the same second keep the
  // order they were added rather than swapping about between reads.
  return entries
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => {
      if (a.entry.atMs === null && b.entry.atMs === null) return a.i - b.i;
      if (a.entry.atMs === null) return 1;
      if (b.entry.atMs === null) return -1;
      return a.entry.atMs - b.entry.atMs || a.i - b.i;
    })
    .map((pair) => pair.entry);
}

/** How long the session ran, for the scrubber. Null when it never started. */
export function playbackMinutes(entries: readonly PlaybackEntry[]): number {
  const placed = entries.map((e) => e.minute).filter((m): m is number => m !== null);
  return placed.length > 0 ? Math.max(...placed) : 0;
}

/**
 * One line summing up a team's session.
 *
 * The thing an admin is actually looking for when they open this: did they
 * talk, did they agree, did they answer, and how late.
 */
export function teamSummary(entries: readonly PlaybackEntry[], teamId: string): string {
  const theirs = entries.filter((e) => e.teamId === teamId);
  // "Walked in", not "sat in": a facilitator visiting is not a team of five.
  const arrived = theirs.filter((e) => e.kind === "arrived" && e.title.endsWith("walked in")).length;
  const said = theirs.filter((e) => e.kind === "message").length;
  const answers = theirs.filter((e) => e.kind === "answer");

  const parts = [`${arrived} walked in`];
  if (said > 0) parts.push(`${said} ${said === 1 ? "message" : "messages"}`);
  parts.push(answers.length === 0
    ? "answered nothing"
    : `${answers.length} ${answers.length === 1 ? "answer" : "answers"} sent`);
  return parts.join(" · ");
}
