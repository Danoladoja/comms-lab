/**
 * The room a team argues in before it says anything.
 *
 * Until now a team of seven shared one answer box and no way to talk. Anyone
 * could type into it, the last save won, and a team's position was whoever
 * reached the keyboard last — which is not a team's position, and the debrief
 * was marking it as one.
 *
 * So: a room they can talk in, somebody they chose to speak for them, and a
 * rule that the thing sent out had most of them behind it.
 *
 * ## Three rules, and why each is shaped the way it is
 *
 * **A leader, within five minutes.** Chosen by the team, with a clock on it,
 * because a room that spends twenty minutes deciding who speaks has spent the
 * session. When the five minutes are up the count stands however thin it is,
 * and if nobody voted at all the person who walked in first takes it. A team
 * is never left without a leader: leaderless means mute, and mute means a team
 * that did everything right is marked as having said nothing.
 *
 * **Seventy per cent, of the people who actually turned up.** Counted against
 * the room rather than the register, because three of seven never logging in
 * would otherwise make posting arithmetically impossible, and a team would be
 * silenced for other people's absence.
 *
 * **A nod is for a particular draft.** Edit the words and the nods go, every
 * time, including the leader's own. The alternative is approving one sentence
 * and publishing another, which is worse than having no rule at all.
 *
 * ## What the clock does
 *
 * Nothing. It does not wait for a team to converge and it does not rescue one
 * that has not. A draft that has not reached seventy per cent when the
 * development's time runs out does not go, and the team has answered by
 * silence — which is already how this simulation treats a team that says
 * nothing, and is a real finding about them rather than a technical failure.
 */

/** How long a team gets to choose who speaks for it. */
export const ELECTION_MINUTES = 5;

/** The share of the room that has to be behind a draft before it goes. */
export const NOD_SHARE = 0.7;

export type RoomMember = {
  userId: number;
  name: string;
  /** When they first opened the room. Null means they never did. */
  enteredAt: string | null;
  /**
   * An admin or instructor sitting in, rather than somebody being examined.
   *
   * Staff do join live sessions — to see it from the inside, to nudge a team
   * that has frozen, to find out why a room went quiet. That is useful and it
   * must cost the team nothing: a facilitator walking in cannot be allowed to
   * change how many nods the team needs, to be elected to speak for it, or to
   * answer in its name. They are in the room and outside the arithmetic.
   */
  isStaff?: boolean;
};

export type LeaderVote = { voterId: number; forUserId: number };

/* ------------------------------------------------------------------ *
 * Who is actually here
 * ------------------------------------------------------------------ */

/**
 * The people the rules are counted against.
 *
 * Everyone who has opened the room at least once, in the order they arrived.
 * Somebody who logs in and closes their laptop still counts: the alternative is
 * a live "who is online" number, and a threshold that moves every time
 * somebody's wifi drops is a threshold that can be waited out rather than met.
 */
export function present(members: readonly RoomMember[]): RoomMember[] {
  return members
    .filter((m) => m.enteredAt !== null && !m.isStaff)
    .sort((a, b) => (a.enteredAt ?? "").localeCompare(b.enteredAt ?? ""));
}

/**
 * Staff in the room.
 *
 * Listed separately and never folded into the count. Shown to the team, on
 * purpose: a facilitator reading over your shoulder changes how people talk,
 * and the honest answer to that is to say they are there rather than to hide
 * it.
 */
export function observers(members: readonly RoomMember[]): RoomMember[] {
  return members
    .filter((m) => m.enteredAt !== null && m.isStaff === true)
    .sort((a, b) => (a.enteredAt ?? "").localeCompare(b.enteredAt ?? ""));
}

/* ------------------------------------------------------------------ *
 * Choosing who speaks
 * ------------------------------------------------------------------ */

/** Minutes left of the election, or 0 once it is over. */
export function electionMinutesLeft(openedAt: string, nowMs: number): number {
  const opened = new Date(openedAt).getTime();
  if (!Number.isFinite(opened)) return 0;
  const left = opened + ELECTION_MINUTES * 60_000 - nowMs;
  return left <= 0 ? 0 : Math.ceil(left / 60_000);
}

