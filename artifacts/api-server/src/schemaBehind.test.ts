import { describe, expect, it, vi } from "vitest";

/**
 * What the app says when the database is behind the code.
 *
 * Schema changes are applied by hand after a deploy, so there is always a
 * window where the running code writes to a column that does not exist yet.
 * That reached an admin as "Something went wrong. Please try again" — advice
 * wrong in every particular. Trying again cannot help, nothing they did caused
 * it, and the fix is one command in a console they were not looking at. It has
 * cost an afternoon twice.
 */

// The app module builds a database pool at import time. Nothing here reaches a
// query — this is about what the handler says — so a connection string that
// goes nowhere is enough to let the module load.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgresql://nobody@127.0.0.1:1/none";
});

import { schemaBehindCode } from "./app";

/** A Postgres failure in the shape node-postgres actually delivers it. */
const pg = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

/** The same thing after Drizzle has wrapped it. */
const wrapped = (code: string, message: string) =>
  Object.assign(new Error("Failed query"), { cause: pg(code, message) });

describe("a database that has not caught up", () => {
  it("recognises a missing column and names the command that fixes it", () => {
    const said = schemaBehindCode(
      pg("42703", 'column "recording_duration_seconds" of relation "sessions" does not exist'),
    );

    expect(said).toBeTruthy();
    expect(said).toMatch(/database has not caught up/i);
    // Postgres names the column, and that is what makes the fix obvious.
    expect(said).toContain("recording_duration_seconds");
    // `migrate`, and emphatically not `push --force`, which this asserted until
    // the day a cohort's dashboards went down and this message was what an
    // alarmed admin would have followed. `push --force` exists to make the
    // database match the code by any means available to it, including dropping
    // columns and tables. Handed to somebody who has just been told learners'
    // work has vanished, it is the one command that could make that true.
    expect(said).toContain("run migrate");
    expect(said).not.toMatch(/--force/);
    // And it says the two things an admin would otherwise assume were true.
    expect(said).toMatch(/nothing you did/i);
    expect(said).toMatch(/will not help/i);
  });

  it("recognises a missing table as well", () => {
    expect(schemaBehindCode(pg("42P01", 'relation "late_passes" does not exist')))
      .toContain("late_passes");
  });

  it("finds it when the driver has wrapped it", () => {
    // Drizzle reports "Failed query" and hangs the real error off `cause`,
    // which is how it arrives in production.
    expect(schemaBehindCode(wrapped("42703", 'column "started_at" of relation "enrollments" does not exist')))
      .toContain("started_at");
  });

  it("says nothing about any other failure", () => {
    // The flat 500 exists so an internal fault is not an invitation to go
    // looking. Only this one class is named, because only this one is fixable
    // by the person reading it.
    expect(schemaBehindCode(new Error("something else entirely"))).toBeNull();
    expect(schemaBehindCode(pg("23505", "duplicate key value violates unique constraint"))).toBeNull();
    expect(schemaBehindCode(pg("42P02", "there is no parameter $1"))).toBeNull();
    expect(schemaBehindCode(null)).toBeNull();
    expect(schemaBehindCode(undefined)).toBeNull();
    expect(schemaBehindCode("a string")).toBeNull();
  });
});
