/**
 * What has been applied to this database, and what is waiting.
 *
 * Reads only. It is the question you want answered before a migration and
 * after one, and the question nobody could answer during the two afternoons
 * that prompted all of this — when a schema push had silently stalled and
 * every outward sign said it had run.
 *
 *   pnpm --filter @workspace/db run migrate:status
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.join(here, "migrations");

function onDisk() {
  const journal = JSON.parse(
    readFileSync(path.join(MIGRATIONS, "meta", "_journal.json"), "utf8"),
  );
  return journal.entries
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((e) => ({ tag: e.tag, when: e.when }));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set, so there is no database to ask.");
    process.exit(1);
  }

  const files = onDisk();
  const pool = new Pool({ connectionString: url });

  let applied = [];
  try {
    const { rows } = await pool.query(
      `select hash, created_at from drizzle.__drizzle_migrations order by created_at`,
    );
    applied = rows;
  } catch {
    // The table only exists once a migration has been run. Before that, every
    // migration is pending — which is exactly right for a database that was
    // built by hand-run pushes and has never seen one.
    applied = [];
  } finally {
    await pool.end();
  }

  console.log(`${files.length} migration${files.length === 1 ? "" : "s"} on disk, `
    + `${applied.length} recorded as applied.\n`);

  files.forEach((f, i) => {
    const done = i < applied.length;
    const when = done && applied[i]
      ? new Date(Number(applied[i].created_at)).toISOString().slice(0, 16).replace("T", " ")
      : "";
    console.log(`  ${done ? "applied " : "PENDING "} ${f.tag}${when ? `   ${when}` : ""}`);
  });

  const pending = files.length - applied.length;
  if (pending > 0) {
    console.log(`\n${pending} waiting. Apply with:`);
    console.log("  pnpm --filter @workspace/db run migrate");
  } else {
    console.log("\nNothing waiting — the database is level with the code.");
  }

  if (applied.length > files.length) {
    console.log("\nThe database has recorded more migrations than exist here.");
    console.log("That usually means it is ahead of this checkout: pull, then look again.");
  }
}

main().catch((err) => {
  console.error("Could not read the migration state:", err);
  process.exit(1);
});
