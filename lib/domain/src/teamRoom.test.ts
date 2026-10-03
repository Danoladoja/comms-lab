import { describe, expect, it } from "vitest";
import {
  ELECTION_MINUTES, NOD_SHARE,
  present, electionMinutesLeft, electionIsOpen, tally, leaderFrom, speaksForTeam,
  nodsNeeded, standingNods, postCheck, messageProblem, roomStanding, MAX_MESSAGE,
  type RoomMember,
} from "./teamRoom";

/**
 * The rules a team is held to before it is allowed to speak.
 *
 * Worth testing harder than most of this codebase, for a reason that is not
 * about code quality: these rules run while twenty-nine people are in a room
 * under a clock that does not stop, and every one of them is a way to silence a
 * team that did nothing wrong. A threshold that cannot be met, a leader who is
 * never chosen, a nod that survives an edit — each of those looks like a small
 * arithmetic mistake and arrives as a group of seven professionals watching a
 * button that will not work.
 */

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 3, 17, minutes)).toISOString();
const OPENED = at(0);
const nowAt = (minutes: number) => Date.UTC(2026, 9, 3, 17, minutes);

const member = (userId: number, name: string, enteredAt: string | null): RoomMember =>
  ({ userId, name, enteredAt });

/** Seven assigned, five of whom actually turned up. The realistic case. */
const TEAM: RoomMember[] = [
  member(1, "Amara", at(0)),
  member(2, "Boubacar", at(1)),
  member(3, "Chioma", at(1)),
  member(4, "Dauda", at(2)),
  member(5, "Esi", at(4)),
  member(6, "Fatou", null),
  member(7, "Gcina", null),
];

describe("who the rules are counted against", () => {
  it("counts the people who turned up, not the register", () => {
    expect(present(TEAM).map((m) => m.name)).toEqual(["Amara", "Boubacar", "Chioma", "Dauda", "Esi"]);
  });

  it("puts them in the order they arrived", () => {
    expect(present(TEAM)[0].name).toBe("Amara");
    expect(present(TEAM).at(-1)?.name).toBe("Esi");
  });
});

describe("how many have to agree", () => {
  it("is seventy per cent, rounded up", () => {
    // "At least 70%" of three is 2.1, and two people are not 70% of three.
    // Rounding down here would let a minority speak for the team.
    expect(nodsNeeded(3)).toBe(3);
    expect(nodsNeeded(4)).toBe(3);
    expect(nodsNeeded(5)).toBe(4);
    expect(nodsNeeded(7)).toBe(5);
    expect(nodsNeeded(10)).toBe(7);
  });

  it("never asks for more nods than there are people", () => {
    // The failure that silences a team: a threshold nobody could ever reach.
    for (let here = 1; here <= 30; here += 1) {
      expect(nodsNeeded(here), `${here} present`).toBeLessThanOrEqual(here);
      expect(nodsNeeded(here), `${here} present`).toBeGreaterThanOrEqual(1);
      expect(nodsNeeded(here) / here, `${here} present`).toBeGreaterThanOrEqual(NOD_SHARE - 1e-9);
    }
  });

  it("asks nothing of an empty room", () => {
    expect(nodsNeeded(0)).toBe(0);
  });
});