export function electionIsOpen(openedAt: string, nowMs: number): boolean {
  const opened = new Date(openedAt).getTime();
  return Number.isFinite(opened) && nowMs < opened + ELECTION_MINUTES * 60_000;
}

export type Tally = { userId: number; name: string; votes: number }[];

/** The standings, highest first, with everyone present listed even on nought. */
export function tally(members: readonly RoomMember[], votes: readonly LeaderVote[]): Tally {
  const here = present(members);
  const ids = new Set(here.map((m) => m.userId));
  const counted = new Map<number, number>(here.map((m) => [m.userId, 0]));

  // One vote each, and only for somebody who is here. A vote for a name that
  // never turned up would elect an empty chair.
  const used = new Set<number>();
  for (const vote of votes) {
    if (used.has(vote.voterId) || !ids.has(vote.forUserId)) continue;
    used.add(vote.voterId);
    counted.set(vote.forUserId, (counted.get(vote.forUserId) ?? 0) + 1);
  }

  // Arrival order, kept, so a tie falls to whoever walked in first.
  const arrived = new Map(here.map((m, i) => [m.userId, i]));

  return here
    .map((m) => ({ userId: m.userId, name: m.name, votes: counted.get(m.userId) ?? 0 }))
    .sort((a, b) => b.votes - a.votes
      || (arrived.get(a.userId) ?? 0) - (arrived.get(b.userId) ?? 0));
}

/**
 * Who speaks for this team, once the five minutes are up.
 *
 * Most votes. A tie goes to whoever walked in first, which is arbitrary and
 * said out loud rather than hidden — any tie-break is arbitrary, and one that
 * can be explained in a sentence beats one that cannot. No votes at all also
 * goes to the first through the door, because the only other answer is nobody,
 * and nobody means the team cannot speak.
 *
 * Null only when the room is empty, which is a team that never turned up.
 */
export function leaderFrom(members: readonly RoomMember[], votes: readonly LeaderVote[]): number | null {
  const standings = tally(members, votes);
  return standings.length > 0 ? standings[0].userId : null;
}

/** Whether this team has somebody to speak for it yet. */
export function speaksForTeam(args: {
  members: readonly RoomMember[];
  votes: readonly LeaderVote[];
  openedAt: string;
  nowMs: number;
  /** Set once an admin or the team has settled it, which overrides the count. */
  settledLeaderId?: number | null;
}): number | null {
  if (args.settledLeaderId != null) return args.settledLeaderId;
  // While the vote is open there is no leader, even if somebody is ahead: a
  // leader named at minute one is a leader nobody had a chance to oppose.
  if (electionIsOpen(args.openedAt, args.nowMs)) return null;
  return leaderFrom(args.members, args.votes);
}

/* ------------------------------------------------------------------ *
 * Getting a draft out of the room
 * ------------------------------------------------------------------ */

/** How many nods this draft needs, given who is in the room. */
export function nodsNeeded(presentCount: number): number {
  if (presentCount <= 0) return 0;
  // Seventy per cent, rounded up: "at least 70%" of three is 2.1, and two
  // people are not 70% of three. Rounding down would let a minority post.
  return Math.min(presentCount, Math.ceil(presentCount * NOD_SHARE - 1e-9));
}

export type DraftState = {
  body: string;
  /** Bumped whenever the words change, so a nod can name what it approved. */
  version: number;
  authorId: number;
};

/**
 * The nods that still count.
 *
 * A nod names the version it was given to. The leader changing a word takes
 * every nod with it, their own included — otherwise the room approves one
 * sentence and the world reads another, and the rule has made things worse
 * than no rule, because now there is a number beside it.
 */
export function standingNods(
  nods: readonly { userId: number; version: number }[],
  draft: DraftState,
  members: readonly RoomMember[],
): number[] {
  const here = new Set(present(members).map((m) => m.userId));
  const seen = new Set<number>();
  for (const nod of nods) {
    if (nod.version !== draft.version || !here.has(nod.userId)) continue;
    seen.add(nod.userId);
  }
  return [...seen].sort((a, b) => a - b);
}

