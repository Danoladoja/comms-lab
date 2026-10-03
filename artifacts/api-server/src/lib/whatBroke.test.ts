import { describe, expect, it } from "vitest";
import { whatBroke } from "./whatBroke";

/**
 * What a crash is allowed to say.
 *
 * Two rules, and the second one is the one with teeth. It has to be specific
 * enough to act on — "a required value was missing (23502)" sends somebody to a
 * column, where "something went wrong" sends them nowhere. And it must never
 * carry the error's message, because Drizzle hangs the failing query off it and
 * a query on this platform can contain a learner's coursework, an email address
 * or an invitation token.
 */

const pgError = (code: string) =>
  Object.assign(new Error("insert into \"programs\" values ($1) — paulineungaji@gmail.com"), { code });

describe("naming a crash", () => {
  it("names the rule Postgres refused on, and its code", () => {
    expect(whatBroke(pgError("23502"))).toContain("a required value was missing");
    expect(whatBroke(pgError("23502"))).toContain("23502");
    expect(whatBroke(pgError("22001"))).toContain("too long");
  });

  it("finds the code when Drizzle has wrapped the real error", () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: pgError("23503") });
    expect(whatBroke(wrapped)).toContain("23503");
  });

  it("still names a Postgres code it has no words for", () => {
    expect(whatBroke(pgError("XX999"))).toContain("XX999");
    expect(whatBroke(pgError("XX999"))).toContain("the database refused it");
  });

  it("never repeats the error's message", () => {
    // The thing this exists to prevent. The message above carries a real
    // address and a table full of values; none of it may reach a screen.
    for (const err of [pgError("23502"), new TypeError("Cannot read properties of null (reading 'trim')")]) {
      expect(whatBroke(err)).not.toContain("paulineungaji");
      expect(whatBroke(err)).not.toContain("programs");
      expect(whatBroke(err)).not.toContain("trim");
    }
  });

  it("names the kind of fault when it is the Lab's own code", () => {
    expect(whatBroke(new TypeError("x"))).toContain("TypeError");
    expect(whatBroke(new RangeError("x"))).toContain("RangeError");
  });

  it("tells a connection failure apart from a database refusal", () => {
    expect(whatBroke(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toContain("ECONNREFUSED");
    expect(whatBroke(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).not.toContain("database refused");
  });

  it("says something rather than nothing for a thrown object with no shape", () => {
    expect(whatBroke({})).toBeTruthy();
    expect(whatBroke(null)).toBeTruthy();
    expect(whatBroke("a string nobody should throw")).toBeTruthy();
  });
});
