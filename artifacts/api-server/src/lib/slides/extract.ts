import { unzipSync, strFromU8 } from "fflate";
import { assembleSlideText } from "@workspace/domain";
import { logger } from "../logger";

/**
 * Reading the words out of a deck.
 *
 * A .pptx is a zip of XML. Every piece of visible text sits in an `<a:t>`
 * element, so the text can be lifted out without a PowerPoint library — which
 * matters, because the alternatives weigh more than the rest of this server put
 * together.
 *
 * Slides are read in their real order. `slide2.xml` sorts before `slide10.xml`
 * alphabetically, which would silently scramble a long deck, so the number is
 * parsed and sorted numerically.
 */

const SLIDE_PATH = /^ppt\/slides\/slide(\d+)\.xml$/;

/** Decode the five XML entities that appear in Office files. */
function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textRunsFrom(xml: string): string[] {
  const runs: string[] = [];
  // <a:t> holds one run of visible text. A heading split by bold formatting
  // arrives as several runs, which assembleSlideText rejoins.
  const pattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const value = decodeXml(match[1]).trim();
    if (value) runs.push(value);
  }
  return runs;
}

export function extractPptxText(buffer: Buffer): string {
  try {
    const files = unzipSync(new Uint8Array(buffer));

    const slides = Object.keys(files)
      .map((path) => ({ path, match: SLIDE_PATH.exec(path) }))
      .filter((entry): entry is { path: string; match: RegExpExecArray } => entry.match !== null)
      .sort((a, b) => Number(a.match[1]) - Number(b.match[1]))
      .map((entry) => textRunsFrom(strFromU8(files[entry.path])));

    return assembleSlideText(slides);
  } catch (err) {
    logger.warn({ err }, "Could not read text out of the uploaded deck");
    return "";
  }
}

/**
 * Reading the words out of a Word document.
 *
 * The same trick as a .pptx, because it is the same kind of file: a zip of XML,
 * with visible text in `<w:t>` elements. The only real difference is what
 * counts as a break. A deck has slides; a document has paragraphs, so `<w:p>`
 * is the boundary — which keeps a heading apart from the paragraph under it
 * rather than running the two together into one sentence.
 *
 * .doc, the pre-2007 format, is a different container entirely and is not
 * accepted; there is nothing here that could read it.
 */
const PARAGRAPH_END = /<\/w:p>/;

export function extractDocxText(buffer: Buffer): string {
  try {
    const files = unzipSync(new Uint8Array(buffer));
    const document = files["word/document.xml"];
    if (!document) return "";

    const paragraphs = strFromU8(document)
      .split(PARAGRAPH_END)
      .map((paragraph) => wordRunsFrom(paragraph))
      .filter((runs) => runs.length > 0);

    return assembleSlideText(paragraphs);
  } catch (err) {
    logger.warn({ err }, "Could not read text out of the uploaded document");
    return "";
  }
}

function wordRunsFrom(xml: string): string[] {
  const runs: string[] = [];
  const pattern = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const value = decodeXml(match[1]).trim();
    if (value) runs.push(value);
  }
  // One paragraph is one block. Word splits a sentence into a run per format
  // change, so joining with a space rather than a newline is what keeps
  // "**Energy** transition" from arriving as two lines.
  return runs.length > 0 ? [runs.join(" ")] : [];
}

/**
 * Reading the words out of a PDF.
 *
 * This is the one format here that genuinely needs a library. A PDF does not
 * store text so much as instructions for painting glyphs, and the mapping back
 * to characters lives in whatever font subset the exporter embedded. Hand-rolled
 * extraction handles the simple cases and returns confident nonsense for the
 * rest — and nonsense is worse than nothing here, because it would be fed
 * silently into the drafting rather than refused.
 *
 * unpdf is a build of Mozilla's pdf.js packaged to run on a server with no
 * browser and no worker thread, which is exactly this situation.
 */
const MAX_PDF_PAGES = 120;

export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));

    // Only as many pages as could possibly be used. Reading the whole document
    // would give the same answer after far more work — assembleSlideText caps
    // the result at MAX_SLIDE_CHARS, so the last four hundred pages of an annual
    // report get discarded having first been parsed. That parsing is not free,
    // and it happens on the thread serving every other request.
    const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const pages: string[][] = [];

    for (let number = 1; number <= pageCount; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      // Each item is one positioned run. Joining them and splitting on the real
      // line breaks gives back something that reads the way the page did.
      const lines = String(
        content.items.map((item) => ("str" in item ? String(item.str) : "")).join(" "),
      )
        .split("\n")
        .map((line) => line.replace(/[ \t]+/g, " ").trim())
        .filter(Boolean);
      if (lines.length > 0) pages.push(lines);
    }

    return assembleSlideText(pages);
  } catch (err) {
    // A scanned PDF is pictures of words: it reads as empty rather than as a
    // failure, and the caller already says so plainly. An encrypted or damaged
    // one lands here too, and is treated the same — the upload still succeeds
    // so learners can read it, there is simply nothing to draft from.
    logger.warn({ err }, "Could not read text out of the uploaded PDF");
    return "";
  }
}

export function extractPlainText(buffer: Buffer): string {
  // Treat each blank-line-separated block as a slide, which is how notes and
  // markdown outlines are usually written anyway.
  const blocks = buffer
    .toString("utf8")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean));
  return assembleSlideText(blocks);
}

/**
 * Pull readable text from an upload.
 *
 * Returns "" rather than throwing when a particular file gives nothing up — a
 * scan, an encrypted PDF, a deck of screenshots. That is not a failed upload:
 * the file is still stored and learners can still read it. It only means there
 * is nothing to draft coursework from, which the caller says in those words.
 */
export async function extractSlideText(buffer: Buffer, mimeType: string): Promise<string> {
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return extractPptxText(buffer);
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return extractDocxText(buffer);
  }
  if (mimeType === "application/pdf") {
    return extractPdfText(buffer);
  }
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return extractPlainText(buffer);
  }
  return "";
}
