/**
 * Give every existing assignment the default critique rubric.
 *
 * Assignments created before peer critique existed have an empty rubric, which
 * would mean "submitted = done" forever. This backfills the default rubric and
 * the standard two-review requirement so existing modules join the new loop.
 *
 *   pnpm --filter @workspace/scripts run seed:rubrics
 *
 * Idempotent: assignments that already carry a rubric are left alone.
 */
import { db, assignmentsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { DEFAULT_RUBRIC, DEFAULT_REVIEWS_REQUIRED } from "@workspace/domain";

async function main(): Promise<void> {
  const rows = await db
    .select({ id: assignmentsTable.id, title: assignmentsTable.title })
    .from(assignmentsTable)
    .where(sql`jsonb_array_length(coalesce(${assignmentsTable.rubric}, '[]'::jsonb)) = 0`);

  for (const row of rows) {
    await db
      .update(assignmentsTable)
      .set({ rubric: DEFAULT_RUBRIC, reviewsRequired: DEFAULT_REVIEWS_REQUIRED })
      .where(eq(assignmentsTable.id, row.id));
    console.log(`· ${row.title}`);
  }

  console.log(`done — ${rows.length} assignment${rows.length === 1 ? "" : "s"} updated`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
