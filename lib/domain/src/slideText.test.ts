import { describe, expect, it } from "vitest";
import {
  assembleSlideText,
  slideTextQuality,
  slideTypeFor,
  MIN_USABLE_SLIDE_CHARS,
  MAX_SLIDE_CHARS,
} from "./slideText";

describe("assembleSlideText", () => {
  it("keeps each slide separate and numbered", () => {
    const text = assembleSlideText([["Title one", "Point A"], ["Title two"]]);
    expect(text).toContain("--- Slide 1 ---");
    expect(text).toContain("--- Slide 2 ---");
    expect(text).toContain("Point A");
  });

  it("collapses the whitespace that formatting leaves behind", () => {
    const text = assembleSlideText([["  Energy    transition  "]]);
    expect(text).toContain("Energy transition");
  });

  it("skips slides with nothing readable on them", () => {
    const text = assembleSlideText([["Real content"], ["   "], []]);
    expect(text).toContain("Slide 1");
    expect(text).not.toContain("Slide 2");
    expect(text).not.toContain("Slide 3");
  });

  it("returns nothing for an image-only deck", () => {
    expect(assembleSlideText([[], [""], ["  "]])).toBe("");
  });

  it("caps a very long deck rather than sending all of it", () => {
    const huge = Array.from({ length: 500 }, () => ["x".repeat(500)]);
    expect(assembleSlideText(huge).length).toBeLessThanOrEqual(MAX_SLIDE_CHARS);
  });
});

describe("slideTextQuality", () => {
  it("accepts a deck with real content", () => {
    const q = slideTextQuality("x".repeat(MIN_USABLE_SLIDE_CHARS + 1));
    expect(q.usable).toBe(true);
    expect(q.reason).toBe("");
  });

  it("rejects a deck that is only section titles", () => {
    const q = slideTextQuality("Introduction. Agenda. Thank you.");
    expect(q.usable).toBe(false);
    expect(q.reason).toBe("too-thin");
  });

  it("rejects an empty extraction", () => {
    expect(slideTextQuality("   ").reason).toBe("empty");
  });
});

describe("slideTypeFor", () => {
  it("recognises a PowerPoint by its declared type", () => {
    const t = slideTypeFor(
      "class.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    expect(t?.readable).toBe(true);
  });

  it("falls back to the file extension when the browser sends nothing useful", () => {
    const t = slideTypeFor("class.pptx", "application/octet-stream");
    expect(t?.readable).toBe(true);
    expect(t?.mimeType).toContain("presentationml");
  });

  it("accepts plain text and markdown", () => {
    expect(slideTypeFor("notes.txt", null)?.readable).toBe(true);
    expect(slideTypeFor("notes.md", null)?.readable).toBe(true);
  });

  it("accepts a PDF but flags that text cannot be read from it", () => {
    const t = slideTypeFor("deck.pdf", "application/pdf");
    expect(t).not.toBeNull();
    expect(t?.readable).toBe(false);
  });

  it("is case-insensitive about extensions", () => {
    expect(slideTypeFor("DECK.PPTX", null)?.readable).toBe(true);
  });

  it("rejects anything else", () => {
    expect(slideTypeFor("virus.exe", null)).toBeNull();
    expect(slideTypeFor("photo.png", "image/png")).toBeNull();
  });
});
