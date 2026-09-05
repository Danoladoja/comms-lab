import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * Reading the words out of what facilitators actually upload.
 *
 * These run against real files rather than hand-built fragments, because the
 * whole failure mode here is a format that looks readable and is not. A
 * synthetic .docx assembled to match the parser proves the parser matches
 * itself; a document Word actually wrote proves it reads Word.
 *
 * The PDF was printed by a browser, which is the hard case on purpose: it
 * embeds subset fonts, so the mapping from painted glyphs back to characters
 * lives inside the file. A naive extractor returns confident nonsense for
 * exactly this, and nonsense is worse than nothing — it would be fed silently
 * into the coursework drafting rather than refused.
 */

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { extractDocxText, extractPdfText, extractPlainText, extractSlideText } from "./extract";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(here, "fixtures", name));

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF = "application/pdf";

describe("extractDocxText", () => {
  const text = () => extractDocxText(fixture("handout.docx"));

  it("reads a document Word actually wrote", () => {
    expect(text()).toContain("Reporting the Energy Transition");
    expect(text()).toContain("who carries the debt when a new line is financed");
  });

  it("keeps a heading apart from the paragraph beneath it", () => {
    // Without a paragraph boundary these run together into one sentence, and
    // the model reads "Three numbers Installed capacity" as a single thought.
    expect(text()).not.toContain("Three numbersInstalled");
    expect(text()).toMatch(/Three numbers\n/);
  });

  it("rejoins a sentence Word split across runs for formatting", () => {
    // Bolding one word splits the sentence into three runs. Joined naively they
    // arrive as three separate lines.
    expect(text()).toContain("A sentence split across three runs.");
  });

  it("gives enough to draft from", () => {
    expect(text().length).toBeGreaterThan(400);
  });

  it("returns nothing rather than throwing on a file that is not a document", () => {
    expect(extractDocxText(Buffer.from("this is not a zip"))).toBe("");
    // A valid zip with no document.xml in it — a .pptx handed to the wrong reader.
    expect(extractDocxText(fixture("deck.pdf"))).toBe("");
  });
});

describe("extractPdfText", () => {
  it("reads a PDF printed with embedded subset fonts", async () => {
    const text = await extractPdfText(fixture("deck.pdf"));
    expect(text).toContain("Reporting the Energy Transition");
    expect(text).toContain("Installed capacity, peak demand, and unserved energy");
  });

  it("gives enough to draft from", async () => {
    expect((await extractPdfText(fixture("deck.pdf"))).length).toBeGreaterThan(400);
  });

  it("reads as empty rather than failing on something that is not a PDF", async () => {
    // A scan, an encrypted file or a damaged one all land here. The upload still
    // succeeds and learners can still read it; there is simply nothing to draft.
    await expect(extractPdfText(Buffer.from("not a pdf at all"))).resolves.toBe("");
  });
});

describe("extractSlideText", () => {
  it("routes each format to something that can read it", async () => {
    await expect(extractSlideText(fixture("handout.docx"), DOCX)).resolves.toContain("Reporting the Energy");
    await expect(extractSlideText(fixture("deck.pdf"), PDF)).resolves.toContain("Reporting the Energy");
    await expect(extractSlideText(Buffer.from("Some notes\n\nAnd a second block"), "text/plain"))
      .resolves.toContain("Some notes");
  });

  it("gives nothing for a format it does not know", async () => {
    await expect(extractSlideText(fixture("deck.pdf"), "image/png")).resolves.toBe("");
  });

  it("does not read a Word file as a deck, or the reverse", async () => {
    // Both are zips of XML, so the wrong reader opens the file happily and finds
    // none of the elements it wants. It must come back empty, not garbled.
    await expect(extractSlideText(
      fixture("handout.docx"),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    )).resolves.toBe("");
  });
});

describe("extractPlainText", () => {
  it("treats a blank line as the break between blocks", () => {
    const text = extractPlainText(Buffer.from("First block\nsecond line\n\nSecond block"));
    expect(text).toContain("First block");
    expect(text).toContain("Second block");
  });
});
