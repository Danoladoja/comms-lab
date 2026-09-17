import { describe, expect, it } from "vitest";
import { startupVerdict, schemaBehindMessage } from "./schemaGap";

describe("starting when the database matches", () => {
  it("does not stand in the way", () => {
    const v = startupVerdict({ missingTables: [], missingColumns: [] });
    expect(v.refuseToStart).toBe(false);
  });

  it("copes with the lists being absent entirely", () => {
    // A guard that throws while checking whether it is safe to start would take
    // the site down for the one reason it exists to prevent.
    expect(startupVerdict({} as never).refuseToStart).toBe(false);
  });
});

describe("refusing to start when the database is behind", () => {
  it("stops, names the table, and names the command", () => {
    // The whole point. On the day this was written, `deadline_extensions` was
    // missing, the app started anyway, and forty-five learners met an error
    // where their completed work should have been.
    const v = startupVerdict({ missingTables: ["deadline_extensions"], missingColumns: [] });
    expect(v.refuseToStart).toBe(true);
    expect(v.message).toMatch(/NOT STARTING/);
    expect(v.message).toContain("deadline_extensions");
    expect(v.message).toContain("pnpm --filter @workspace/db run migrate");
  });

  it("says plainly that the fix cannot destroy anything", () => {
    // Read by somebody whose cohort is already complaining. "Run this" without
    // "it is safe" is how a frightened person does nothing instead.
    const v = startupVerdict({ missingTables: ["x"], missingColumns: [] });
    expect(v.message).toMatch(/does not delete or alter existing data/i);
  });

  it("refuses for a missing column too", () => {
    const v = startupVerdict({ missingTables: [], missingColumns: ["session_attendance.live_source"] });
    expect(v.refuseToStart).toBe(true);
    expect(v.message).toContain("session_attendance.live_source");
  });

  it("does not list the columns of a table that is missing altogether", () => {
    // The table explains all of them. Nine lines of "deadline_extensions.reason"
    // underneath would bury the one fact worth reading.
    const v = startupVerdict({
      missingTables: ["deadline_extensions"],
      missingColumns: [],
    });
    expect(v.message).not.toMatch(/deadline_extensions\./);
  });

  it("caps a wall of columns so the instruction is still visible", () => {
    // A first deploy against an empty database has hundreds. Printing them all
    // pushes the one line somebody needs off the top of the log.
    const many = Array.from({ length: 300 }, (_, i) => `t.c${i}`);
    const v = startupVerdict({ missingTables: [], missingColumns: many });
    expect(v.message).toContain("…and 280 more");
    expect(v.message).toContain("pnpm --filter @workspace/db run migrate");
    expect(v.message.split("\n").length).toBeLessThan(45);
  });
});

describe("what a person in a browser is told", () => {
  it("passes Postgres's own words through, because they name the thing", () => {
    const said = schemaBehindMessage('relation "deadline_extensions" does not exist');
    expect(said).toContain("deadline_extensions");
    expect(said).toMatch(/not caught up/i);
    expect(said).toMatch(/nothing you did caused this/i);
  });

  it("never sends anybody to a command that can destroy data", () => {
    // It used to say `push --force`, whose purpose is to make the database
    // match the code by any means — including dropping columns and tables.
    // Handed to somebody panicking about lost work, that is how lost work
    // becomes real.
    const said = schemaBehindMessage("anything");
    expect(said).not.toMatch(/push/);
    expect(said).not.toMatch(/--force/);
    expect(said).toContain("run migrate");
  });

  it("still reads properly when Postgres said nothing useful", () => {
    for (const nothing of [null, undefined, "   "]) {
      const said = schemaBehindMessage(nothing);
      expect(said).toMatch(/^The app has been updated but the database has not caught up yet\./);
      expect(said).toContain("run migrate");
    }
  });
});
