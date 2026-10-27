import { describe, expect, it } from "vitest";
import {
  capstonePublishProblem,
  capstoneSubmitProblem,
  capstoneReviewProblem,
  capstoneStanding,
  certificateHeldBy,
  capstoneFileType,
  isCapstoneStatus,
  MAX_CAPSTONE_UPLOAD_BYTES,
} from "./capstone";

const NOW = Date.UTC(2026, 9, 27, 9, 0);
const LATER = new Date(Date.UTC(2026, 10, 10)).toISOString();
const EARLIER = new Date(Date.UTC(2026, 8, 10)).toISOString();

const GOOD_BRIEF = {
  title: "Final piece",
  brief: "Write the eight hundred words you would file about a tariff reform your own employer opposes.",
  wordsAtLeast: 600,
  wordsAtMost: 1000,
  maxScore: 100,
  dueAt: LATER,
};

/**
 * Publishing one of these starts withholding certificates from the whole
 * cohort, which is why the gate is checked before the button rather than after.
 */
describe("before a capstone goes to the cohort", () => {
  it("lets a complete one through", () => {
    expect(capstonePublishProblem(GOOD_BRIEF, NOW)).toBeNull();
  });

  it("refuses one with no title", () => {
    expect(capstonePublishProblem({ ...GOOD_BRIEF, title: "  " }, NOW)).toContain("title");
  });

  it("refuses a brief too thin to work from", () => {
    const said = capstonePublishProblem({ ...GOOD_BRIEF, brief: "Write something good." }, NOW);
    expect(said).toContain("judged on");
  });

  it("refuses a deadline that has already gone", () => {
    const said = capstonePublishProblem({ ...GOOD_BRIEF, dueAt: EARLIER }, NOW);
    expect(said).toContain("already passed");
  });

  it("refuses word limits that contradict each other", () => {
    const said = capstonePublishProblem({ ...GOOD_BRIEF, wordsAtLeast: 2000, wordsAtMost: 500 }, NOW);
    expect(said).toContain("longer than the longest");
  });

  it("refuses a capstone marked out of nothing", () => {
    expect(capstonePublishProblem({ ...GOOD_BRIEF, maxScore: 0 }, NOW)).toContain("out of");
  });
});

/**
 * The learner's side. Every refusal here is a sentence somebody reads at the
 * moment they are stopped, so each is checked for the thing it has to say.
 */
describe("before a learner sends their capstone", () => {
  const base = { wordsAtLeast: 600, wordsAtMost: 1000, dueAt: LATER, nowMs: NOW, hasFile: false };
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

  it("lets a piece of the right length through", () => {
    expect(capstoneSubmitProblem({ ...base, body: words(700) })).toBeNull();
  });

  it("refuses an empty one with nothing attached", () => {
    expect(capstoneSubmitProblem({ ...base, body: "   " })).toContain("nothing here yet");
  });

  it("says how short it is, not merely that it is short", () => {
    const said = capstoneSubmitProblem({ ...base, body: words(120) });
    expect(said).toContain("120 words");
    expect(said).toContain("600");
  });

  it("says how long it is when it runs over", () => {
    expect(capstoneSubmitProblem({ ...base, body: words(1400) })).toContain("1400 words");
  });

  /**
   * The rule worth having a test for. Somebody who attached a document wrote it
   * in Word, and the Lab cannot count what is inside the file. Refusing them on
   * a word count we cannot see would be refusing them on nothing at all.
   */
  it("does not hold a word count against somebody who attached the document", () => {
    expect(capstoneSubmitProblem({ ...base, body: "See the attached piece.", hasFile: true })).toBeNull();
  });

  it("refuses after the deadline, and says the work is not lost", () => {
    const said = capstoneSubmitProblem({ ...base, body: words(700), dueAt: EARLIER });
    expect(said).toContain("deadline");
    expect(said).toContain("saved");
  });

  it("has no deadline to miss when none was set", () => {
    expect(capstoneSubmitProblem({ ...base, body: words(700), dueAt: null })).toBeNull();
  });
});

/**
 * Marking. Two rules carry the weight: an approval needs a mark, and a piece
 * sent back needs a reason a person can act on.
 */
