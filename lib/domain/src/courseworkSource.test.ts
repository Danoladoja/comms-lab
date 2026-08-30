import { describe, expect, it } from "vitest";
import {
  combineSources,
  sourceQuality,
  describeSource,
  MAX_COMBINED_SOURCE_CHARS,
  MAX_NOTES_CHARS,
  SLIDE_SHARE_OF_BUDGET,
} from "./courseworkSource";
import { MIN_USABLE_SLIDE_CHARS } from "./slideText";

describe("combineSources", () => {
  it("uses the slides alone when that is all there is", () => {
    const s = combineSources({ slideText: "Slide one\nSlide two" });
    expect(s.kinds).toEqual(["slides"]);
    expect(s.text).toContain("=== SLIDES ===");
    expect(s.text).toContain("Slide one");
  });

  it("uses pasted material alone when there is no deck", () => {
    // The facilitator who taught from a script and never made slides.
    const s = combineSources({ notesText: "We opened by asking who pays for the grid." });
    expect(s.kinds).toEqual(["notes"]);
    expect(s.text).toContain("=== TRANSCRIPT ===");
  });

  it("announces each source by name so the model can tell them apart", () => {
    const s = combineSources({ slideText: "Deck", notesText: "Talk", notesLabel: "Speaker notes" });
    expect(s.kinds).toEqual(["slides", "notes"]);
    expect(s.text).toContain("=== SLIDES ===");
    expect(s.text).toContain("=== SPEAKER NOTES ===");
    expect(s.text.indexOf("=== SLIDES ===")).toBeLessThan(s.text.indexOf("=== SPEAKER NOTES ==="));
  });

  it("returns nothing usable when both sources are empty", () => {
    const s = combineSources({ slideText: "   ", notesText: "" });
    expect(s.kinds).toEqual([]);
    expect(s.chars).toBe(0);
    expect(sourceQuality(s).usable).toBe(false);
  });

  it("falls back to a default label when none was chosen", () => {
    const s = combineSources({ notesText: "x", notesLabel: "  " });
    expect(s.text).toContain("=== TRANSCRIPT ===");
  });

  it("keeps the whole transcript when the deck is small", () => {
    // The normal case: a class deck is a few thousand characters, a transcript
    // is tens of thousands. Nothing should be cut.
    const slides = "S".repeat(5_000);
    const notes = "N".repeat(70_000);
    const s = combineSources({ slideText: slides, notesText: notes });
    expect(s.truncated).toBe(false);
    expect(s.text).toContain("N".repeat(1_000));
  });

  it("trims the deck rather than the transcript when both are huge", () => {
    const slides = "S".repeat(80_000);
    const notes = "N".repeat(80_000);
    const s = combineSources({ slideText: slides, notesText: notes });
    expect(s.truncated).toBe(true);
    expect(s.chars).toBeLessThanOrEqual(MAX_COMBINED_SOURCE_CHARS + 200);

    // Count only the body of each section, not the "=== SLIDES ===" headers.
    const slideShare = (s.text.match(/S{2,}/g) ?? []).reduce((n, run) => n + run.length, 0);
    const notesShare = (s.text.match(/N{2,}/g) ?? []).reduce((n, run) => n + run.length, 0);
    expect(slideShare).toBeLessThanOrEqual(Math.ceil(MAX_COMBINED_SOURCE_CHARS * SLIDE_SHARE_OF_BUDGET));
    expect(notesShare).toBeGreaterThan(slideShare);
  });

  it("caps a pasted wall of text before it is even considered", () => {
    const s = combineSources({ notesText: "N".repeat(MAX_NOTES_CHARS + 50_000) });
    expect(s.chars).toBeLessThanOrEqual(MAX_COMBINED_SOURCE_CHARS + 200);
    expect(s.truncated).toBe(true);
  });

  it("cuts at a line break rather than mid-sentence", () => {
    const lines = Array.from({ length: 5_000 }, (_, i) => `Line ${i} of the transcript`).join("\n");
    const s = combineSources({ notesText: lines });
    expect(s.truncated).toBe(true);
    expect(s.text.endsWith(" ")).toBe(false);
    // The last kept line is whole.
    const last = s.text.trimEnd().split("\n").pop() ?? "";
    expect(last).toMatch(/^Line \d+ of the transcript$/);
  });

  it("treats a slides-only deck under the bar as not worth drafting from", () => {
    const s = combineSources({ slideText: "Energy transition" });
    expect(sourceQuality(s).usable).toBe(false);
    expect(sourceQuality(s).reason).toBe("too-thin");
  });

  it("lets a thin deck become usable once a transcript is added", () => {
    // The point of the whole feature: a deck of headings plus what was actually
    // said is enough to write real questions from.
    const thin = "Slide 1: Tariffs";
    expect(sourceQuality(combineSources({ slideText: thin })).usable).toBe(false);

    const s = combineSources({ slideText: thin, notesText: "T".repeat(MIN_USABLE_SLIDE_CHARS * 2) });
    expect(sourceQuality(s).usable).toBe(true);
    expect(s.kinds).toEqual(["slides", "notes"]);
  });
});

describe("describeSource", () => {
  it("names one source", () => {
    expect(describeSource(["slides"])).toBe("the slides");
    expect(describeSource(["notes"], "Transcript")).toBe("the transcript");
  });

  it("joins two sources readably", () => {
    expect(describeSource(["slides", "notes"], "Transcript")).toBe("the slides and the transcript");
  });

  it("uses the label the facilitator chose", () => {
    expect(describeSource(["slides", "notes"], "Speaker notes")).toBe("the slides and the speaker notes");
  });

  it("says so when there was nothing", () => {
    expect(describeSource([])).toBe("nothing");
  });
});
