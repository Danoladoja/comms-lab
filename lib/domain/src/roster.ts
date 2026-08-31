/**
 * Reading a list of learners out of a spreadsheet.
 *
 * An admin has fifty accepted applicants in Excel or Google Sheets and wants
 * them invited. The sheet was built by a person, for people, so it will have a
 * header row, or not; the name column first, or second; a phone number and an
 * organisation nobody asked for; a blank row where somebody withdrew; and the
 * same applicant twice because two colleagues added them.
 *
 * None of that is a mistake worth refusing over. The job here is to read what
 * was meant, say plainly what could not be read, and never silently drop a
 * person — a dropped row is an applicant who never hears from the Lab and has
 * no way of knowing why.
 *
 * Everything is pure. A pasted block and an uploaded workbook both arrive here
 * as rows of strings, so there is one set of rules and one set of tests, rather
 * than one implementation per input and a bug in whichever is used less.
 */

export const MAX_ROSTER_ROWS = 500;
export const MAX_ROSTER_NAME = 120;

export type RosterEntry = {
  /** 1-based, counting the rows the admin can see, so a problem can be pointed at. */
  row: number;
  name: string;
  email: string;
};

export type RosterProblem = {
  row: number;
  /** Kept so the admin can recognise the row in their own sheet. */
  raw: string;
  problem: string;
};

export type RosterReading = {
  entries: RosterEntry[];
  problems: RosterProblem[];
  /** Rows dropped as an exact repeat of an address already listed. */
  duplicates: RosterProblem[];
  /** True when a first row was read as headings rather than a person. */
  headerSkipped: boolean;
  /** Set when the sheet is longer than we will process in one go. */
  truncated: boolean;
};

const EMAIL_RE = /^[^@\s]+@[^@.\s]+(\.[^@.\s]+)+$/;

function looksLikeEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim().toLowerCase());
}

/**
 * Pull an address out of a cell that may be dressed up.
 *
 * Mail clients and exports produce `Amina Bello <amina@x.org>` and
 * `mailto:amina@x.org`; a person pasting from a directory produces
 * `amina@x.org (Comms)`. All three carry a usable address.
 */
export function extractEmail(cell: string): string | null {
  const text = cell.trim();
  if (!text) return null;

  const angled = text.match(/<([^<>]+)>/);
  const candidates = [
    angled?.[1],
    text.replace(/^mailto:/i, ""),
    ...text.split(/[\s,;()<>]+/),
  ];

  for (const candidate of candidates) {
    const value = (candidate ?? "").trim().replace(/^mailto:/i, "").replace(/[.,;]+$/, "");
    if (value && looksLikeEmail(value)) return value.toLowerCase();
  }
  return null;
}

/** Tidy a name for storing: collapse whitespace, drop surrounding quotes. */
function cleanName(cell: string): string {
  return cell
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, MAX_ROSTER_NAME)
    .trim();
}

/**
 * Split one line into cells.
 *
 * Tab first, because that is what a spreadsheet puts on the clipboard and it
 * cannot be confused with a comma inside "Bello, Amina". Only when there is no
 * tab do we fall back to comma-separated values, quotes and all.
 */
export function splitRow(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((c) => c.trim());

  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (line[i + 1] === '"') { current += '"'; i++; }
        else quoted = false;
      } else current += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * A phone number, not a name.
 *
 * Worth its own check because a phone number is usually *longer* than a name,
 * so any rule that reaches for the biggest cell picks the phone every time.
 */
function looksLikePhone(value: string): boolean {
  const digits = value.replace(/[\s()+\-.]/g, "");
  return digits.length >= 6 && /^\d+$/.test(digits);
}

/** A serial-number column: "1", "2.", "3)". */
function looksLikeIndex(value: string): boolean {
  return /^\d{1,4}[.)]?$/.test(value.trim());
}

/**
 * Choose which cell in the row is the person's name.
 *
 * Nearest to the address wins, looking left first. Sheets are written for
 * people to read, and people put a name beside the address it belongs to:
 * "S/N | Name | Email | Phone" and "Email | Name" both give the right answer,
 * where reaching for the longest cell picks the phone number out of the first
 * and an organisation out of half the sheets in the world.
 */
