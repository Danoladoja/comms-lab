import { describe, expect, it } from "vitest";
import {
  cohortStart,
  startDateFor,
  modulesMissed,
  lateEnrolmentNote,
  lateEnrolmentProblem,
} from "./lateEnrolment";

const at = (iso: string) => new Date(iso);
const NOW = at("2026-09-17T12:00:00Z");
const FIRST_CLASS = at("2026-09-10T14:00:00Z");

describe("when the cohort began", () => {
  it("is the first class", () => {
    expect(cohortStart(FIRST_CLASS, at("2026-08-01T00:00:00Z"), NOW)).toEqual(FIRST_CLASS);
  });

  it("falls back to the oldest enrolment when no class has a date", () => {
    // A programme can be enrolling before its timetable is set.
    const formed = at("2026-08-01T00:00:00Z");
    expect(cohortStart(null, formed, NOW)).toEqual(formed);
  });

  it("falls back to now when there is nothing to go on", () => {
    // The forgiving direction on purpose: treating them as new waives modules,
    // where guessing an early date would hand somebody work they cannot finish.
    expect(cohortStart(null, null, NOW)).toEqual(NOW);
  });

  it("does not prefer an enrolment older than the first class", () => {
    // People enrol weeks before a programme runs. The class is the beginning.
    expect(cohortStart(FIRST_CLASS, at("2026-06-01T00:00:00Z"), NOW)).toEqual(FIRST_CLASS);
  });
});

describe("the date written on the enrolment", () => {
  it("is now, when they start from today", () => {
    expect(startDateFor("today", FIRST_CLASS, NOW)).toEqual(NOW);
  });

  it("is just before the first class, when they are held to the whole programme", () => {
    // `progress` compares a module's end against this date. Landing exactly on
    // the first class leaves the first module's standing decided by a tie, so
    // the margin is deliberate.
    const written = startDateFor("cohort-start", FIRST_CLASS, NOW);
    expect(written.getTime()).toBeLessThan(FIRST_CLASS.getTime());
    expect(FIRST_CLASS.getTime() - written.getTime()).toBe(60_000);
  });
});

describe("what they have already missed", () => {
  const ms = (iso: string) => Date.parse(iso);
  /** Three classes gone, two of their deadlines shut, one still open ahead. */
  const programme = [
    { startsAtMs: ms("2026-09-03T14:00:00Z"), durationMins: 60, dueAtMs: [ms("2026-09-08T23:59:00Z")] },
    { startsAtMs: ms("2026-09-10T14:00:00Z"), durationMins: 60, dueAtMs: [ms("2026-09-15T23:59:00Z")] },
    { startsAtMs: ms("2026-09-15T14:00:00Z"), durationMins: 60, dueAtMs: [ms("2026-09-25T23:59:00Z")] },
    { startsAtMs: ms("2026-09-24T14:00:00Z"), durationMins: 60, dueAtMs: [ms("2026-10-01T23:59:00Z")] },
  ];

  it("counts against today, whatever start date is being written", () => {
    // The bug this test exists for. Counting against the date on the enrolment
    // meant somebody held to the whole programme had, by definition, missed
    // nothing — so the deadline warning went quiet for the exact case it was
    // built to catch, and an admin was told "nothing is closed to them" about a
    // learner who could not file a thing.
    expect(modulesMissed(programme, new Date(NOW))).toEqual({ alreadyRun: 3, deadlinesPassed: 2 });
  });

  it("does not count a class that is still running", () => {
    // Mid-class, the module has not been missed — it is being attended.
    const during = new Date(ms("2026-09-15T14:30:00Z"));
    expect(modulesMissed(programme, during).alreadyRun).toBe(2);
  });

  it("ignores a module with no date", () => {
    expect(modulesMissed([{ startsAtMs: null, durationMins: 60, dueAtMs: [ms("2020-01-01T00:00:00Z")] }], new Date(NOW)))
      .toEqual({ alreadyRun: 0, deadlinesPassed: 0 });
  });

  it("counts a module once, however many of its deadlines have gone", () => {
    // A module has a quiz and a task. Two shut deadlines are one module the
    // learner cannot finish, not two.
    const both = [{
      startsAtMs: ms("2026-09-03T14:00:00Z"), durationMins: 60,
      dueAtMs: [ms("2026-09-08T23:59:00Z"), ms("2026-09-09T23:59:00Z")],
    }];
    expect(modulesMissed(both, new Date(NOW))).toEqual({ alreadyRun: 1, deadlinesPassed: 1 });
  });

  it("does not treat a module with no deadline as closed", () => {
    // Every task predating deadlines has none, and none of those are shut.
    const open = [{ startsAtMs: ms("2026-09-03T14:00:00Z"), durationMins: 60, dueAtMs: [null] }];
    expect(modulesMissed(open, new Date(NOW))).toEqual({ alreadyRun: 1, deadlinesPassed: 0 });
  });
});

