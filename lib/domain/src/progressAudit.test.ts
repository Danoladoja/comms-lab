import { describe, expect, it } from "vitest";
import { auditFlags, auditNote, type AuditFacts } from "./progressAudit";

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
