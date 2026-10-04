import { describe, expect, it } from "vitest";
import {
  buildPlayback, beatLandedAt, playbackMinutes, teamSummary,
  roomIsReviewable, roomWithheldNote, ROOM_REVIEW_NOTICE_FROM,
} from "./sessionPlayback";

/**
 * Reassembling a session from what was already recorded.
 *
 * Nothing here captures anything new — the arrivals, the beats, the answers and
 * the rooms were all being written for other reasons. What this adds is the
 * order, and the order is the whole thing: an admin who planned the session
 * watched a list of names go green and read four debriefs, which is the outcome
 * with none of the behaviour.
 *
 * Two properties are worth more than the rest. It must not invent a time it
 * does not have, because a wrong minute on a timeline reads as a fact. And it
 * must keep a facilitator distinguishable from a learner, because a nudge read
 * back as a learner's own idea changes what the record appears to show.
 */

const T = (minute: number) => new Date(Date.UTC(2026, 9, 3, 15, minute)).toISOString();

const BASE = {
  startedAt: T(0),
  endedAt: T(45),
  teams: [{ id: "operator", name: "The operator" }, { id: "regulator", name: "The regulator" }],
  people: [
    { userId: 1, name: "Amara", teamId: "operator", enteredAt: T(1) },
    { userId: 2, name: "Boubacar", teamId: "operator", enteredAt: T(3) },
    { userId: 3, name: "Chioma", teamId: "regulator", enteredAt: null },
  ],
  developments: [
    { id: "opening", title: "The photographs run", content: "Front page.", dueAt: T(8), responseSeconds: 480 },
    { id: "beat-2", title: "An email leaks", content: "Day one.", teamId: "operator", dueAt: T(28), responseSeconds: 480 },
  ],
  answers: [
    { teamId: "operator", injectId: "opening", body: "We confirm it.", authorId: 1, createdAt: T(7) },
  ],
};

describe("the session, in order", () => {
  it("opens with the start and closes with the end", () => {
    const entries = buildPlayback(BASE);
    expect(entries[0].kind).toBe("started");
    expect(entries.at(-1)?.kind).toBe("ended");
  });

  it("places everything on the right minute", () => {
    const entries = buildPlayback(BASE);
    const at = (kind: string, title?: string) =>
      entries.find((e) => e.kind === kind && (!title || e.title.includes(title)))?.minute;

    expect(at("arrived", "Amara")).toBe(1);
    expect(at("arrived", "Boubacar")).toBe(3);
    // Due at minute 8, eight minutes allowed, so it landed at minute 0.
    expect(at("beat", "photographs")).toBe(0);
    expect(at("beat", "email")).toBe(20);
    expect(at("answer")).toBe(7);
  });

  it("leaves out somebody who never walked in", () => {
    expect(buildPlayback(BASE).some((e) => e.who === "Chioma")).toBe(false);
  });

  it("says which team a beat landed on, when it landed on one", () => {
    const entries = buildPlayback(BASE);
    expect(entries.find((e) => e.title.includes("email"))?.title).toContain("to The operator only");
    expect(entries.find((e) => e.title.includes("photographs"))?.teamId).toBeNull();
  });

  it("refuses to invent a time it does not have", () => {
    // A wrong minute reads as a fact. An older run stored no deadlines at all,
    // and the honest answer there is a sequence with no clock on it.
    const entries = buildPlayback({
      ...BASE,
      developments: [{ id: "x", title: "Something happened", content: "c" }],
    });
    const beat = entries.find((e) => e.kind === "beat");
    expect(beat?.atMs).toBeNull();
    expect(beat?.minute).toBeNull();
  });

  it("puts the unplaced things after the placed ones, in their own order", () => {
    const entries = buildPlayback({
      ...BASE,
      developments: [
        { id: "a", title: "First undated", content: "c" },
        { id: "b", title: "Second undated", content: "c" },
      ],
    });
    const undated = entries.filter((e) => e.minute === null);
    expect(undated.map((e) => e.title)).toEqual(["First undated", "Second undated"]);
    expect(entries.indexOf(undated[0])).toBeGreaterThan(entries.findIndex((e) => e.kind === "started"));
  });

  it("works out how long it ran, for the scrubber", () => {
    expect(playbackMinutes(buildPlayback(BASE))).toBe(45);
    expect(playbackMinutes([])).toBe(0);
  });
});