describe("choosing who speaks", () => {
  const votes = [
    { voterId: 1, forUserId: 2 },
    { voterId: 2, forUserId: 2 },
    { voterId: 3, forUserId: 4 },
  ];

  it("runs for five minutes and then stops", () => {
    expect(ELECTION_MINUTES).toBe(5);
    expect(electionIsOpen(OPENED, nowAt(4))).toBe(true);
    expect(electionIsOpen(OPENED, nowAt(5))).toBe(false);
    expect(electionMinutesLeft(OPENED, nowAt(2))).toBe(3);
    expect(electionMinutesLeft(OPENED, nowAt(9))).toBe(0);
  });

  it("names nobody while the vote is still open", () => {
    // Somebody is ahead at minute one. Calling them the leader would be naming
    // a leader nobody had a chance to oppose.
    expect(speaksForTeam({ members: TEAM, votes, openedAt: OPENED, nowMs: nowAt(2) })).toBeNull();
  });

  it("names whoever has the most votes once it closes", () => {
    expect(speaksForTeam({ members: TEAM, votes, openedAt: OPENED, nowMs: nowAt(6) })).toBe(2);
  });

  it("gives a tie to whoever walked in first", () => {
    const tied = [{ voterId: 1, forUserId: 4 }, { voterId: 2, forUserId: 5 }];
    // Dauda arrived at minute 2, Esi at minute 4. Arbitrary, and said out loud.
    expect(leaderFrom(TEAM, tied)).toBe(4);
  });

  it("never leaves a team that turned up without somebody to speak", () => {
    // The one that matters. Leaderless is mute, and mute is a team that did
    // everything right being marked as having said nothing.
    expect(leaderFrom(TEAM, [])).toBe(1);
    expect(speaksForTeam({ members: TEAM, votes: [], openedAt: OPENED, nowMs: nowAt(6) })).toBe(1);
  });

  it("has nobody to name when nobody turned up", () => {
    const empty = TEAM.map((m) => ({ ...m, enteredAt: null }));
    expect(leaderFrom(empty, [])).toBeNull();
  });

  it("ignores a second vote from the same person", () => {
    const twice = [
      { voterId: 1, forUserId: 2 },
      { voterId: 1, forUserId: 3 },
      { voterId: 1, forUserId: 3 },
    ];
    expect(tally(TEAM, twice).find((t) => t.userId === 2)?.votes).toBe(1);
    expect(tally(TEAM, twice).find((t) => t.userId === 3)?.votes).toBe(0);
  });

  it("ignores a vote for somebody who never turned up", () => {
    // Electing an empty chair is the same as electing nobody.
    expect(tally(TEAM, [{ voterId: 1, forUserId: 6 }]).some((t) => t.userId === 6)).toBe(false);
    expect(leaderFrom(TEAM, [{ voterId: 1, forUserId: 6 }])).toBe(1);
  });

  it("lists everybody present, including those on nought", () => {
    expect(tally(TEAM, votes)).toHaveLength(5);
    expect(tally(TEAM, votes).map((t) => t.votes)).toEqual([2, 1, 0, 0, 0]);
  });

  it("takes a settled leader over the count", () => {
    expect(speaksForTeam({
      members: TEAM, votes, openedAt: OPENED, nowMs: nowAt(2), settledLeaderId: 5,
    })).toBe(5);
  });
});

describe("a nod is for a particular draft", () => {
  const draft = { body: "We confirm the leak and name the time we knew.", version: 3, authorId: 2 };

  it("counts the nods given to these words", () => {
    const nods = [{ userId: 1, version: 3 }, { userId: 2, version: 3 }, { userId: 3, version: 3 }];
    expect(standingNods(nods, draft, TEAM)).toEqual([1, 2, 3]);
  });

  it("drops every nod when the words change", () => {
    // The rule this whole thing rests on. Approving one sentence and
    // publishing another is worse than no rule, because now there is a number
    // beside it that says the team agreed.
    const old = [{ userId: 1, version: 2 }, { userId: 2, version: 2 }, { userId: 3, version: 2 }];
    expect(standingNods(old, draft, TEAM)).toEqual([]);
  });

  it("drops the leader's own nod on an edit too", () => {
    const mixed = [{ userId: 2, version: 2 }, { userId: 1, version: 3 }];
    expect(standingNods(mixed, draft, TEAM)).toEqual([1]);
  });

  it("counts one nod per person", () => {
    const twice = [{ userId: 1, version: 3 }, { userId: 1, version: 3 }];
    expect(standingNods(twice, draft, TEAM)).toEqual([1]);
  });

  it("ignores a nod from somebody who never turned up", () => {
    expect(standingNods([{ userId: 6, version: 3 }], draft, TEAM)).toEqual([]);
  });
});

