import { describe, expect, it } from "vitest";
import {
  cohortSnapshot,
  cellState,
  learnerRow,
  missingParts,
  moduleDueAt,
  moduleIsDue,
  whyBehind,
  cohortHeadline,
  type CohortModule,
  type CohortLearner,
} from "./cohortProgress";
import { computeProgress, EMPTY_COURSEWORK, type CourseworkStatus, type SessionLite } from "./progress";
import { EMPTY_PRESENCE, type PresenceInput } from "./presence";

const NOW = Date.parse("2026-09-17T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/* ------------------------------------------------------------------ *
 * A small cohort, built the only honest way: through computeProgress.
 *
 * Hand-writing ProgressEntry objects would let these tests assert a state the
 * real function never produces, which is precisely the drift this whole file
 * exists to make impossible.
 * ------------------------------------------------------------------ */

const SESSIONS: SessionLite[] = [
  { id: 1, programId: 7, startsAt: new Date("2026-09-01T14:00:00Z"), durationMins: 60, sortOrder: 1, title: "Module one" },
  { id: 2, programId: 7, startsAt: new Date("2026-09-08T14:00:00Z"), durationMins: 60, sortOrder: 2, title: "Module two" },
  { id: 3, programId: 7, startsAt: new Date("2026-09-22T14:00:00Z"), durationMins: 60, sortOrder: 3, title: "Module three" },
];

const MODULES: CohortModule[] = [
  { sessionId: 1, title: "Module one", startsAt: "2026-09-01T14:00:00Z", quizDueAt: "2026-09-05T23:59:00Z", assignmentDueAt: "2026-09-05T23:59:00Z", sortOrder: 1 },
  { sessionId: 2, title: "Module two", startsAt: "2026-09-08T14:00:00Z", quizDueAt: "2026-09-12T23:59:00Z", assignmentDueAt: "2026-09-12T23:59:00Z", sortOrder: 2 },
  { sessionId: 3, title: "Module three", startsAt: "2026-09-22T14:00:00Z", quizDueAt: "2026-09-26T23:59:00Z", assignmentDueAt: "2026-09-26T23:59:00Z", sortOrder: 3 },
];

/** Everything a module asks for, on every module. */
function coursework(over: Partial<CourseworkStatus> = {}): CourseworkStatus {
  return {
    ...EMPTY_COURSEWORK,
    hasQuiz: true,
    hasAssignment: true,
    reviewsRequired: 2,
    peersToReview: 10,
    quizDueAt: "2026-09-05T23:59:00Z",
    assignmentDueAt: "2026-09-05T23:59:00Z",
    ...over,
  };
}

function fullPresence(): PresenceInput {
  return { ...EMPTY_PRESENCE, liveSeconds: 3600, sessionSeconds: 3600 };
}

/** Build one learner's entries the way the server does. */
function learner(args: {
  userId: number;
  name: string;
  enrolledAt?: Date;
  /** Per session: what they did. */
  did: Record<number, { present?: boolean; quiz?: number; filed?: boolean; critiques?: number; dueAt?: string }>;
  filedAt?: Record<number, string>;
}): CohortLearner {
  const attendance = new Map<number, Date>();
  const presence = new Map<number, PresenceInput>();
  const cw = new Map<number, CourseworkStatus>();

  for (const s of SESSIONS) {
    const did = args.did[s.id] ?? {};
    const due = did.dueAt ?? MODULES.find((m) => m.sessionId === s.id)!.quizDueAt;
    if (did.present) {
      attendance.set(s.id, s.startsAt!);
      presence.set(s.id, fullPresence());
    }
    cw.set(s.id, coursework({
      quizBestScore: did.quiz ?? null,
      assignmentSubmitted: !!did.filed,
      reviewsGiven: did.critiques ?? 0,
      quizDueAt: due,
      assignmentDueAt: due,
    }));
  }

  const entries = computeProgress(
    SESSIONS,
    attendance,
    new Map([[7, args.enrolledAt ?? new Date("2026-08-20T00:00:00Z")]]),
    cw,
    presence,
    NOW,
  );

  return {
    userId: args.userId,
    name: args.name,
    email: `${args.name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    entries,
    submittedAtBySession: new Map(Object.entries(args.filedAt ?? {}).map(([k, v]) => [Number(k), v])),
  };
}

const DONE = { present: true, quiz: 90, filed: true, critiques: 2 };

/* ------------------------------------------------------------------ */

describe("when a module's time is up", () => {
  it("is the later of the quiz and the task, not the first to close", () => {
    // A module whose quiz shut on Monday and whose task is open until Friday
    // has not finished being due on Wednesday. Taking the earlier date would
    // mark a cohort behind on work they still had four days to file.
    const split: CohortModule = {
      sessionId: 9, title: "Split", startsAt: null,
      quizDueAt: "2026-09-14T23:59:00Z", assignmentDueAt: "2026-09-20T23:59:00Z", sortOrder: 1,
    };
    expect(moduleDueAt(split)).toBe(new Date("2026-09-20T23:59:00Z").toISOString());
    expect(moduleIsDue(split, NOW)).toBe(false);
  });

  it("is nothing at all when nothing is dated", () => {
    const undated: CohortModule = { sessionId: 9, title: "X", startsAt: null, quizDueAt: null, assignmentDueAt: null, sortOrder: 1 };
    expect(moduleDueAt(undated)).toBeNull();
    expect(moduleIsDue(undated, NOW)).toBe(false);
  });

  it("survives an unreadable date rather than throwing on the admin's screen", () => {
    const bad: CohortModule = { sessionId: 9, title: "X", startsAt: null, quizDueAt: "whenever", assignmentDueAt: "2026-09-12T23:59:00Z", sortOrder: 1 };
    expect(moduleDueAt(bad)).toBe(new Date("2026-09-12T23:59:00Z").toISOString());
  });
});

describe("where one learner stands on one module", () => {
  it("is behind when the deadline has gone and the work has not", () => {
    const l = learner({ userId: 1, name: "Ama Boateng", did: { 1: DONE } });
    const entry = l.entries.find((e) => e.sessionId === 2)!;
    expect(cellState(entry, MODULES[1], NOW)).toBe("behind");
  });

  it("is open when the deadline is still to come", () => {
    const l = learner({ userId: 1, name: "Ama Boateng", did: {} });
    const entry = l.entries.find((e) => e.sessionId === 3)!;
    expect(cellState(entry, MODULES[2], NOW)).toBe("open");
  });

  it("is complete when it is done, deadline or no deadline", () => {
    const l = learner({ userId: 1, name: "Ama Boateng", did: { 1: DONE, 2: DONE } });
    expect(cellState(l.entries.find((e) => e.sessionId === 1)!, MODULES[0], NOW)).toBe("complete");
  });

  it("never calls a late joiner behind on a class that ran before they arrived", () => {
    // The whole reason this distinction is load-bearing: somebody added to the
    // cohort in week three did nothing wrong by missing weeks one and two, and
    // a tracker that opens on their name at the top of a chase list is worse
    // than no tracker.
    const late = learner({
      userId: 2, name: "Kofi Asante",
      enrolledAt: new Date("2026-09-15T00:00:00Z"),
      did: {},
    });
    expect(cellState(late.entries.find((e) => e.sessionId === 1)!, MODULES[0], NOW)).toBe("waived");
    expect(cellState(late.entries.find((e) => e.sessionId === 2)!, MODULES[1], NOW)).toBe("waived");
    expect(learnerRow(late, MODULES, NOW).behind).toBe(0);
  });

  it("separates somebody given extra time from somebody simply late", () => {
    // An admin who granted this last week must not be shown it as a problem to
    // chase this week. Same missing work, different sentence.
    const extended = learner({
      userId: 3, name: "Zainab Bello",
      did: { 1: DONE, 2: { dueAt: "2026-09-24T23:59:00Z" } },
    });
    const entry = extended.entries.find((e) => e.sessionId === 2)!;
    expect(cellState(entry, MODULES[1], NOW)).toBe("extended");

    const row = learnerRow(extended, MODULES, NOW);
    expect(row.behind).toBe(0);
    expect(row.onExtraTime).toBe(1);
    expect(row.cells.find((c) => c.sessionId === 2)!.extendedTo)
      .toBe(new Date("2026-09-24T23:59:00Z").toISOString());
  });

  it("puts them back on the list once the extra time itself runs out", () => {
    // An extension moves the line; it does not delete it.
    const spent = learner({
      userId: 3, name: "Zainab Bello",
      did: { 1: DONE, 2: { dueAt: "2026-09-15T23:59:00Z" } },
    });
    expect(cellState(spent.entries.find((e) => e.sessionId === 2)!, MODULES[1], NOW)).toBe("behind");
  });
});

describe("what is missing, said in the Lab's own words", () => {
  it("names each piece rather than a count", () => {
    const l = learner({ userId: 1, name: "Ama Boateng", did: { 2: { present: false, quiz: 40 } } });
    const entry = l.entries.find((e) => e.sessionId === 2)!;
    expect(missingParts(entry)).toEqual(["the class", "the quiz", "the written task"]);
  });

  it("counts the critiques still owed once the task is in", () => {
    const l = learner({
      userId: 1, name: "Ama Boateng",
      did: { 2: { present: true, quiz: 90, filed: true, critiques: 1 } },
    });
    const entry = l.entries.find((e) => e.sessionId === 2)!;
    expect(missingParts(entry)).toEqual(["one critique"]);
  });

  it("does not ask for a critique before there is work to critique", () => {
    // Nothing filed, so "2 critiques" alongside "the written task" would be
    // telling an admin to chase two things when one of them unlocks the other.
    const l = learner({ userId: 1, name: "Ama Boateng", did: { 2: { present: true, quiz: 90 } } });
    const entry = l.entries.find((e) => e.sessionId === 2)!;
    expect(missingParts(entry)).toEqual(["the written task"]);
  });
});

describe("the cohort, seen from above", () => {
  const cohort = [
    learner({ userId: 1, name: "Ama Boateng", did: { 1: DONE, 2: DONE }, filedAt: { 1: "2026-09-04T10:00:00Z", 2: "2026-09-11T10:00:00Z" } }),
    learner({ userId: 2, name: "Bright Owusu", did: { 1: DONE, 2: { present: true, quiz: 50, filed: true, critiques: 2 } }, filedAt: { 1: "2026-09-04T10:00:00Z", 2: "2026-09-14T10:00:00Z" } }),
    learner({ userId: 3, name: "Chidi Eze", did: { 1: DONE }, filedAt: { 1: "2026-09-06T10:00:00Z" } }),
    learner({ userId: 4, name: "Dede Quaye", enrolledAt: new Date("2026-09-15T00:00:00Z"), did: {} }),
  ];
  const snap = cohortSnapshot({ modules: MODULES, learners: cohort, nowMs: NOW });

  it("counts who is behind, and does not count the late joiner among them", () => {
    expect(snap.headline.learners).toBe(4);
    expect(snap.headline.behind).toBe(2);   // Bright (quiz), Chidi (all of module two)
    expect(snap.headline.onTrack).toBe(2);  // Ama, and Dede who was never asked
  });

  it("says how many modules are actually due", () => {
    expect(snap.headline.modulesDue).toBe(2);
    expect(snap.headline.modules).toBe(3);
  });

  it("measures completion against what was asked, not against the whole programme", () => {
    // Module three is not due, so it is in nobody's denominator. A cohort that
    // has done everything asked of it is at 100%, not at 67% because the term
    // has not finished.
    const perfect = cohortSnapshot({
      modules: MODULES,
      learners: [learner({ userId: 1, name: "Ama Boateng", did: { 1: DONE, 2: DONE } })],
      nowMs: NOW,
    });
    expect(perfect.headline.completionPct).toBe(100);
  });

  it("opens at 100%, not 0%, before anything has been asked", () => {
    // Day one of a cohort owes nothing. A red zero in a large font would be a
    // lie, and the first thing an admin saw.
    const dayOne = cohortSnapshot({
      modules: [MODULES[2]],
      learners: [learner({ userId: 1, name: "Ama Boateng", did: {} })],
      nowMs: NOW,
    });
    expect(dayOne.headline.completionPct).toBe(100);
    expect(dayOne.headline.behind).toBe(0);
  });

  it("ranks the chase list by how far behind each person is", () => {
    // Both are one module behind, so the tie is broken by how much of that
    // module is outstanding: Chidi is missing all of it, Bright only the quiz.
    // Breaking it alphabetically instead would put the person in most trouble
    // second by pure accident of their name.
    expect(snap.needsAttention.map((r) => r.name)).toEqual(["Chidi Eze", "Bright Owusu"]);
    expect(snap.needsAttention[0].behind).toBe(1);
  });

  it("says what each person on that list is actually missing", () => {
    expect(whyBehind(snap.needsAttention[1], MODULES)).toBe("Module two (the quiz)");
    expect(whyBehind(snap.needsAttention[0], MODULES))
      .toBe("Module two (the class, the quiz, the written task)");
  });

  it("keeps a module's numbers agreeing with the cells above them", () => {
    const two = snap.modules.find((m) => m.sessionId === 2)!;
    expect(two.learners).toBe(4);
    expect(two.complete).toBe(1);
    expect(two.behind).toBe(2);
    expect(two.waived).toBe(1);
    expect(two.complete + two.behind + two.waived + two.onExtraTime).toBe(two.learners);
  });

  it("reports attendance by the route that carried each learner", () => {
    const one = snap.modules.find((m) => m.sessionId === 1)!;
    expect(one.attended).toBe(3);
    expect(one.viaLive).toBe(3);
    expect(one.notAttended).toBe(1);
  });

  it("counts work filed after the deadline separately from work filed before it", () => {
    const two = snap.modules.find((m) => m.sessionId === 2)!;
    expect(two.filedBeforeDeadline).toBe(1);  // Ama, on the 11th
    expect(two.filedAfterDeadline).toBe(1);   // Bright, on the 14th
  });

  it("orders modules by when they run, whatever order they arrive in", () => {
    const shuffled = cohortSnapshot({ modules: [MODULES[2], MODULES[0], MODULES[1]], learners: cohort, nowMs: NOW });
    expect(shuffled.modules.map((m) => m.sessionId)).toEqual([1, 2, 3]);
  });
});

describe("the blind spot it refuses to keep quiet about", () => {
  it("names a module that has run with no deadline on it", () => {
    // Nobody can ever be behind on this module, so its column will read green
    // for ever. An admin trusting that green is the failure this exists to
    // prevent.
    const undated: CohortModule = {
      sessionId: 4, title: "Module four", startsAt: "2026-09-10T14:00:00Z",
      quizDueAt: null, assignmentDueAt: null, sortOrder: 4,
    };
    const snap = cohortSnapshot({
      modules: [...MODULES, undated],
      learners: [learner({ userId: 1, name: "Ama Boateng", did: { 1: DONE, 2: DONE } })],
      nowMs: NOW,
    });
    expect(snap.undatedModulesThatHaveRun).toEqual([{ sessionId: 4, title: "Module four" }]);
  });

  it("says nothing about a module that has not run yet", () => {
    const future: CohortModule = {
      sessionId: 5, title: "Module five", startsAt: "2026-11-10T14:00:00Z",
      quizDueAt: null, assignmentDueAt: null, sortOrder: 5,
    };
    const snap = cohortSnapshot({
      modules: [future],
      learners: [learner({ userId: 1, name: "Ama Boateng", did: {} })],
      nowMs: NOW,
    });
    expect(snap.undatedModulesThatHaveRun).toEqual([]);
  });
});

describe("the line at the top of the page", () => {
  it("does not lead with a score", () => {
    const snap = cohortSnapshot({
      modules: MODULES,
      learners: [
        learner({ userId: 1, name: "Ama Boateng", did: { 1: DONE, 2: DONE } }),
        learner({ userId: 2, name: "Chidi Eze", did: { 1: DONE } }),
      ],
      nowMs: NOW,
    });
    expect(cohortHeadline(snap)).toBe("2 of 3 modules are due, and 1 learner is behind.");
  });

  it("says so plainly when nothing is due yet", () => {
    const snap = cohortSnapshot({
      modules: [MODULES[2]],
      learners: [learner({ userId: 1, name: "Ama Boateng", did: {} })],
      nowMs: NOW,
    });
    expect(cohortHeadline(snap)).toBe("1 learners, and nothing is due yet.");
  });

  it("mentions extra time, because it explains the gap between behind and not done", () => {
    const snap = cohortSnapshot({
      modules: MODULES,
      learners: [learner({ userId: 3, name: "Zainab Bello", did: { 1: DONE, 2: { dueAt: "2026-09-24T23:59:00Z" } } })],
      nowMs: NOW,
    });
    expect(cohortHeadline(snap)).toMatch(/1 on extra time/);
  });

  it("copes with an empty cohort", () => {
    const snap = cohortSnapshot({ modules: MODULES, learners: [], nowMs: NOW });
    expect(cohortHeadline(snap)).toBe("Nobody is enrolled on this programme yet.");
  });
});
