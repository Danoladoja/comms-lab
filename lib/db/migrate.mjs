/**
 * Apply every migration the database has not seen, and record what was done.
 *
 * This replaces `drizzle-kit push`, which worked out the difference against the
 * live database at the moment it ran, asked questions in the middle, and left
 * no record. Two afternoons were lost to a push that stopped at a prompt,
 * applied nothing, and looked afterwards exactly like one that had finished.
 *
 * A migration is a file. It is written once, reviewed like any other change,
 * committed, and applied in order. Running it twice does nothing the second
 * time, because the database keeps a list of what it has already run.
 *
 *   pnpm --filter @workspace/db run migrate
 *
 * Deliberately not wired into the app's startup yet. A migration that fails at
 * boot takes the whole app down with it, and there is a cohort teaching. Once
 * this has been through a few deploys uneventfully it can move into the deploy
 * itself, which is where it belongs.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set, so there is no database to migrate.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  console.log("Applying any migrations this database has not seen…\n");

  try {
    await migrate(db, { migrationsFolder: path.join(here, "migrations") });
    console.log("Done. The database is level with the code.");
    console.log("\nCheck what it actually has with:");
    console.log("  pnpm --filter @workspace/scripts run check:schema");
  } catch (err) {
    console.error("\nThe migration stopped, and nothing half-finished was left behind —");
    console.error("each migration runs inside a transaction, so a failure rolls back.\n");
    console.error(err instanceof Error ? err.message : String(err));
    console.error("\nThe database is unchanged. Fix the migration, commit, and run again.");
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
