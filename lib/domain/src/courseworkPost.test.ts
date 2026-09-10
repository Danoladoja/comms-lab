import { describe, expect, it } from "vitest";
import {
  readyToPost,
  describePost,
  postAnnouncement,
  formatDeadlineInZone,
  LAB_TIME_ZONE_LABEL,
  type CourseworkPiece,
} from "./courseworkPost";

const quiz = (over: Partial<CourseworkPiece> = {}): CourseworkPiece =>
  ({ kind: "quiz", draft: true, exists: true, ...over });
const task = (over: Partial<CourseworkPiece> = {}): CourseworkPiece =>
  ({ kind: "assignment", title: "Draft a 200-word narrative brief", draft: true, exists: true, ...over });

const FRIDAY = "2026-09-11T16:00:00Z"; // 5pm in Lagos

const slides = (over: Partial<CourseworkPiece> = {}): CourseworkPiece =>
  ({ kind: "slides", draft: true, exists: true, ...over });
const readings = (over: Partial<CourseworkPiece> = {}): CourseworkPiece =>
  ({ kind: "readings", draft: true, exists: true, ...over });

describe("the unmarked pieces", () => {
  it("posts the slides and the reading list alongside the marked work", () => {
    // One press, one letter. From a learner's side this is one event — "this
    // week's module is up" — not four.
    const going = readyToPost([quiz(), task(), slides(), readings()]);
    expect(going).toHaveLength(4);
    expect(describePost([quiz(), task(), slides(), readings()], 12))
      .toContain("quiz, task, slides and reading list");
  });

  it("says nothing about deadlines for things that are not handed in", () => {
    // A closing date on a reading list would be a sentence about nothing.
    const letter = postAnnouncement({
      moduleTitle: "Who Owns the Grid",
      programmeTitle: "Energy Narratives",
      pieces: [slides(), readings()],
    });
    const body = letter.paragraphs.join(" ");
    expect(body).toContain("slides and reading list");
    expect(body).not.toMatch(/closing date|until/i);
  });

  it("still announces the deadline when marked work goes out with them", () => {
    const letter = postAnnouncement({
      moduleTitle: "Who Owns the Grid",
      programmeTitle: "Energy Narratives",
      pieces: [quiz({ dueAt: FRIDAY }), readings()],
    });
    const body = letter.paragraphs.join(" ");
    expect(body).toContain("quiz and reading list");
    expect(body).toContain("11 September");
    // One deadline sentence, for the quiz, and none for the reading list.
    expect(letter.paragraphs.filter((p) => p.includes("11 September"))).toHaveLength(1);
  });
});

describe("readyToPost", () => {
  it("posts only what is written and still private", () => {
    const pieces = [quiz(), task({ draft: false }), { kind: "quiz", draft: true, exists: false } as CourseworkPiece];
    expect(readyToPost(pieces).map((p) => p.kind)).toEqual(["quiz"]);
  });

  it("finds nothing to post when everything is already live", () => {
    expect(readyToPost([quiz({ draft: false }), task({ draft: false })])).toHaveLength(0);
  });
});

describe("describePost", () => {
  it("names the number of people, because that is what makes it final", () => {
    const line = describePost([quiz(), task()], 24);
    expect(line).toContain("quiz and task");
    expect(line).toContain("24 learners");
    expect(line).toMatch(/cannot be undone/i);
  });

  it("says one learner rather than 1 learners", () => {
    expect(describePost([quiz()], 1)).toContain("1 learner will be emailed");
  });

  it("warns that a cohort of nobody gets no email", () => {
    // Posting to an empty programme is legitimate — the coursework is ready
    // before the intake — but the admin should not be left waiting for a send
    // that never happens.
    expect(describePost([quiz()], 0)).toMatch(/nobody is enrolled/i);
  });

  it("says plainly when there is nothing new to send", () => {
    expect(describePost([quiz({ draft: false })], 24)).toMatch(/already live/i);
    expect(describePost([], 24)).toMatch(/nothing is written yet/i);
  });
});

describe("formatDeadlineInZone", () => {
  it("words the deadline in the Lab's clock and names the clock", () => {
    const words = formatDeadlineInZone(FRIDAY);
    expect(words).toContain("Friday");
    expect(words).toContain("11 September");
    expect(words).toContain("5:00 pm");
    expect(words).toContain(LAB_TIME_ZONE_LABEL);
  });

  it("is the same words wherever the server happens to be running", () => {
    // The server's own clock must not leak into a cohort's inbox. Railway is
    // in UTC today and might not be tomorrow.
    expect(formatDeadlineInZone(FRIDAY, "Africa/Lagos")).toContain("5:00 pm");
    expect(formatDeadlineInZone(FRIDAY, "America/New_York")).toContain("12:00 pm");
  });

  it("says nothing at all when there is no deadline", () => {
    expect(formatDeadlineInZone(null)).toBe("");
    expect(formatDeadlineInZone("rubbish")).toBe("");
  });
});

describe("postAnnouncement", () => {
  it("sends one letter for the module, covering both pieces", () => {
    const letter = postAnnouncement({
      moduleTitle: "Who Owns the Grid",
      programmeTitle: "Energy Narratives",
      pieces: [quiz({ dueAt: FRIDAY }), task({ dueAt: FRIDAY })],
    });

    expect(letter.subject).toContain("Who Owns the Grid");
    expect(letter.paragraphs[0]).toContain("quiz and task");
    // Two deadline sentences, one per piece, and the date in both.
    expect(letter.paragraphs.filter((p) => p.includes("11 September"))).toHaveLength(2);
    expect(letter.paragraphs.join(" ")).toContain("Draft a 200-word narrative brief");
  });

  it("never mentions a piece that is not going out", () => {
    // A learner told the quiz is open when only the task is would go looking
    // for something that is not there.
    const letter = postAnnouncement({
      moduleTitle: "Who Owns the Grid",
      programmeTitle: "Energy Narratives",
      pieces: [quiz({ draft: false }), task({ dueAt: FRIDAY })],
    });
    expect(letter.subject).not.toMatch(/quiz/);
    expect(letter.paragraphs.join(" ")).not.toMatch(/quiz/);
  });

  it("says so plainly when a piece has no closing date", () => {
    const letter = postAnnouncement({
      moduleTitle: "Who Owns the Grid",
      programmeTitle: "Energy Narratives",
      pieces: [quiz({ dueAt: null })],
    });
    expect(letter.paragraphs.join(" ")).toMatch(/no closing date/i);
  });

  it("still reads properly when the module has lost its title", () => {
    const letter = postAnnouncement({
      moduleTitle: "   ",
      programmeTitle: "Energy Narratives",
      pieces: [quiz()],
    });
    expect(letter.subject).not.toContain("undefined");
    expect(letter.paragraphs[0]).toContain("your latest module");
  });

  it("keeps its grammar in both the singular and the plural", () => {
    const one = postAnnouncement({ moduleTitle: "M", programmeTitle: "P", pieces: [quiz()] });
    const two = postAnnouncement({ moduleTitle: "M", programmeTitle: "P", pieces: [quiz(), task()] });
    expect(one.paragraphs[0]).toMatch(/quiz for M is now open/);
    expect(two.paragraphs[0]).toMatch(/quiz and task for M are now open/);
  });
});
