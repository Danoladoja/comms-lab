/**
 * Does the database have everything the running code expects?
 *
 * Schema changes are applied by hand with `db run push`, and a deploy that
 * lands before that command runs leaves the app writing to columns that do not
 * exist. What the admin then sees is "Could not save module" — a sentence that
 * points at the form, at the link they just pasted, at anything but the real
 * cause. This turns that guess into an answer in about two seconds.
 *
 *   pnpm --filter @workspace/scripts run check:schema
 *
 * It only reads. It changes nothing, and is safe to run at any time, including
 * while a class is going on.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Everything added since the last time the schema was known to be settled.
 *
 * Kept as a plain list rather than derived from the Drizzle schema on purpose:
 * this has to be able to disagree with the code, because disagreeing with the
 * code is the entire thing it is for.
 */
const EXPECTED: { table: string; column: string; why: string }[] = [
  { table: "sessions", column: "recording_duration_seconds", why: "saving a module" },
  { table: "session_attendance", column: "presence_waived_at", why: "crediting attendance" },
  { table: "session_attendance", column: "presence_waived_reason", why: "crediting attendance" },
  { table: "assignment_submissions", column: "late", why: "filing written work" },
  { table: "assignment_submissions", column: "ai_use", why: "filing written work" },
  { table: "assignment_submissions", column: "ai_note", why: "filing written work" },
  { table: "assignment_submissions", column: "reviews_required_at_submission", why: "filing written work" },
  { table: "assignment_submissions", column: "withdrawn_at", why: "the cohort room" },
  { table: "enrollments", column: "started_at", why: "progress for late joiners" },
  { table: "cohort_messages", column: "intended_count", why: "writing to a cohort" },
  { table: "cohort_messages", column: "finished_at", why: "writing to a cohort" },
];

const EXPECTED_TABLES: { table: string; why: string }[] = [
  { table: "late_passes", why: "late passes" },
  { table: "submission_comments", why: "the cohort room" },
];

async function main() {
  const [{ rows: tableRows }, { rows: columnRows }] = await Promise.all([
    db.execute(sql`
      select table_name from information_schema.tables where table_schema = 'public'
    `) as unknown as Promise<{ rows: { table_name: string }[] }>,
    db.execute(sql`
      select table_name, column_name from information_schema.columns where table_schema = 'public'
    `) as unknown as Promise<{ rows: { table_name: string; column_name: string }[] }>,
  ]);

  const tables = new Set(tableRows.map((r) => r.table_name));
  const columns = new Set(columnRows.map((r) => `${r.table_name}.${r.column_name}`));

  const missingTables = EXPECTED_TABLES.filter((t) => !tables.has(t.table));
  const missingColumns = EXPECTED.filter((c) => !columns.has(`${c.table}.${c.column}`));

  if (missingTables.length === 0 && missingColumns.length === 0) {
    console.log("The database has everything the app expects.\n");
    console.log("So a save that is still failing is not this. Check the server");
    console.log("log for the actual error — Deployments → the live one → View Logs.");
    return;
  }

  console.log("The database is behind the code. This is what is missing:\n");
  for (const t of missingTables) {
    console.log(`  table   ${t.table}   — needed for ${t.why}`);
  }
  for (const c of missingColumns) {
    console.log(`  column  ${c.table}.${c.column}   — needed for ${c.why}`);
  }
  console.log("\nFix it by running, in this same console:");
  console.log("  pnpm --filter @workspace/db run push --force");
  console.log("\nThen run this check again. If anything is still listed, the push");
  console.log("did not finish — read what it printed rather than trusting it ran.");
  process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    console.error("Could not read the database schema:", err);
    process.exit(1);
  });