describe("the room, read back", () => {
  const WITH_ROOM = {
    ...BASE,
    messages: [
      { teamId: "operator", userId: 2, body: "Do we actually know it ran?", createdAt: T(4) },
    ],
    votes: [{ teamId: "operator", voterId: 2, forUserId: 1, createdAt: T(2) }],
    drafts: [
      { teamId: "operator", version: 1, body: "We confirm it.", authorId: 1, createdAt: T(5) },
      { teamId: "operator", version: 2, body: "We confirm it and apologise.", authorId: 1, createdAt: T(6) },
    ],
    nods: [{ teamId: "operator", userId: 2, version: 1, createdAt: T(6) }],
  };

  it("carries the talk, the vote, the drafts and the nods", () => {
    const kinds = new Set(buildPlayback(WITH_ROOM).map((e) => e.kind));
    for (const kind of ["message", "vote", "draft", "nod"]) {
      expect(kinds.has(kind as never), `${kind} is missing`).toBe(true);
    }
  });

  it("says out loud when a rewrite cleared the agreement", () => {
    // The moment an admin is looking for: a team agreed, and then the words
    // changed underneath them.
    const second = buildPlayback(WITH_ROOM).find((e) => e.kind === "draft" && e.title.includes("rewrote"));
    expect(second?.title).toContain("version 2");
    expect(second?.title).toContain("every nod cleared");
  });

  it("names who voted for whom", () => {
    expect(buildPlayback(WITH_ROOM).find((e) => e.kind === "vote")?.title)
      .toBe("Boubacar voted for Amara");
  });

  it("keeps the rooms of sessions run under the old promise closed", () => {
    // Those learners were told only their own team would ever read it, and
    // that was true when they typed it. Changing a sentence afterwards does
    // not reach back.
    expect(roomIsReviewable(ROOM_REVIEW_NOTICE_FROM)).toBe(true);
    expect(roomIsReviewable("2026-10-05T10:00:00.000Z")).toBe(true);
    expect(roomIsReviewable("2026-10-03T10:00:00.000Z")).toBe(false);
    expect(roomIsReviewable(null)).toBe(false);
    expect(roomWithheldNote()).toContain("true when they typed it");
  });
});

describe("a facilitator who joined", () => {
  const VISITED = {
    ...BASE,
    people: [
      ...BASE.people,
      { userId: 99, name: "Daniel", teamId: "operator", enteredAt: T(10), isStaff: true },
    ],
    messages: [
      { teamId: "operator", userId: 99, body: "Who is taking the regulator?", createdAt: T(11) },
      { teamId: "operator", userId: 2, body: "I will.", createdAt: T(12) },
    ],
  };

  it("is named as a facilitator everywhere they appear", () => {
    // A nudge read back as a learner's own idea changes what the record
    // appears to show about that team.
    const entries = buildPlayback(VISITED);
    const said = entries.find((e) => e.kind === "message" && e.body?.includes("regulator"));
    expect(said?.who).toBe("Daniel (facilitator)");
    expect(entries.find((e) => e.kind === "arrived" && e.who?.includes("Daniel"))?.title)
      .toContain("sat in");
  });

  it("does not inflate the team in its summary", () => {
    const entries = buildPlayback(VISITED);
    // Two learners walked in. A visit does not make it three.
    expect(teamSummary(entries, "operator")).toContain("2 walked in");
  });

  it("leaves a learner's name alone", () => {
    expect(buildPlayback(VISITED).find((e) => e.kind === "message" && e.body === "I will.")?.who)
      .toBe("Boubacar");
  });
});

describe("what a team's line says", () => {
  it("reports turnout, talk and whether they answered", () => {
    const said = teamSummary(buildPlayback(BASE), "operator");
    expect(said).toContain("2 walked in");
    expect(said).toContain("1 answer sent");
  });

  it("says plainly when a team answered nothing", () => {
    expect(teamSummary(buildPlayback(BASE), "regulator")).toContain("answered nothing");
  });
});

describe("when a development landed", () => {
  it("works back from the deadline and the time allowed", () => {
    expect(beatLandedAt({ dueAt: T(10), responseSeconds: 300 })).toBe(new Date(T(5)).getTime());
  });

  it("uses the deadline alone when no time was recorded", () => {
    expect(beatLandedAt({ dueAt: T(10) })).toBe(new Date(T(10)).getTime());
  });

  it("gives nothing when there is nothing to work from", () => {
    expect(beatLandedAt({})).toBeNull();
    expect(beatLandedAt({ dueAt: "not a date" })).toBeNull();
  });
});
