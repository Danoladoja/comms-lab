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

export function extractPlainText(buffer: Buffer): string {
  // Treat each blank-line-separated block as a slide, which is how notes and
  // markdown outlines are usually written anyway.
  const blocks = buffer
    .toString("utf8")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean));
  return assembleSlideText(blocks);
}

/** Pull readable text from an upload, or return "" when the format hides it. */
export function extractSlideText(buffer: Buffer, mimeType: string): string {
  if (mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return extractPptxText(buffer);
  }
  if (mimeType === "text/plain" || mimeType === "text/markdown") {
    return extractPlainText(buffer);
  }
  // PDFs are accepted so learners can still read the deck, but no text is
  // lifted from them — that needs a parser heavy enough to be its own decision.
  return "";
}