describe("whether it may be sent", () => {
  const draft = { body: "We confirm the leak.", version: 1, authorId: 2 };
  const base = { members: TEAM, draft, leaderId: 2, byUserId: 2, stillOpen: true };
  const nodsFrom = (...ids: number[]) => ids.map((userId) => ({ userId, version: 1 }));

  it("lets the leader send it once enough have agreed", () => {
    // Five present, so four nods.
    const check = postCheck({ ...base, nods: nodsFrom(1, 2, 3, 4) });
    expect(check.may).toBe(true);
    expect(check.needed).toBe(4);
    expect(check.waitingOn).toBeNull();
  });

  it("says how many more are needed, in words", () => {
    const check = postCheck({ ...base, nods: nodsFrom(1, 2) });
    expect(check.may).toBe(false);
    expect(check.waitingOn).toBe("2 of 4 have agreed. 2 more nods and you can send it.");
  });

  it("counts one as a nod, not as nods", () => {
    expect(postCheck({ ...base, nods: nodsFrom(1, 2, 3) }).waitingOn)
      .toBe("3 of 4 have agreed. 1 more nod and you can send it.");
  });

  it("refuses anybody who is not the leader, however many agree", () => {
    const check = postCheck({ ...base, byUserId: 3, nods: nodsFrom(1, 2, 3, 4, 5) });
    expect(check.may).toBe(false);
    expect(check.waitingOn).toContain("chose");
  });

  it("refuses while the team has not chosen anybody", () => {
    const check = postCheck({ ...base, leaderId: null, nods: nodsFrom(1, 2, 3, 4) });
    expect(check.may).toBe(false);
    expect(check.waitingOn).toContain("not chosen");
  });

  it("refuses an empty draft, however many agree", () => {
    const blank = { ...base, draft: { body: "   ", version: 1, authorId: 2 } };
    expect(postCheck({ ...blank, nods: nodsFrom(1, 2, 3, 4) }).may).toBe(false);
  });

  it("refuses once the time for this one has run out, and says so", () => {
    // Silence is the answer here. What must not happen is a button that
    // quietly does nothing while a team presses it.
    const check = postCheck({ ...base, stillOpen: false, nods: nodsFrom(1, 2, 3, 4) });
    expect(check.may).toBe(false);
    expect(check.waitingOn).toContain("run out");
  });

  it("stops being sendable the moment the leader edits it", () => {
    // Four nods on version 1, then the leader changes a word.
    const agreed = postCheck({ ...base, nods: nodsFrom(1, 2, 3, 4) });
    expect(agreed.may).toBe(true);

    const edited = postCheck({
      ...base,
      draft: { body: "We confirm the leak and apologise.", version: 2, authorId: 2 },
      nods: nodsFrom(1, 2, 3, 4),
    });
    expect(edited.may, "an edit published words nobody had agreed to").toBe(false);
    expect(edited.have).toBe(0);
  });

  it("lets a leader alone in a room speak for it", () => {
    // One person present needs one nod: their own. Any other answer makes a
    // team of one mute, and a team of one is usually six people whose session
    // link did not arrive.
    const alone = [member(1, "Amara", at(0))];
    const check = postCheck({
      members: alone, draft: { body: "We confirm it.", version: 1, authorId: 1 },
      nods: [{ userId: 1, version: 1 }], leaderId: 1, byUserId: 1, stillOpen: true,
    });
    expect(check.needed).toBe(1);
    expect(check.may).toBe(true);
  });
});

describe("what the room says it is waiting for", () => {
  const draft = { body: "We confirm the leak.", version: 1, authorId: 2 };

  it("counts down the election", () => {
    expect(roomStanding({
      members: TEAM, leaderId: null, leaderName: null, openedAt: OPENED,
      nowMs: nowAt(2), draft: null, nods: [],
    })).toContain("3 minutes left");
  });

  it("names the leader and says nothing is drafted", () => {
    expect(roomStanding({
      members: TEAM, leaderId: 2, leaderName: "Boubacar", openedAt: OPENED,
      nowMs: nowAt(6), draft: null, nods: [],
    })).toBe("Boubacar speaks for this team. Nothing drafted yet.");
  });

  it("reports the tally while the room is deciding", () => {
    expect(roomStanding({
      members: TEAM, leaderId: 2, leaderName: "Boubacar", openedAt: OPENED, nowMs: nowAt(6),
      draft, nods: [{ userId: 1, version: 1 }],
    })).toBe("Boubacar has drafted a reply. 1 of 4 have agreed so far.");
  });

  it("says when it can go", () => {
    expect(roomStanding({
      members: TEAM, leaderId: 2, leaderName: "Boubacar", openedAt: OPENED, nowMs: nowAt(6),
      draft, nods: [1, 2, 3, 4].map((userId) => ({ userId, version: 1 })),
    })).toBe("4 of 4 agreed. Boubacar can send it.");
  });

  it("is honest about an empty room", () => {
    const empty = TEAM.map((m) => ({ ...m, enteredAt: null }));
    expect(roomStanding({
      members: empty, leaderId: null, leaderName: null, openedAt: OPENED,
      nowMs: nowAt(6), draft: null, nods: [],
    })).toBe("Nobody is in this room yet.");
  });
});

describe("what can be typed in here", () => {
  it("lets ordinary messages through", () => {
    expect(messageProblem("Who is taking the regulator?")).toBeNull();
    expect(messageProblem("ok")).toBeNull();
  });

  it("refuses an empty one", () => {
    expect(messageProblem("   ")).toBe("Write something first.");
  });

  it("refuses one longer than the room allows", () => {
    expect(messageProblem("a".repeat(MAX_MESSAGE + 1))).toContain("longer");
    expect(messageProblem("a".repeat(MAX_MESSAGE))).toBeNull();
  });
});
