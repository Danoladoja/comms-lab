import { describe, expect, it } from "vitest";
import {
  auditFlags, auditNote, auditReportText, looksWiped, duplicateNote,
  type AuditFacts, type AuditReportRow,
} from "./progressAudit";

const clean: AuditFacts = {
  hasRecording: true, moduleRecordingSeconds: 3600, learnerRecordingSeconds: 3600,
  watchedSeconds: 3500, presenceMet: true, liveSeconds: 0,
  hasAssignment: true, hasSubmission: true,
  withdrawn: false, withdrawnOn: null, bodyLength: 4200,
  critiquesGiven: 2, reviewsRequired: 2, reviewsCleared: 2,
  hasQuiz: true, quizBestScore: 80, quizPassed: true,
  completed: true,
};
const codes = (f: Partial<AuditFacts>) => auditFlags({ ...clean, ...f }).map((x) => x.code);

describe("what an audit has to notice", () => {
  it("says nothing about a record that adds up", () => {
    expect(auditFlags(clean)).toEqual([]);
  });

  it("catches watching that counts for nothing", () => {
    // A recording with no agreed length divides by nothing, so every minute
    // anybody watched reads as zero per cent.
    expect(codes({ moduleRecordingSeconds: null, learnerRecordingSeconds: null, watchedSeconds: 2400 }))
      .toContain("watched-nothing-counted");
  });

  it("catches the two records of a recording's length disagreeing", () => {
    expect(codes({ learnerRecordingSeconds: 1200 })).toContain("recording-length-disagrees");
  });

  it("catches a length settled shorter than what somebody had already watched", () => {
    // This is the shape of the fault that was deleting watched time: the
    // length moved after the watching, so it is the length that is wrong.
    expect(codes({ moduleRecordingSeconds: 1200, learnerRecordingSeconds: 1200, watchedSeconds: 2400 }))
      .toContain("watched-beyond-length");
  });

  it("catches work filed against a task nobody published", () => {
    expect(codes({ hasAssignment: false })).toContain("filed-but-not-asked");
    expect(codes({ hasAssignment: false })).toContain("critiques-not-counted");
  });

  it("catches somebody whose requirement rose after they had finished", () => {
    expect(codes({ critiquesGiven: 1, reviewsRequired: 2, reviewsCleared: 1 }))
      .toContain("owes-critiques");
  });

  it("does not accuse somebody who simply has not finished yet", () => {
    // Nothing was ever written down for them, so nothing was taken back.
    expect(codes({ critiquesGiven: 1, reviewsRequired: 2, reviewsCleared: null }))
      .not.toContain("owes-critiques");
  });

  it("does not complain about a module with no recording at all", () => {
    expect(codes({
      hasRecording: false, moduleRecordingSeconds: null,
      learnerRecordingSeconds: null, watchedSeconds: 0,
    })).toEqual([]);
  });

  it("says plainly when a cohort has nothing to answer for", () => {
    expect(auditNote([{ flags: [] }, { flags: [] }], 2)).toMatch(/Nothing to answer for/);
    expect(auditNote([], 0)).toMatch(/Nobody is enrolled/);
  });

  it("counts the records that cannot both be right", () => {
    const note = auditNote([{ flags: [] }, { flags: auditFlags({ ...clean, learnerRecordingSeconds: 60 }) }], 2);
    expect(note).toContain("1 record");
    expect(note).toContain("2 learners");
  });

  it("catches work that was withdrawn, and says it is all still there", () => {
    const flags = auditFlags({ ...clean, withdrawn: true, withdrawnOn: "14 Sep", bodyLength: 4200 });
    expect(flags.map((f) => f.code)).toContain("withdrawn");
    // The reassuring half matters as much as the flag: this is the one kind of
    // missing work that comes back whole.
    expect(flags.find((f) => f.code === "withdrawn")!.note).toContain("Nothing has been lost");
    expect(flags.find((f) => f.code === "withdrawn")!.note).toContain("14 Sep");
  });

  it("catches a submission too short to be a finished answer", () => {
    // What a save over a blank or half-loaded editor leaves behind.
    expect(codes({ bodyLength: 16 })).toContain("very-short-submission");
    expect(codes({ bodyLength: 4200 })).not.toContain("very-short-submission");
  });

  it("does not call a withdrawn piece short as well", () => {
    // It was withdrawn on purpose. Two complaints about one row is noise.
    expect(codes({ withdrawn: true, bodyLength: 16 })).not.toContain("very-short-submission");
  });

  it("says nothing about length where no task was published", () => {
    expect(codes({ hasAssignment: false, bodyLength: 16 }))
      .not.toContain("very-short-submission");
  });
});

