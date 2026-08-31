import { describe, expect, it } from "vitest";
import {
  MAX_ROSTER_ROWS,
  describeReading,
  extractEmail,
  looksLikeHeader,
  readPastedRoster,
  readRoster,
  splitRow,
} from "./roster";

describe("splitRow", () => {
  it("prefers tabs, which is what a spreadsheet puts on the clipboard", () => {
    expect(splitRow("Amina Bello\tamina@example.org")).toEqual(["Amina Bello", "amina@example.org"]);
  });

  it("keeps a comma inside a name when the row is tab-separated", () => {
    // "Bello, Amina" is how a great many registries write a name. Splitting on
    // the comma here would turn one person into two broken half-rows.
    expect(splitRow("Bello, Amina\tamina@example.org")).toEqual(["Bello, Amina", "amina@example.org"]);
  });

  it("falls back to commas when there is no tab", () => {
    expect(splitRow("Amina Bello,amina@example.org")).toEqual(["Amina Bello", "amina@example.org"]);
  });

  it("respects quotes in comma-separated rows", () => {
    expect(splitRow('"Bello, Amina",amina@example.org')).toEqual(["Bello, Amina", "amina@example.org"]);
  });

  it("handles a doubled quote inside a quoted field", () => {
    expect(splitRow('"She said ""hi""",a@b.org')).toEqual(['She said "hi"', "a@b.org"]);
  });
});

describe("extractEmail", () => {
  it.each([
    ["amina@example.org", "amina@example.org"],
    ["  Amina@Example.ORG  ", "amina@example.org"],
    ["Amina Bello <amina@example.org>", "amina@example.org"],
    ["mailto:amina@example.org", "amina@example.org"],
    ["amina@example.org (Comms desk)", "amina@example.org"],
    ["amina@example.org;", "amina@example.org"],
    ["a.b+cohort@sub.example.co.uk", "a.b+cohort@sub.example.co.uk"],
  ])("reads %s", (input, expected) => {
    expect(extractEmail(input)).toBe(expected);
  });

  it.each(["", "   ", "Amina Bello", "not-an-email", "@example.org", "amina@", "amina@nodot"])(
    "returns null for %s",
    (input) => {
      expect(extractEmail(input)).toBeNull();
    },
  );
});

describe("looksLikeHeader", () => {
  it("recognises the usual headings", () => {
    expect(looksLikeHeader(["Name", "Email"])).toBe(true);
    expect(looksLikeHeader(["S/N", "Full Name", "Email Address", "Phone"])).toBe(true);
  });

  it("never treats a row containing an address as a heading", () => {
    // Guards a real person whose row happens to carry a heading-ish word.
    expect(looksLikeHeader(["Email", "email@example.org"])).toBe(false);
    expect(looksLikeHeader(["Name", "name@example.org"])).toBe(false);
  });

  it("is not fooled by an empty row", () => {
    expect(looksLikeHeader(["", "  "])).toBe(false);
  });
});