describe("when staff decide", () => {
  const base = { maxScore: 100, status: "submitted" };

  it("approves with a mark", () => {
    expect(capstoneReviewProblem({ ...base, decision: "approve", score: 72, note: "" })).toBeNull();
  });

  it("refuses to approve without one", () => {
    expect(capstoneReviewProblem({ ...base, decision: "approve", score: null, note: "" }))
      .toContain("mark");
  });

  it("refuses a mark outside the range", () => {
    expect(capstoneReviewProblem({ ...base, decision: "approve", score: 140, note: "" })).toContain("0 and 100");
    expect(capstoneReviewProblem({ ...base, decision: "approve", score: -2, note: "" })).toContain("0 and 100");
  });

  it("refuses to send a piece back with no reason", () => {
    const said = capstoneReviewProblem({ ...base, decision: "return", score: null, note: "No." });
    expect(said).toContain("what needs to change");
  });

  it("sends it back when there is something to act on", () => {
    expect(capstoneReviewProblem({
      ...base, decision: "return", score: null,
      note: "The regulator's position is asserted rather than sourced. Name where it comes from.",
    })).toBeNull();
  });

  it("will not decide something that was never sent", () => {
    expect(capstoneReviewProblem({ ...base, status: "draft", decision: "approve", score: 70, note: "" }))
      .toContain("not been sent");
  });

  it("will not decide the same attempt twice", () => {
    expect(capstoneReviewProblem({ ...base, status: "approved", decision: "approve", score: 70, note: "" }))
      .toContain("already been approved");
    expect(capstoneReviewProblem({ ...base, status: "returned", decision: "approve", score: 70, note: "" }))
      .toContain("already sent back");
  });
});

describe("what the learner is looking at", () => {
  it("opens the box when nothing has been started", () => {
    const s = capstoneStanding(null);
    expect(s.mayEdit).toBe(true);
    expect(s.maySubmit).toBe(true);
  });

  it("closes the box once it has been sent", () => {
    const s = capstoneStanding({ status: "submitted", score: null });
    expect(s.mayEdit).toBe(false);
    expect(s.headline).toContain("Waiting");
  });

  it("reopens it when the piece comes back", () => {
    const s = capstoneStanding({ status: "returned", score: null });
    expect(s.mayEdit).toBe(true);
    expect(s.maySubmit).toBe(true);
  });

  it("puts the mark in the headline once approved", () => {
    expect(capstoneStanding({ status: "approved", score: 81 }).headline).toContain("81");
  });

  it("does not invent a mark that was never given", () => {
    expect(capstoneStanding({ status: "approved", score: null }).headline).toBe("Approved.");
  });
});

/**
 * The certificates page showed "finish all the modules" to people who had
 * finished all the modules, because the route filtered them out and the browser
 * could not tell them from somebody who had just enrolled. This is the sentence
 * that replaces it.
 */
describe("why the certificate is not here", () => {
  const done = { workDone: true, surveyOutstanding: false, capstoneOutstanding: false, capstoneStatus: null };

  it("says nothing when the work is not finished", () => {
    expect(certificateHeldBy({ ...done, workDone: false, surveyOutstanding: true })).toBeNull();
  });

  it("says nothing when nothing is outstanding", () => {
    expect(certificateHeldBy(done)).toBeNull();
  });

  it("names the survey", () => {
    const said = certificateHeldBy({ ...done, surveyOutstanding: true });
    expect(said).toContain("every module");
    expect(said).toContain("closing survey");
  });

  it("says which way the capstone is stuck", () => {
    expect(certificateHeldBy({ ...done, capstoneOutstanding: true, capstoneStatus: "submitted" }))
      .toContain("waiting to be read");
    expect(certificateHeldBy({ ...done, capstoneOutstanding: true, capstoneStatus: "returned" }))
      .toContain("sent back");
    expect(certificateHeldBy({ ...done, capstoneOutstanding: true, capstoneStatus: null }))
      .toContain("not been sent");
  });

  it("names both when both are outstanding", () => {
    const said = certificateHeldBy({
      ...done, capstoneOutstanding: true, capstoneStatus: "draft", surveyOutstanding: true,
    });
    expect(said).toContain("capstone");
    expect(said).toContain("closing survey");
  });
});

describe("the attached document", () => {
  it("knows the formats by name, whatever the browser calls them", () => {
    expect(capstoneFileType("piece.docx", "application/octet-stream")?.label).toBe("Word");
    expect(capstoneFileType("piece.PDF", null)?.mimeType).toBe("application/pdf");
    expect(capstoneFileType("notes.md", null)?.label).toBe("Markdown");
  });

  it("falls back to the declared type when the name says nothing", () => {
    expect(capstoneFileType("attachment", "application/pdf")?.label).toBe("PDF");
  });

  it("refuses what it cannot read", () => {
    expect(capstoneFileType("piece.exe", "application/octet-stream")).toBeNull();
    expect(capstoneFileType("photo.png", "image/png")).toBeNull();
  });

  it("has a ceiling a person can be told about", () => {
    expect(MAX_CAPSTONE_UPLOAD_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe("statuses", () => {
  it("recognises only the four", () => {
    expect(isCapstoneStatus("submitted")).toBe(true);
    expect(isCapstoneStatus("graded")).toBe(false);
    expect(isCapstoneStatus(null)).toBe(false);
  });
});
