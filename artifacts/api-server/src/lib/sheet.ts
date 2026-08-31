import { unzipSync, strFromU8 } from "fflate";

/**
 * Turning an uploaded spreadsheet into rows of strings.
 *
 * An .xlsx is a zip of XML, which the application already knows how to open —
 * slide decks arrive the same way. Reading the handful of tags we need is a
 * few dozen lines, and worth it: a spreadsheet parser is a large dependency to
 * take on, with a large surface, for a feature that reads two columns.
 *
 * Nothing here decides what a row means. It produces the same shape a pasted
 * block produces, and `readRoster` in @workspace/domain applies one set of
 * rules to both — so the uploaded path and the pasted path cannot drift apart.
 */

export type SheetReadResult =
  | { ok: true; rows: string[][]; sheetName: string | null }
  | { ok: false; problem: string };

/** "A1" -> 0, "B7" -> 1, "AA3" -> 26. */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0] ?? "";
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    // Ampersand last, or an &amp;lt; would be decoded twice.
    .replace(/&amp;/g, "&");
}

/** All the text inside one element, ignoring formatting runs. */
function textOf(xml: string): string {
  const parts = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [];
  return parts
    .map((p) => decodeEntities(p.replace(/<t[^>]*>/, "").replace(/<\/t>/, "")))
    .join("")
    .trim();
}

function isXlsx(bytes: Uint8Array): boolean {
  // Every Office Open XML file is a zip: "PK\x03\x04".
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** A CSV or plain-text upload: hand the text straight back as lines. */
function readDelimitedText(bytes: Uint8Array): SheetReadResult {
  const text = strFromU8(bytes).replace(/^﻿/, "");
  if (!text.trim()) return { ok: false, problem: "That file was empty." };
  // Splitting into cells is the domain's job, so the pasted and uploaded paths
  // go through exactly the same rules.
  return { ok: true, rows: text.replace(/\r\n?/g, "\n").split("\n").map((line) => [line]), sheetName: null };
}

export function readSheet(bytes: Uint8Array): SheetReadResult {
  if (bytes.length === 0) return { ok: false, problem: "That file was empty." };
  if (!isXlsx(bytes)) return readDelimitedText(bytes);

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return { ok: false, problem: "That file could not be opened. Save it again as .xlsx or .csv." };
  }

  const sheetPaths = Object.keys(files)
    .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(p))
    .sort();

  if (sheetPaths.length === 0) {
    // A .xls saved with the wrong extension lands here, as does a zip of
    // something else entirely.
    return { ok: false, problem: "No sheet found in that file. Save it as .xlsx, or paste the rows instead." };
  }

  // Shared strings: most cell text in a workbook lives here, referenced by index.
  const sharedXml = files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : "";
  const shared = (sharedXml.match(/<si>[\s\S]*?<\/si>/g) ?? []).map(textOf);

  // The first sheet only. A workbook of several sheets almost always keeps the
  // list on the first, and guessing between them would be worse than asking.
  const sheetXml = strFromU8(files[sheetPaths[0]]);
  const rows: string[][] = [];

  for (const rowXml of sheetXml.match(/<row[^>]*\/>|<row[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    // A workbook leaves out rows that are entirely empty, so position has to
    // come from the row's own number. Without this, one blank spacer row shifts
    // every problem the admin is shown onto the wrong line of their sheet.
    const declared = Number(rowXml.match(/\br="(\d+)"/)?.[1]);
    const at = Number.isInteger(declared) && declared > 0 ? declared - 1 : rows.length;

    const cells: string[] = [];

    for (const cellXml of rowXml.match(/<c[^>]*\/>|<c[^>]*>[\s\S]*?<\/c>/g) ?? []) {
      const ref = cellXml.match(/\br="([A-Z]+\d+)"/i)?.[1] ?? "";
      const type = cellXml.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const index = ref ? columnIndex(ref) : cells.length;

      let value = "";
      if (type === "s") {
        const at = Number(cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        value = Number.isInteger(at) ? (shared[at] ?? "") : "";
      } else if (type === "inlineStr") {
        value = textOf(cellXml);
      } else {
        const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        value = raw ? decodeEntities(raw).trim() : "";
      }

      // Cells the file omits entirely — an empty column — must still take up a
      // position, or every value after a gap shifts left into the wrong column.
      while (cells.length < index) cells.push("");
      cells[index] = value;
    }

    while (rows.length < at) rows.push([]);
    rows[at] = cells;
  }

  if (rows.length === 0) {
    return { ok: false, problem: "That sheet had no rows in it." };
  }

  const name = decodeEntities(
    (files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "").match(/<sheet[^>]*\bname="([^"]*)"/)?.[1] ?? "",
  );

  return { ok: true, rows, sheetName: name || null };
}
