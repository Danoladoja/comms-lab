import { describe, expect, it } from "vitest";
import {
  effectiveDueAt,
  taughtUnder,
  extensionProblem,
  extensionNote,
  MAX_EXTENSION_DAYS,
} from "./deadlineExtension";
import { wordsRequired } from "./wordMinimums";
import { lateSubmissionProblem } from "./latePass";

const NOW = Date.parse("2026-09-17T12:00:00Z");
const MODULE_DUE = "2026-09-08T23:59:00Z";   // gone
const NEXT_WEEK = "2026-09-24T23:59:00Z";

describe("which deadline a learner is held to", () => {
  it("is the extension, once there is one", () => {
    expect(effectiveDueAt(MODULE_DUE, NEXT_WEEK)).toBe(NEXT_WEEK);
  });

  it("is the module's own when nothing has been granted", () => {
    expect(effectiveDueAt(MODULE_DUE, null)).toBe(MODULE_DUE);
    expect(effectiveDueAt(MODULE_DUE, undefined)).toBe(MODULE_DUE);
  });

  it("never shortens a deadline", () => {
    // An extension is a favour. A mistyped one must be capable of doing nothing
    // at all, never of shutting a door earlier than the cohort's.
    expect(effectiveDueAt(NEXT_WEEK, MODULE_DUE)).toBe(NEXT_WEEK);
  });

  it("leaves an undated module open", () => {
    // No deadline means the work is open. Writing one here would shut a door
    // that never existed — the opposite of what granting an extension means.
    expect(effectiveDueAt(null, NEXT_WEEK)).toBeNull();
    expect(effectiveDueAt(null, null)).toBeNull();
  });

  it("falls back rather than throwing on an unreadable date", () => {
    expect(effectiveDueAt(MODULE_DUE, "not a date")).toBe(MODULE_DUE);
  });
});

describe("the rules a module was taught under", () => {
  it("stay pinned to the module's own deadline", () => {
    // The trap this whole file is careful about. Module one's deadline passed
    // before the word floors came in, so its cohort was never asked for 500
    // words. Anchoring the floor to an extension instead would ask exactly one
    // learner — the one being done a favour — for work nobody else did.
    expect(taughtUnder(MODULE_DUE)).toBe(MODULE_DUE);
    expect(wordsRequired("task", taughtUnder(MODULE_DUE))).toBe(0);
    // And to prove the mistake is a real one rather than a theoretical worry:
    expect(wordsRequired("task", effectiveDueAt(MODULE_DUE, NEXT_WEEK))).toBeGreaterThan(0);
  });
});

describe("what an extension does to the door", () => {
  const spent = { used: 0, claimedHere: false };

  it("opens a module that was shut, without spending a late pass", () => {
    // Before: shut, and the only way through was a pass.
    expect(lateSubmissionProblem({ dueAt: MODULE_DUE, now: NOW, ...spent })).toMatch(/deadline has passed/);
    // After: simply open. The gate is unchanged — it is reading a different date.
    expect(lateSubmissionProblem({ dueAt: effectiveDueAt(MODULE_DUE, NEXT_WEEK), now: NOW, ...spent })).toBeNull();
  });

  it("still shuts once the extension itself runs out", () => {
    // An extension moves the door; it does not remove it.
    const gone = "2026-09-15T23:59:00Z";
    expect(lateSubmissionProblem({ dueAt: effectiveDueAt(MODULE_DUE, gone), now: NOW, ...spent }))
      .toMatch(/deadline has passed/);
  });

  it("leaves both of a learner's late passes untouched", () => {
    // They did not spend one to get here, so they still have both for later
    // modules. The whole point of an admin granting this.
    const after = { used: 0, claimedHere: false };
    expect(after.used).toBe(0);
  });
});

describe("refusing an extension an admin should not be making", () => {
  const base = { moduleDueAt: MODULE_DUE, nowMs: NOW };

  it("asks for a date before anything else", () => {
    expect(extensionProblem({ ...base, newDueAt: null })).toMatch(/Choose the new date/);
    expect(extensionProblem({ ...base, newDueAt: "" })).toMatch(/Choose the new date/);
  });

  it("refuses a date in the past, and says why it would be pointless", () => {
    expect(extensionProblem({ ...base, newDueAt: "2026-09-16T23:59:00Z" }))
      .toMatch(/in the past, so it would not reopen anything/);
  });

  it("refuses a date before the module's own deadline", () => {
    // Would silently do nothing, because the later date wins. Better to say so
    // than to report success and leave the learner still locked out.
    const earlier = { moduleDueAt: "2026-10-01T23:59:00Z", nowMs: NOW };
    expect(extensionProblem({ ...earlier, newDueAt: "2026-09-25T23:59:00Z" }))
      .toMatch(/earlier than the module's own deadline/);
  });

  it("says there is nothing to extend on an undated module", () => {
    expect(extensionProblem({ newDueAt: NEXT_WEEK, moduleDueAt: null, nowMs: NOW }))
      .toMatch(/no deadline, so there is nothing to extend/);
  });

  it("catches the year typed wrong", () => {
    // 2027 instead of 2026 is one keystroke and would leave a door open past
    // the end of the programme, silently.
    expect(extensionProblem({ ...base, newDueAt: "2027-09-24T23:59:00Z" }))
      .toMatch(new RegExp(`more than ${MAX_EXTENSION_DAYS} days away`));
  });

  it("refuses an unreadable date rather than storing one", () => {
    expect(extensionProblem({ ...base, newDueAt: "whenever" })).toMatch(/could not be read/);
  });

  it("allows the ordinary case", () => {
    expect(extensionProblem({ ...base, newDueAt: NEXT_WEEK })).toBeNull();
  });
});

describe("what the admin reads back", () => {
  it("says the door was shut, when it was", () => {
    const note = extensionNote({
      learnerName: "Kwame Mensah", moduleTitle: "Energy Fundamentals",
      extendedTo: NEXT_WEEK, moduleAlreadyClosed: true,
    });
    expect(note).toMatch(/Kwame Mensah can now file Energy Fundamentals/);
    expect(note).toMatch(/quiz and written task/);
    expect(note).toMatch(/Thursday 24 September/);
    expect(note).toMatch(/It was shut\./);
  });

  it("does not claim to have reopened something that was never closed", () => {
    const note = extensionNote({
      learnerName: "Kwame Mensah", moduleTitle: "This week",
      extendedTo: NEXT_WEEK, moduleAlreadyClosed: false,
    });
    expect(note).not.toMatch(/It was shut/);
    expect(note).toMatch(/rather than the cohort's deadline/);
  });

  it("copes with no name on file", () => {
    expect(extensionNote({
      learnerName: "  ", moduleTitle: "M1", extendedTo: NEXT_WEEK, moduleAlreadyClosed: false,
    })).toMatch(/^This learner/);
  });
});