describe("readRoster", () => {
  it("reads a plain two-column sheet", () => {
    const r = readRoster([
      ["Name", "Email"],
      ["Amina Bello", "amina@example.org"],
      ["Kwame Mensah", "kwame@example.org"],
    ]);
    expect(r.headerSkipped).toBe(true);
    expect(r.entries).toEqual([
      { row: 2, name: "Amina Bello", email: "amina@example.org" },
      { row: 3, name: "Kwame Mensah", email: "kwame@example.org" },
    ]);
    expect(r.problems).toHaveLength(0);
  });

  it("does not care which column the address is in", () => {
    const r = readRoster([
      ["amina@example.org", "Amina Bello"],
      ["kwame@example.org", "Kwame Mensah"],
    ]);
    expect(r.entries.map((e) => e.name)).toEqual(["Amina Bello", "Kwame Mensah"]);
  });

  it("ignores a serial column and the extra columns nobody asked for", () => {
    const r = readRoster([
      ["S/N", "Name", "Email", "Phone", "Organisation"],
      ["1", "Amina Bello", "amina@example.org", "+234 800 000 0000", "Energy Desk"],
    ]);
    expect(r.entries[0]).toMatchObject({ name: "Amina Bello", email: "amina@example.org" });
  });

  it("does not mistake a phone number for a name", () => {
    // A phone number is longer than most names, so any rule that reaches for
    // the biggest cell picks it. This caught exactly that.
    const r = readRoster([["+234 800 000 0000", "amina@example.org", "Amina Bello"]]);
    expect(r.entries[0].name).toBe("Amina Bello");
  });

  it("prefers the cell beside the address over one further away", () => {
    // Sheets are written for people, and people put the name next to the
    // address it belongs to. "Energy Communications Desk" is longer.
    const r = readRoster([["Energy Communications Desk", "Amina Bello", "amina@example.org"]]);
    expect(r.entries[0].name).toBe("Amina Bello");
  });

  it("does not take a second address in the row as the name", () => {
    const r = readRoster([["amina@example.org", "amina.bello@work.example.org", "Amina Bello"]]);
    expect(r.entries[0].name).toBe("Amina Bello");
  });

  it("skips blank spacer rows without complaining", () => {
    const r = readRoster([
      ["Amina Bello", "amina@example.org"],
      ["", ""],
      ["   ", ""],
      ["Kwame Mensah", "kwame@example.org"],
    ]);
    expect(r.entries).toHaveLength(2);
    expect(r.problems).toHaveLength(0);
  });

  it("reports a row with no address rather than dropping it silently", () => {
    // The whole point: a dropped row is an applicant who never hears from us.
    const r = readRoster([
      ["Amina Bello", "amina@example.org"],
      ["Kwame Mensah", "phone only"],
    ]);
    expect(r.entries).toHaveLength(1);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].row).toBe(2);
    expect(r.problems[0].raw).toContain("Kwame Mensah");
    expect(r.problems[0].problem).toMatch(/no email/i);
  });

  it("keeps the first of a repeated address and says where the repeat was", () => {
    const r = readRoster([
      ["Amina Bello", "amina@example.org"],
      ["Kwame Mensah", "kwame@example.org"],
      ["Amina B.", "AMINA@example.org"],
    ]);
    expect(r.entries).toHaveLength(2);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0].row).toBe(3);
    expect(r.duplicates[0].problem).toContain("row 1");
  });

  it("keeps a person whose row has no name", () => {
    const r = readRoster([["", "amina@example.org"]]);
    expect(r.entries).toEqual([{ row: 1, name: "", email: "amina@example.org" }]);
  });

  it("reads a sheet with no header row at all", () => {
    const r = readRoster([["Amina Bello", "amina@example.org"]]);
    expect(r.headerSkipped).toBe(false);
    expect(r.entries).toHaveLength(1);
  });

  it("stops at the row limit and says so", () => {
    const rows = Array.from({ length: MAX_ROSTER_ROWS + 10 }, (_, i) => [`P ${i}`, `p${i}@example.org`]);
    const r = readRoster(rows);
    expect(r.entries).toHaveLength(MAX_ROSTER_ROWS);
    expect(r.truncated).toBe(true);
  });

  it("row numbers point at the sheet the admin is looking at", () => {
    const r = readRoster([
      ["Name", "Email"],
      ["Amina Bello", "amina@example.org"],
      ["broken", "no address"],
    ]);
    expect(r.entries[0].row).toBe(2);
    expect(r.problems[0].row).toBe(3);
  });
});

describe("readPastedRoster", () => {
  it("reads what Excel puts on the clipboard", () => {
    const pasted = "Name\tEmail\r\nAmina Bello\tamina@example.org\r\nKwame Mensah\tkwame@example.org\r\n";
    const r = readPastedRoster(pasted);
    expect(r.entries).toHaveLength(2);
    expect(r.headerSkipped).toBe(true);
  });

  it("reads a plain list of addresses with no names", () => {
    const r = readPastedRoster("amina@example.org\nkwame@example.org");
    expect(r.entries.map((e) => e.email)).toEqual(["amina@example.org", "kwame@example.org"]);
    expect(r.entries.every((e) => e.name === "")).toBe(true);
  });

  it("reads a CSV export", () => {
    const r = readPastedRoster('Name,Email\n"Bello, Amina",amina@example.org');
    expect(r.entries[0]).toMatchObject({ name: "Bello, Amina", email: "amina@example.org" });
  });

  it("copes with an empty paste", () => {
    const r = readPastedRoster("");
    expect(r.entries).toHaveLength(0);
    expect(r.problems).toHaveLength(0);
  });
});

describe("describeReading", () => {
  it("counts people, not rows", () => {
    const r = readPastedRoster("Name\tEmail\nAmina\tamina@example.org");
    expect(describeReading(r)).toBe("1 person ready to invite.");
  });

  it("names every kind of trouble it found", () => {
    const r = readPastedRoster(
      "Name\tEmail\nAmina\tamina@example.org\nAmina again\tamina@example.org\nKwame\tno address",
    );
    const summary = describeReading(r);
    expect(summary).toContain("1 person ready to invite");
    expect(summary).toContain("1 repeated address skipped");
    expect(summary).toContain("1 row could not be read");
  });
});
