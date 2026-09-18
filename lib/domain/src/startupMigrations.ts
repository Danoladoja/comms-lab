/**
 * Whether the app should bring its own database up to date when it starts.
 *
 * ## Why this exists
 *
 * Migrations in this project have always been run by hand. That was a
 * deliberate caution — "a migration that fails at boot takes the whole app down
 * with it, and there is a cohort teaching" — and it was the wrong call, proved
 * twice in a fortnight.
 *
 * The first time, a patch added a table, nobody ran the migration, and
 * `progressForUser` threw for every learner on the programme. Their dashboards
 * failed and forty-five people were told their completed quizzes and submitted
 * work had been wiped. Nothing had been deleted; the app was simply asking for
 * a table that did not exist.
 *
 * The second time, a patch added a column and the boot guard — added in
 * response to the first — did its job and refused to start. Correct, and still
 * a crash loop, because the guard's advice was to open a console inside the app
 * it had just stopped.
 *
 * Both failures are the same shape: the code moved and the database did not,
 * because moving the database was a separate errand performed by a person who
 * had been told, in passing, that it was needed. The fix is for the two to
 * travel together. Applying migrations at startup is not a convenience; it is
 * what makes the deploy one thing instead of two.
 *
 * ## Why the guard stays
 *
 * It becomes a backstop rather than a locked door. If migration is skipped, or
 * fails, or somebody restores an older database, the guard still catches it
 * before a single learner sees a broken page. What changes is that in the
 * ordinary case there is nothing left for it to catch.
 */

/**
 * A number, agreed once, that two containers starting at the same moment both
 * ask Postgres for. Whoever gets it migrates; the other waits and then finds
 * nothing to do. Without it, two copies of the app can run the same migration
 * simultaneously, and the loser fails on a table that now exists.
 *
 * Arbitrary, but it must never collide with another advisory lock in this
 * codebase — the role-change lock takes 981431.
 */
export const MIGRATION_LOCK_KEY = 774213;

/**
 * How long to wait for the other container to finish before giving up on the
 * lock. Long enough for a real migration, short enough that a stuck lock does
 * not hold a deploy open for ever.
 */
export const MIGRATION_LOCK_WAIT_MS = 60_000;

/**
 * Should this boot apply migrations?
 *
 * The escape hatch matters more than it looks. If a migration is wedged — bad
 * SQL, a constraint that cannot be satisfied by the data already there — the
 * app would otherwise fail at the same line on every restart, and the person
 * fixing it needs a way to get the app running while they work. Setting
 * SKIP_STARTUP_MIGRATIONS=1 on the host does that, and the boot guard still
 * refuses to serve a database that is genuinely behind, so skipping cannot
 * quietly put a broken schema in front of a cohort.
 */
export function shouldRunMigrations(env: Record<string, string | undefined>): boolean {
  const skip = (env["SKIP_STARTUP_MIGRATIONS"] ?? "").trim().toLowerCase();
  return !(skip === "1" || skip === "true" || skip === "yes");
}

export type MigrationOutcome =
  | { kind: "applied"; count: number }
  | { kind: "nothing-to-do" }
  | { kind: "skipped" }
  | { kind: "busy" }
  /**
   * The build does not carry the migration files at all.
   *
   * Its own outcome rather than a silent skip, because it is a defect in how
   * the app was packaged, not a decision anybody made — and disguised as
   * anything else it would be invisible until the next migration mattered.
   */
  | { kind: "no-migrations-found"; folder: string }
  | { kind: "failed"; error: string };

/**
 * What a person reading the deploy log should see.
 *
 * Deploy logs are read in a hurry, usually because something is wrong, so each
 * of these says what happened and — where it matters — what happens next.
 */
export function migrationOutcomeMessage(outcome: MigrationOutcome): string {
  switch (outcome.kind) {
    case "applied":
      return outcome.count === 1
        ? "Applied 1 database migration before starting."
        : `Applied ${outcome.count} database migrations before starting.`;

    case "nothing-to-do":
      return "The database was already up to date.";

    case "skipped":
      return "Skipping migrations because SKIP_STARTUP_MIGRATIONS is set. "
        + "The app will still refuse to start if the database is behind the code.";

    case "no-migrations-found":
      return `No migration files were found at ${outcome.folder}, so none could be applied. `
        + "This build did not carry them, which is a packaging fault rather than a choice. "
        + "The schema check below will say whether the database is behind because of it.";

    case "busy":
      return "Another copy of the app is migrating the database, and this one waited long enough. "
        + "Carrying on to the schema check, which will refuse to start if the work did not finish.";

    case "failed":
      // The most important sentence in this file. A migration runs inside a
      // transaction, so a failure leaves nothing half-applied — and somebody
      // reading a red deploy log at speed needs to know that before they start
      // trying to repair a database that does not need repairing.
      return "A database migration failed, and nothing half-finished was left behind: each migration "
        + "runs inside a transaction, so a failure rolls back. The database is as it was. "
        + `Fix the migration, commit, and deploy again.\n\n${outcome.error}`;
  }
}

/** Whether this outcome should stop the app from starting on its own. */
export function shouldStopBooting(outcome: MigrationOutcome): boolean {
  // Only an outright failure. "busy" and "skipped" both hand the decision to
  // the schema guard, which knows whether the database is actually behind —
  // and is a better judge of that than this function, which only knows whether
  // migrating happened.
  return outcome.kind === "failed";
}
