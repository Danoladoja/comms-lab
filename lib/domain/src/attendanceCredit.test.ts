import { describe, expect, it } from "vitest";
import {
  creditProblem,
  creditRecord,
  creditStanding,
  creditNote,
  takeBackWarning,
  takeBackProblem,
  extraTimeBlocked,
  MIN_REASON_CHARS,
  SUGGESTED_REASON,
} from "./attendanceCredit";

const NOW = Date.parse("2026-09-18T12:00:00Z");
const RAN = Date.parse("2026-09-08T14:00:00Z");   // over
const SOON = Date.parse("2026-09-22T14:00:00Z");  // still to come

const base = {
  startsAtMs: RAN,
  durationMins: 60,
  nowMs: NOW,
  reason: "Everyone was in the room; the Lab was not recording.",
  count: 3,
};

describe("refusing a credit that should not be given", () => {
  it("asks who first", () => {
    expect(creditProblem({ ...base, count: 0 })).toMatch(/Choose who/);
  });

  it("insists on a reason, and says what the reason is for", () => {
    // Not paperwork. This row will outlive everyone's memory of why it exists,
    // and it is the only answer to a learner who disputes their record.
    expect(creditProblem({ ...base, reason: "" })).toMatch(/Say why/);
    expect(creditProblem({ ...base, reason: "  ." })).toMatch(/Say why/);
    expect(creditProblem({ ...base, reason: "x".repeat(MIN_REASON_CHARS) })).toBeNull();
  });

  it("accepts the short, real reasons an admin actually types", () => {
    expect(creditProblem({ ...base, reason: "Zoom failed" })).toBeNull();
    expect(creditProblem({ ...base, reason: SUGGESTED_REASON })).toBeNull();
  });

  it("refuses a class that has not finished", () => {
    // Crediting attendance at a class still to come is not a favour, it is a
    // false record — and one that would quietly complete a module nobody has
    // sat through.
    expect(creditProblem({ ...base, startsAtMs: SOON }))
      .toMatch(/has not finished yet/);
  });

  it("refuses a class still running, not only one not yet started", () => {
    const halfway = RAN + 30 * 60_000;
    expect(creditProblem({ ...base, nowMs: halfway })).toMatch(/has not finished yet/);
  });

  it("refuses a module with no date at all", () => {
    expect(creditProblem({ ...base, startsAtMs: null }))
      .toMatch(/no date yet, so nobody can have attended/);
  });

  it("allows the case it exists for", () => {
    expect(creditProblem(base)).toBeNull();
  });
});

describe("what gets written beside the name", () => {
  it("keeps the reason, and adds who decided and when", () => {
    // There is no column for "who", so it lives in the sentence. A row that
    // says only "could not be measured" answers half the question.
    const record = creditRecord({
      reason: "Everyone was in the room; the Lab was not recording.",
      byName: "Daniel Oladoja",
      whenIso: "2026-09-18T12:00:00Z",
    });
    expect(record).toBe(
      "Everyone was in the room; the Lab was not recording. — credited by Daniel Oladoja on 18 September 2026.",
    );
  });

  it("still names somebody when the account has no name on it", () => {
    expect(creditRecord({ reason: "Zoom failed", byName: "   ", whenIso: "2026-09-18T12:00:00Z" }))
      .toMatch(/credited by an admin on/);
  });

  it("does not throw on an unreadable date", () => {
    expect(creditRecord({ reason: "Zoom failed", byName: "Ama", whenIso: "nonsense" }))
      .toBe("Zoom failed — credited by Ama on nonsense.");
  });
});

describe("whether crediting somebody would change anything", () => {
  it("is needed when they have not got there by any route", () => {
    expect(creditStanding({ presenceMet: false, alreadyWaived: false })).toBe("needed");
  });

  it("leaves alone somebody who attended or watched it back", () => {
    // Crediting them would overwrite a real measurement with "we could not
    // measure this", which is worse than doing nothing.
    expect(creditStanding({ presenceMet: true, alreadyWaived: false })).toBe("attended");
  });

  it("recognises a credit already given, so a second press is harmless", () => {
    expect(creditStanding({ presenceMet: true, alreadyWaived: true })).toBe("already-credited");
    // And the flag wins over the measurement, so an earlier credit is never
    // silently reported as somebody's own attendance.
    expect(creditStanding({ presenceMet: false, alreadyWaived: true })).toBe("already-credited");
  });
});

describe("what the admin reads back", () => {
  it("says how many, and who was skipped", () => {
    expect(creditNote({
      credited: 31, alreadyAttended: 12, alreadyCredited: 2, moduleTitle: "Module one",
    })).toBe(
      "31 learners now count as having attended Module one. "
      + "12 had already attended, and 2 were already credited — those were left alone.",
    );
  });

  it("speaks about one person as one person", () => {
    expect(creditNote({ credited: 1, alreadyAttended: 0, alreadyCredited: 0, moduleTitle: "Module one" }))
      .toBe("1 learner now counts as having attended Module one.");
  });

  it("says plainly when it did nothing", () => {
    expect(creditNote({ credited: 0, alreadyAttended: 5, alreadyCredited: 0, moduleTitle: "Module one" }))
      .toMatch(/Nothing to credit on Module one\. Everybody chosen had already attended/);
  });
});

describe("warning before taking a credit back", () => {
  it("says the module will shut again, and that nothing is deleted", () => {
    // The sentence an admin needs before pressing, not after a learner emails.
    const warning = takeBackWarning({
      learnerName: "Kwame Mensah", moduleTitle: "Module one", hasOwnMeasurement: false,
    });
    expect(warning).toMatch(/leave the module unfinished/);
    expect(warning).toMatch(/any module waiting on it will shut again/);
    expect(warning).toMatch(/Nothing they have submitted is deleted/);
  });

  it("does not threaten anything when their own attendance stands underneath", () => {
    const warning = takeBackWarning({
      learnerName: "Kwame Mensah", moduleTitle: "Module one", hasOwnMeasurement: true,
    });
    expect(warning).toMatch(/leaves that standing/);
    expect(warning).not.toMatch(/will shut again/);
  });

  it("asks who first", () => {
    expect(takeBackProblem({ count: 0 })).toMatch(/Choose who/);
    expect(takeBackProblem({ count: 1 })).toBeNull();
  });
});

describe("telling an admin why extra time is not reaching somebody", () => {
  it("names what is blocking them", () => {
    // The failure this exists for. Extra time was granted, it succeeded, the
    // learner still could not open the quiz, and extensions looked broken. A
    // lock is checked before any deadline, which is right — and invisible.
    expect(extraTimeBlocked({ locked: true, lockedReason: "Finish Module one to open this" }))
      .toBe("Extra time will not reach them yet — this module is still shut for them. "
        + "Finish Module one to open this.");
  });

  it("still says something useful when the reason is missing", () => {
    expect(extraTimeBlocked({ locked: true, lockedReason: null }))
      .toMatch(/still shut for them by an earlier one/);
    expect(extraTimeBlocked({ locked: true, lockedReason: "   " }))
      .toMatch(/still shut for them by an earlier one/);
  });

  it("says nothing at all when the module is open", () => {
    expect(extraTimeBlocked({ locked: false, lockedReason: null })).toBeNull();
  });
});
