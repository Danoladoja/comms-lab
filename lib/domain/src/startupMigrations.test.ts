import { describe, expect, it } from "vitest";
import {
  shouldRunMigrations,
  migrationOutcomeMessage,
  shouldStopBooting,
  MIGRATION_LOCK_KEY,
} from "./startupMigrations";

describe("whether to migrate on this boot", () => {
  it("does, by default — which is the whole point", () => {
    expect(shouldRunMigrations({})).toBe(true);
    expect(shouldRunMigrations({ SKIP_STARTUP_MIGRATIONS: "" })).toBe(true);
  });

  it("takes the escape hatch seriously, in the spellings a person actually types", () => {
    // Somebody sets this at two in the morning with a wedged migration and a
    // cohort due in the morning. "true" not working because the code only
    // checked for "1" is not a failure anybody should discover then.
    for (const value of ["1", "true", "TRUE", "yes", " Yes "]) {
      expect(shouldRunMigrations({ SKIP_STARTUP_MIGRATIONS: value }), value).toBe(false);
    }
  });

  it("does not treat every value as a yes", () => {
    // "false" meaning "skip" would be the opposite of what anybody intends.
    for (const value of ["0", "false", "no", "off"]) {
      expect(shouldRunMigrations({ SKIP_STARTUP_MIGRATIONS: value }), value).toBe(true);
    }
  });
});

describe("what the deploy log says", () => {
  it("counts what it did, and says one as one", () => {
    expect(migrationOutcomeMessage({ kind: "applied", count: 1 }))
      .toBe("Applied 1 database migration before starting.");
    expect(migrationOutcomeMessage({ kind: "applied", count: 3 }))
      .toBe("Applied 3 database migrations before starting.");
  });

  it("says plainly when there was nothing to do", () => {
    expect(migrationOutcomeMessage({ kind: "nothing-to-do" })).toMatch(/already up to date/);
  });

  it("leads a failure with the fact that nothing was half-applied", () => {
    // Read at speed, in red, by somebody whose first instinct will be to go and
    // repair the database by hand. That instinct is the danger, not the failed
    // migration — so the reassurance comes before the error text.
    const message = migrationOutcomeMessage({ kind: "failed", error: "relation already exists" });
    expect(message).toMatch(/nothing half-finished was left behind/);
    expect(message).toMatch(/The database is as it was/);
    expect(message).toMatch(/relation already exists/);
    expect(message.indexOf("nothing half-finished")).toBeLessThan(message.indexOf("relation already exists"));
  });

  it("explains a skip without implying the app is now unguarded", () => {
    const message = migrationOutcomeMessage({ kind: "skipped" });
    expect(message).toMatch(/SKIP_STARTUP_MIGRATIONS/);
    expect(message).toMatch(/still refuse to start if the database is behind/);
  });

  it("explains waiting for another container rather than looking like a failure", () => {
    expect(migrationOutcomeMessage({ kind: "busy" })).toMatch(/Another copy of the app is migrating/);
  });
});

describe("what stops the app starting", () => {
  it("is a failed migration, and only that", () => {
    expect(shouldStopBooting({ kind: "failed", error: "x" })).toBe(true);
  });

  it("is never a skip or a wait — the schema guard decides those", () => {
    // Both of these can be perfectly fine: a skip is deliberate, and a wait
    // usually means the other container did the work. The guard knows whether
    // the database is actually behind; this function only knows whether
    // migrating happened, which is a different question.
    expect(shouldStopBooting({ kind: "skipped" })).toBe(false);
    expect(shouldStopBooting({ kind: "busy" })).toBe(false);
    expect(shouldStopBooting({ kind: "applied", count: 2 })).toBe(false);
    expect(shouldStopBooting({ kind: "nothing-to-do" })).toBe(false);
  });
});

describe("the lock two containers agree on", () => {
  it("is not the one the role change already uses", () => {
    // Sharing an advisory lock key with an unrelated guard means a deploy can
    // block somebody being made an admin, and neither side would ever explain
    // why. Asserted rather than left to a code comment because the collision
    // would be silent.
    expect(MIGRATION_LOCK_KEY).not.toBe(981431);
  });
});