function pickName(cells: string[], emailIndex: number): string {
  const order: number[] = [];
  for (let d = 1; d < Math.max(emailIndex + 1, cells.length - emailIndex); d++) {
    if (emailIndex - d >= 0) order.push(emailIndex - d);
    if (emailIndex + d < cells.length) order.push(emailIndex + d);
  }

  for (const i of order) {
    const value = cleanName(cells[i] ?? "");
    if (!value) continue;
    if (looksLikeIndex(value) || looksLikePhone(value)) continue;
    // Another address in the row is a second contact, not a name.
    if (extractEmail(value)) continue;
    return value;
  }
  return "";
}

const HEADER_WORDS = [
  "name", "full name", "fullname", "learner", "participant", "applicant", "student",
  "email", "e-mail", "email address", "mail", "address", "contact",
  "first name", "last name", "surname", "given name", "organisation", "organization",
  "phone", "number", "s/n", "sn", "no", "#",
];

/**
 * Does this row name the columns rather than a person?
 *
 * Only rows with no usable address are ever considered. A row containing an
 * email is a person, whatever the other cells say — otherwise a genuine
 * applicant whose name happens to be "Email" would vanish from the list.
 */
export function looksLikeHeader(cells: string[]): boolean {
  if (cells.some((c) => looksLikeEmail(c))) return false;
  const filled = cells.map((c) => c.trim().toLowerCase()).filter(Boolean);
  if (filled.length === 0) return false;
  return filled.some((c) => HEADER_WORDS.includes(c));
}

/**
 * Read a roster from rows of cells.
 *
 * The email column is found per row rather than fixed by position: the address
 * is the only cell whose shape is unmistakable, so looking for it costs nothing
 * and copes with a sheet that puts the name second, or wraps it in a serial
 * number column.
 *
 * The name is then the longest remaining cell that is not obviously a number,
 * which handles a stray "1" in a serial column and an empty organisation.
 */
export function readRoster(rows: string[][]): RosterReading {
  const entries: RosterEntry[] = [];
  const problems: RosterProblem[] = [];
  const duplicates: RosterProblem[] = [];
  const seen = new Map<string, number>();

  let headerSkipped = false;
  let truncated = false;

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const rowNumber = i + 1;
    const raw = cells.join(" | ").trim();

    // Blank rows are how people space a sheet out. Not a problem, not a person.
    if (cells.every((c) => !c || !c.trim())) continue;

    if (i === 0 && looksLikeHeader(cells)) {
      headerSkipped = true;
      continue;
    }

    if (entries.length >= MAX_ROSTER_ROWS) {
      truncated = true;
      break;
    }

    let email: string | null = null;
    let emailIndex = -1;
    for (let c = 0; c < cells.length; c++) {
      const found = extractEmail(cells[c] ?? "");
      if (found) { email = found; emailIndex = c; break; }
    }

    if (!email) {
      problems.push({
        row: rowNumber,
        raw,
        problem: "No email address in this row.",
      });
      continue;
    }

    const name = pickName(cells, emailIndex);

    const already = seen.get(email);
    if (already !== undefined) {
      duplicates.push({
        row: rowNumber,
        raw,
        problem: `Same address as row ${already}. Only the first was kept.`,
      });
      continue;
    }

    seen.set(email, rowNumber);
    entries.push({ row: rowNumber, name, email });
  }

  return { entries, problems, duplicates, headerSkipped, truncated };
}

/** Read a roster from a pasted block of text. */
export function readPastedRoster(text: string): RosterReading {
  const rows = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => splitRow(line));
  return readRoster(rows);
}

/**
 * One line summarising what was read, for the admin to check before sending.
 *
 * Written to be read out loud: fifty invitations is a lot of real people, and
 * "48 people ready to invite" is a sentence somebody can sanity-check against
 * the sheet in front of them in a way a set of counters is not.
 */
export function describeReading(reading: RosterReading): string {
  const n = reading.entries.length;
  const parts = [`${n} ${n === 1 ? "person" : "people"} ready to invite`];

  if (reading.duplicates.length > 0) {
    parts.push(`${reading.duplicates.length} repeated ${reading.duplicates.length === 1 ? "address" : "addresses"} skipped`);
  }
  if (reading.problems.length > 0) {
    parts.push(`${reading.problems.length} ${reading.problems.length === 1 ? "row" : "rows"} could not be read`);
  }
  if (reading.truncated) {
    parts.push(`only the first ${MAX_ROSTER_ROWS} were taken`);
  }

  return `${parts.join(", ")}.`;
}