export type PostCheck = {
  /** Whether the post button does anything. */
  may: boolean;
  needed: number;
  have: number;
  /** What the room is waiting for, in words. Null when it may go. */
  waitingOn: string | null;
};

/**
 * May this draft be sent, and if not, what is it waiting for?
 *
 * One function for the button and the server both, because a gate enforced in
 * the browser is a gate with a hole in it, and a gate enforced twice in two
 * dialects is two gates that will disagree.
 */
export function postCheck(args: {
  members: readonly RoomMember[];
  draft: DraftState | null;
  nods: readonly { userId: number; version: number }[];
  leaderId: number | null;
  /** Who is pressing it. */
  byUserId: number;
  /** Whether the development is still open. */
  stillOpen: boolean;
}): PostCheck {
  const here = present(args.members);
  const needed = nodsNeeded(here.length);
  const have = args.draft ? standingNods(args.nods, args.draft, args.members).length : 0;
  const no = (waitingOn: string): PostCheck => ({ may: false, needed, have, waitingOn });

  if (args.leaderId === null) {
    return no("Your team has not chosen who speaks for it yet.");
  }
  if (args.byUserId !== args.leaderId) {
    // Staff included, and said differently to them, because an admin pressing
    // this has not misunderstood the rule — they have forgotten which hat they
    // are wearing, which is easy to do from inside a room.
    const staff = args.members.find((m) => m.userId === args.byUserId)?.isStaff === true;
    return no(staff
      ? "You are sitting in on this team, not in it. Their reply is theirs to send."
      : "Only the person your team chose can send it.");
  }
  if (!args.draft || args.draft.body.trim().length === 0) {
    return no("There is nothing drafted yet.");
  }
  if (!args.stillOpen) {
    // Said plainly rather than left as a button that does nothing. The clock
    // not waiting is the exercise; a team finding out by silence is not.
    return no("The time for this one has run out. Nothing more can be sent.");
  }
  if (have < needed) {
    const short = needed - have;
    return no(
      `${have} of ${needed} have agreed. ${short} more ${short === 1 ? "nod" : "nods"} and you can send it.`,
    );
  }
  return { may: true, needed, have, waitingOn: null };
}

/* ------------------------------------------------------------------ *
 * What people type at each other
 * ------------------------------------------------------------------ */

export const MAX_MESSAGE = 2000;

/**
 * Why this message cannot be sent.
 *
 * Deliberately thin. This is a room full of colleagues under a clock, not a
 * public forum, and a chat that argues with people about their punctuation
 * while a crisis runs is a chat nobody uses.
 */
export function messageProblem(body: string): string | null {
  const text = body.trim();
  if (text.length === 0) return "Write something first.";
  if (text.length > MAX_MESSAGE) {
    return `That is longer than a message in here can be (${MAX_MESSAGE} characters).`;
  }
  return null;
}

/**
 * The line under the room that says where the team is up to.
 *
 * One sentence, because it sits above a conversation people are reading fast
 * and anything longer is wallpaper.
 */
export function roomStanding(args: {
  members: readonly RoomMember[];
  leaderId: number | null;
  leaderName: string | null;
  openedAt: string;
  nowMs: number;
  draft: DraftState | null;
  nods: readonly { userId: number; version: number }[];
}): string {
  const here = present(args.members);
  if (here.length === 0) return "Nobody is in this room yet.";

  if (args.leaderId === null) {
    const left = electionMinutesLeft(args.openedAt, args.nowMs);
    if (left > 0) {
      return `Choosing who speaks for you — ${left} ${left === 1 ? "minute" : "minutes"} left. `
        + "Talk among yourselves in the meantime.";
    }
    return "Choosing who speaks for you.";
  }

  const needed = nodsNeeded(here.length);
  const have = args.draft ? standingNods(args.nods, args.draft, args.members).length : 0;
  const who = args.leaderName ?? "Your leader";

  if (!args.draft || args.draft.body.trim().length === 0) {
    return `${who} speaks for this team. Nothing drafted yet.`;
  }
  if (have >= needed) return `${have} of ${needed} agreed. ${who} can send it.`;
  return `${who} has drafted a reply. ${have} of ${needed} have agreed so far.`;
}
