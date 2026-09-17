import { describe, expect, it } from "vitest";
import {
  tidyTranscript,
  decideImport,
  approximateWords,
  MIN_TRANSCRIPT_CHARS,
} from "./transcriptImport";
import { MAX_NOTES_CHARS } from "./courseworkSource";

/** A transcript document roughly as Google exports one. */
const exported = (speech: string) => [
  "Energy Fundamentals - 2026/09/10 15:00 WAT - Transcript",
  "",
  "Attendees",
  "Amina Bello, Kwame Mensah, Ngozi Eze",
  "",
  "Transcript",
  "This editable transcript was computer generated and might contain errors. "
    + "People can also change the text after it was created.",
  "",
  speech,
].join("\n");

/** Long enough to be a real class. */
const aClass = Array.from(
  { length: 200 },
  (_, i) => `Amina Bello: And the point about tariffs, number ${i}, is that they are political.`,
).join("\n");

describe("tidying the exported document", () => {
  it("removes Google's own disclaimer", () => {
    // It is the one line certain not to be teaching, and without removing it,
    // it becomes the opening of every piece of material the drafting reads.
    const out = tidyTranscript(exported(aClass));
    expect(out).not.toMatch(/computer generated/i);
    expect(out).toMatch(/Amina Bello: And the point about tariffs/);
  });

  it("keeps everything else, including the heading and the attendees", () => {
    // Shallow on purpose. Parsing out sections is a rule that breaks silently
    // the day Google changes its layout, taking real speech with it.
    const out = tidyTranscript(exported(aClass));
    expect(out).toMatch(/Energy Fundamentals/);
    expect(out).toMatch(/Ngozi Eze/);
  });

  it("closes the hole left where the disclaimer was", () => {
    expect(tidyTranscript(exported(aClass))).not.toMatch(/\n{3,}/);
  });

  it("copes with Windows line endings", () => {
    expect(tidyTranscript("A\r\nB\r\n")).toBe("A\nB");
  });

  it("will not exceed what the material box holds", () => {
    const huge = "word ".repeat(MAX_NOTES_CHARS);
    expect(tidyTranscript(huge).length).toBeLessThanOrEqual(MAX_NOTES_CHARS);
  });

  it("survives a document that is only the disclaimer", () => {
    expect(tidyTranscript("This editable transcript was computer generated.")).toBe("");
  });
});

describe("never overwriting a person", () => {
  it("leaves a box somebody has already filled completely alone", () => {
    // The rule that matters most. A facilitator's pasted transcript may have
    // been cleaned up, had names corrected, been cut to the teaching part.
    // Replacing it because a raw export arrived later destroys that silently.
    const d = decideImport({ raw: exported(aClass), existing: "My own carefully edited transcript." });
    expect(d.save).toBe(false);
    expect(d.note).toMatch(/already has material/i);
    expect(d.note).toMatch(/Clear the box first/i);
  });

  it("treats whitespace in the box as empty", () => {
    // A box holding a stray newline is not somebody's work.
    const d = decideImport({ raw: exported(aClass), existing: "   \n  " });
    expect(d.save).toBe(true);
  });

  it("does not compare lengths or dates to decide who wins", () => {
    // Every version of "the newer/longer one wins" ends with somebody's edited
    // transcript replaced by a raw one. One short hand-written line beats a
    // whole export, and that is correct.
    const d = decideImport({ raw: exported(aClass), existing: "x" });
    expect(d.save).toBe(false);
  });
});

describe("half a transcript being worse than none", () => {
  it("refuses one that is only a few seconds of a class", () => {
    // An empty box is honest about having nothing. A box with forty words in it
    // looks like material, gets drafted from, and produces a quiz about the
    // first thirty seconds of the class.
    const d = decideImport({ raw: exported("Amina Bello: Right, can everyone hear me?"), existing: "" });
    expect(d.save).toBe(false);
    expect(d.note).toMatch(/too short to be the class/i);
    expect(d.note).toMatch(/started and stopped/i);
  });

  it("accepts one that is plainly a class", () => {
    const d = decideImport({ raw: exported(aClass), existing: null });
    expect(d.save).toBe(true);
    expect(d.save && d.text).toMatch(/tariffs/);
    expect(d.note).toMatch(/Transcript saved/);
    // The size is said out loud, because "saved" alone does not tell anybody
    // whether what arrived was the class or a fragment of it.
    expect(d.note).toMatch(/[\d,]+ words/);
  });

  it("puts the floor where a real class clears it and a fragment does not", () => {
    const justUnder = "a ".repeat(Math.floor(MIN_TRANSCRIPT_CHARS / 2) - 10);
    expect(decideImport({ raw: justUnder, existing: "" }).save).toBe(false);
    const justOver = "a ".repeat(MIN_TRANSCRIPT_CHARS);
    expect(decideImport({ raw: justOver, existing: "" }).save).toBe(true);
  });
});

describe("counting words", () => {
  it("counts them, and is not upset by nothing", () => {
    expect(approximateWords("one two three")).toBe(3);
    expect(approximateWords("  ")).toBe(0);
    expect(approximateWords("")).toBe(0);
  });
});
