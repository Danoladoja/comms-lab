/**
 * Turning a deck into readable text, and deciding whether it is worth drafting
 * coursework from.
 *
 * The parsing itself needs a zip reader and lives on the server; what is here is
 * the part worth testing without one — tidying the extracted fragments into
 * something a model can actually read, and judging whether there is enough
 * substance to bother.
 */

/** Below this, a deck is section titles and stock photos — not enough to work from. */
export const MIN_USABLE_SLIDE_CHARS = 400;

/**
 * The most deck text sent for drafting. Comfortably more than a class deck, and
 * a guard against someone uploading a 300-page appendix.
 */
export const MAX_SLIDE_CHARS = 60_000;

export type SlideTextQuality = {
  chars: number;
  usable: boolean;
  reason: "" | "too-thin" | "empty";
};

/**
 * Fragments arrive one text run at a time — a heading split across three runs
 * because a word was bold. Joined naively they read as "Ener gy tran sition".
 * Runs are joined within a line, lines within a slide, and slides separated
 * clearly so the model can tell where one ends.
 */
export function assembleSlideText(slides: string[][]): string {
  return slides
    .map((runs, i) => {
      const body = runs
        .map((run) => run.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n")
        .trim();
      return body ? `--- Slide ${i + 1} ---\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_SLIDE_CHARS);
}

export function slideTextQuality(text: string): SlideTextQuality {
  const chars = text.trim().length;
  if (chars === 0) return { chars, usable: false, reason: "empty" };
  if (chars < MIN_USABLE_SLIDE_CHARS) return { chars, usable: false, reason: "too-thin" };
  return { chars, usable: true, reason: "" };
}

/** Formats accepted for upload, and whether text can be read out of each. */
export const SLIDE_UPLOAD_TYPES: Record<string, { extension: string; readable: boolean; label: string }> = {
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    extension: ".pptx",
    readable: true,
    label: "PowerPoint or Google Slides (.pptx)",
  },
  "text/plain": { extension: ".txt", readable: true, label: "Plain text (.txt)" },
  "text/markdown": { extension: ".md", readable: true, label: "Markdown (.md)" },
  "application/pdf": { extension: ".pdf", readable: false, label: "PDF (.pdf)" },
};

export const MAX_SLIDE_UPLOAD_BYTES = 25 * 1024 * 1024;

export function slideTypeFor(filename: string, declaredMime: string | null | undefined) {
  if (declaredMime && SLIDE_UPLOAD_TYPES[declaredMime]) {
    return { mimeType: declaredMime, ...SLIDE_UPLOAD_TYPES[declaredMime] };
  }
  const lower = filename.toLowerCase();
  for (const [mimeType, meta] of Object.entries(SLIDE_UPLOAD_TYPES)) {
    if (lower.endsWith(meta.extension)) return { mimeType, ...meta };
  }
  return null;
}
