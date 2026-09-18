import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { existsSync } from "node:fs";
import {
  MIGRATION_LOCK_KEY,
  MIGRATION_LOCK_WAIT_MS,
  type MigrationOutcome,
} from "@workspace/domain";
import { db, pool } from "@workspace/db";

/**
 * Bring the database up to the code, at startup, before anything serves.
 *
 * The same work `pnpm --filter @workspace/db run migrate` does by hand, run by
 * the app itself so that deploying is one action rather than two.
 *
 * It lives with the server rather than in @workspace/db because it is a fact
 * about how this app starts, not a property of the database package — and
 * because keeping it here leaves lib/db with no dependency on lib/domain. See the note
 * in @workspace/domain/startupMigrations for why that distinction has already
 * cost this cohort two incidents.
 *
 * Three things make this safe to do automatically:
 *
 *   - every migration runs inside a transaction, so a failure leaves nothing
 *     half-applied;
 *   - an advisory lock means two containers starting together cannot run the
 *     same migration twice;
 *   - the schema guard still runs afterwards, so a skipped or failed migration
 *     is caught before a learner sees a broken page.
 */
export async function applyPendingMigrations(folder: string): Promise<MigrationOutcome> {
  if (!existsSync(folder)) {
    // Said out loud rather than skipped quietly. It is a packaging fault, and
    // the only moment it is cheap to notice is the deploy where it appears —
    // not the later one where a migration finally matters.
    return { kind: "no-migrations-found", folder };
  }

  // A dedicated connection, so the session-level lock belongs to this work and
  // is released with it. Taking it on a pooled connection would leave the lock
  // attached to whichever request happened to borrow that connection next.
  const client = await pool.connect();
  let before = 0;
  try {
    // Wait for another container rather than failing instantly, but not for
    // ever. `lock_timeout` makes Postgres give up on our behalf, which is the
    // only way to bound a blocking advisory lock.
    await client.query(`set lock_timeout = ${MIGRATION_LOCK_WAIT_MS}`);
    try {
      await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    } catch {
      // Somebody else is migrating and is taking their time. Let the schema
      // guard decide whether the result is good enough to serve.
      return { kind: "busy" };
    }

    // Counted inside the lock, not before it.
    //
    // Two containers starting together both read zero, both waited, and both
    // then reported "applied 4" — one of which had applied nothing. Nothing
    // broke, but a deploy log that claims work it did not do is a log nobody
    // can reason from later.
    before = await appliedCount();

    try {
      await migrate(db, { migrationsFolder: folder });
    } catch (err) {
      return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    }
  } finally {
    client.release();
  }

  const after = await appliedCount();
  const applied = Math.max(0, after - before);
  return applied === 0 ? { kind: "nothing-to-do" } : { kind: "applied", count: applied };
}

/**
 * How many migrations this database has recorded.
 *
 * Counted either side of the run so the log can say what was actually done.
 * Drizzle's migrator returns nothing, and "applied migrations" with no number
 * is the sort of line that gets read as "it worked" on a deploy where it did
 * not.
 *
 * Zero on a database that has never been migrated: the journal table does not
 * exist yet, and asking for it must not look like a failure.
 */
async function appliedCount(): Promise<number> {
  try {
    const result = await db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    const rows = result.rows as { n: number }[];
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}
