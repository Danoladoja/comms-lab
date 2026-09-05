import { describe, expect, it } from "vitest";
import {
  assembleSlideText,
  slideTextQuality,
  slideTypeFor,
  listSlideFormats,
  SLIDE_UPLOAD_EXTENSIONS,
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

  it("reads a PDF, which it used to accept and then ignore", () => {
    // PowerPoint was quietly the price of using the drafting at all. Material
    // arrives as a PDF export more often than as a .pptx.
    const t = slideTypeFor("deck.pdf", "application/pdf");
    expect(t).not.toBeNull();
    expect(t?.readable).toBe(true);
  });

  it("accepts a Word document, by type and by extension", () => {
    const declared = slideTypeFor(
      "handout.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(declared?.readable).toBe(true);
    expect(slideTypeFor("handout.docx", "application/octet-stream")?.mimeType)
      .toContain("wordprocessingml");
  });

  it("is case-insensitive about extensions", () => {
    expect(slideTypeFor("DECK.PPTX", null)?.readable).toBe(true);
    expect(slideTypeFor("Handout.DOCX", null)?.readable).toBe(true);
  });

  it("does not mistake the old formats for the new ones", () => {
    // .doc and .ppt are a different container entirely — not a zip of XML — so
    // accepting them would mean accepting a file nothing can read.
    expect(slideTypeFor("handout.doc", null)).toBeNull();
    expect(slideTypeFor("deck.ppt", null)).toBeNull();
  });

  it("rejects anything else", () => {
    expect(slideTypeFor("virus.exe", null)).toBeNull();
    expect(slideTypeFor("photo.png", "image/png")).toBeNull();
  });
});

describe("listSlideFormats", () => {
  it("reads as a sentence and names every accepted format", () => {
    const listed = listSlideFormats();
    for (const extension of SLIDE_UPLOAD_EXTENSIONS) {
      expect(listed).toContain(extension);
    }
    expect(listed).toMatch(/ or \.\w+$/);
  });
});