describe("telling the admin what they are about to do", () => {
  it("says the modules are written off, when they start from today", () => {
    const note = lateEnrolmentNote({
      name: "Amina Bello", choice: "today", modulesAlreadyRun: 3, deadlinesPassed: 2,
    });
    expect(note).toMatch(/Amina Bello/);
    expect(note).toMatch(/3 modules/);
    expect(note).toMatch(/counted as done/);
  });

  it("warns that the work cannot be filed, when a deadline has already gone", () => {
    // The whole reason this function exists. Held to the full programme with a
    // closed deadline, a learner is stuck in a way nothing on their own screen
    // explains — it surfaces days later as an email saying "I can't submit".
    const note = lateEnrolmentNote({
      name: "Amina Bello", choice: "cohort-start", modulesAlreadyRun: 3, deadlinesPassed: 2,
    });
    expect(note).toMatch(/all 3 modules/);
    expect(note).toMatch(/2 deadlines have already passed/);
    expect(note).toMatch(/cannot submit/);
    // A warning that does not say what to do instead is just bad news.
    expect(note).toMatch(/extend the deadline/);
    expect(note).toMatch(/from today instead/);
  });

  it("says so plainly when nothing is closed yet", () => {
    const note = lateEnrolmentNote({
      name: "Amina Bello", choice: "cohort-start", modulesAlreadyRun: 2, deadlinesPassed: 0,
    });
    expect(note).toMatch(/all 2 modules/);
    expect(note).toMatch(/Nothing is closed to them yet/);
    expect(note).not.toMatch(/cannot submit/);
  });

  it("does not manufacture a warning for somebody joining on time", () => {
    for (const choice of ["today", "cohort-start"] as const) {
      const note = lateEnrolmentNote({ name: "Amina", choice, modulesAlreadyRun: 0, deadlinesPassed: 0 });
      expect(note).toBe("Amina starts with the rest of the cohort.");
    }
  });

  it("reads properly for one module, and for somebody with no name on file", () => {
    const note = lateEnrolmentNote({
      name: "  ", choice: "cohort-start", modulesAlreadyRun: 1, deadlinesPassed: 1,
    });
    expect(note).toMatch(/^They is|^They/);
    expect(note).toMatch(/the module that already ran still has to be completed/);
    expect(note).toMatch(/1 deadline has already passed/);
  });
});

describe("refusing, and saying what to do instead", () => {
  it("sends an unknown address to the invitation tool", () => {
    const problem = lateEnrolmentProblem({
      accountExists: false, email: "nobody@example.test", existingStatus: null,
    });
    expect(problem).toMatch(/no account here for nobody@example.test/);
    expect(problem).toMatch(/invite them instead/);
  });

  it("protects a completed record", () => {
    expect(lateEnrolmentProblem({ accountExists: true, email: "a@x.test", existingStatus: "completed" }))
      .toMatch(/already completed/);
  });

  it("allows the states this tool exists to fix", () => {
    // On nothing, waitlisted and never promoted, enrolled but counting from the
    // wrong day, and cancelled by mistake — all of these are the job.
    for (const existingStatus of [null, "waitlisted", "enrolled", "cancelled"] as const) {
      expect(lateEnrolmentProblem({ accountExists: true, email: "a@x.test", existingStatus })).toBeNull();
    }
  });
});