describe("the audit as text, for passing on", () => {
  const row = (over: Partial<AuditReportRow> = {}): AuditReportRow => ({
    moduleTitle: "Module 3", liveMinutes: 60, watchedMinutes: 40,
    learnerRecordingMinutes: 60, hasSubmission: true, withdrawn: false,
    critiquesGiven: 1, critiquesReceived: 0, reviewsRequired: 2,
    completed: false, locked: false, progressPct: 75, flags: [], ...over,
  });
  const flag = { code: "withdrawn" as const, note: "Their work was withdrawn by staff." };

  it("says so in four lines when a cohort is clean", () => {
    const text = auditReportText({
      programmeTitle: "Pipeline comms", note: "Nothing to answer for.",
      learners: [{ name: "Ada", flagged: 0, rows: [row()] }],
    });
    expect(text).toContain("No records contradict themselves");
    expect(text.split("\n").length).toBeLessThan(8);
  });

  it("names only the learners with something wrong", () => {
    const text = auditReportText({
      programmeTitle: "Pipeline comms", note: "1 record.",
      learners: [
        { name: "Ada", flagged: 0, rows: [row()] },
        { name: "Bala", flagged: 1, rows: [row({ flags: [flag] })] },
      ],
    });
    expect(text).toContain("Bala");
    expect(text).not.toContain("Ada");
    expect(text).toContain("1 of 2 learners");
  });

  it("shows what is stored beside what the Lab says", () => {
    const text = auditReportText({
      programmeTitle: "P", note: "n",
      learners: [{ name: "Bala", flagged: 1, rows: [row({ flags: [flag], locked: true })] }],
    });
    expect(text).toContain("40 of 60 min watched");
    expect(text).toContain("1/2 critiques written");
    expect(text).toContain("LOCKED");
    expect(text).toContain("[withdrawn]");
  });

  it("leaves out the modules that are fine", () => {
    const text = auditReportText({
      programmeTitle: "P", note: "n",
      learners: [{
        name: "Bala", flagged: 1,
        rows: [row({ moduleTitle: "Module 1" }), row({ moduleTitle: "Module 3", flags: [flag] })],
      }],
    });
    expect(text).not.toContain("Module 1");
    expect(text).toContain("Module 3");
  });
});

describe("how far apart two recording lengths have to be to matter", () => {
  it("says nothing about a second's rounding", () => {
    // 3420 and 3421 seconds both print as 57 minutes. Reporting that gives an
    // admin a sentence saying 57 disagrees with 57, six times over, about a
    // cohort where nothing is wrong.
    expect(auditFlags({
      ...clean, moduleRecordingSeconds: 3420, learnerRecordingSeconds: 3421,
    }).map((f) => f.code)).not.toContain("recording-length-disagrees");
    expect(auditFlags({
      ...clean, moduleRecordingSeconds: 3420, learnerRecordingSeconds: 3470,
    }).map((f) => f.code)).not.toContain("recording-length-disagrees");
  });

  it("still catches a gap big enough to move somebody past a bar", () => {
    expect(auditFlags({
      ...clean, moduleRecordingSeconds: 600, learnerRecordingSeconds: 3600,
    }).map((f) => f.code)).toContain("recording-length-disagrees");
    // A minute apart is the smallest gap a person can see in a sentence
    // written in minutes.
    expect(auditFlags({
      ...clean, moduleRecordingSeconds: 3420, learnerRecordingSeconds: 3540,
    }).map((f) => f.code)).toContain("recording-length-disagrees");
  });
});

describe("a record that looks wiped", () => {
  const busy = {
    userId: 1, createdOn: "3 Aug", enrolledOnProgrammes: 1,
    classesAttended: 4, recordingsWatched: 3, tasksFiled: 2, critiquesWritten: 5,
  };
  const blank = {
    userId: 2, createdOn: "16 Sep", enrolledOnProgrammes: 1,
    classesAttended: 0, recordingsWatched: 0, tasksFiled: 0, critiquesWritten: 0,
  };

  it("spots one account carrying everything and another carrying nothing", () => {
    expect(looksWiped([busy, blank])).toBe(true);
  });

  it("says nothing about a single account", () => {
    expect(looksWiped([busy])).toBe(false);
  });

  it("says nothing when both accounts have been used", () => {
    // Two accounts both doing work is a different problem, and not this one.
    expect(looksWiped([busy, { ...blank, classesAttended: 2 }])).toBe(false);
  });

  it("says nothing when neither has done anything", () => {
    // A duplicate nobody has used has lost nobody anything.
    expect(looksWiped([blank, { ...blank, userId: 3 }])).toBe(false);
  });

  it("names which account holds the record, and reassures", () => {
    const note = duplicateNote("ada@example.com", [blank, busy]);
    expect(note).toContain("2 accounts");
    expect(note).toContain("made 3 Aug");
    expect(note).toContain("4 classes attended");
    expect(note).toContain("5 critiques written");
    expect(note).toContain("made 16 Sep");
    // The point of the sentence: nothing was deleted.
    expect(note).toContain("not lost");
  });
});
