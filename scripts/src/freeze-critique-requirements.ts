/**
 * Freeze what each learner was actually asked for, onto the work they filed.
 *
 * `reviews_required_at_submission` exists so that changing a module's critique
 * requirement cannot reach back and un-finish work already done. But it is only
 * filled in on work filed since the column existed. Everything older has null,
 * and null means "look it up from the module" — live, every time progress is
 * calculated.
 *
 * So those learners' requirement is whatever the module happens to say today.
 * An edit to the task — even one that changed nothing about the work — could
 * move it, turn everyone who had done what was asked back into "not finished",
 * and shut the following module behind them. That is exactly what happened.
 *
 * This writes today's number onto the old rows, so from here they follow the
 * record rather than the setting. Run it once the modules say what they should
 * say — check that first with:
 *
 *   pnpm --filter @workspace/scripts run why:locked
 *
 * Then:
 *
 *   pnpm --filter @workspace/scripts run freeze:critiques          # show me
 *   pnpm --filter @workspace/scripts run freeze:critiques --write  # do it
 *
 * Only rows with nothing recorded are touched, so running it twice changes
 * nothing the second time, and a number already frozen is never overwritten.
 */
import {
  db,
  assignmentsTable,
  assignmentSubmissionsTable,
  sessionsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

async function main() {
  const write = process.argv.includes("--write");

  const rows = await db
    .select({
      id: assignmentSubmissionsTable.id,
      learner: usersTable.name,
      email: usersTable.email,
      module: sessionsTable.title,
      startsAt: sessionsTable.startsAt,
      reviewsRequired: assignmentsTable.reviewsRequired,
    })
    .from(assignmentSubmissionsTable)
    .innerJoin(usersTable, eq(usersTable.id, assignmentSubmissionsTable.userId))
    .innerJoin(sessionsTable, eq(sessionsTable.id, assignmentSubmissionsTable.sessionId))
    .innerJoin(assignmentsTable, eq(assignmentsTable.sessionId, assignmentSubmissionsTable.sessionId))
    .where(isNull(assignmentSubmissionsTable.reviewsRequiredAtSubmission))
    .orderBy(asc(sessionsTable.startsAt), asc(usersTable.name));

  if (rows.length === 0) {
    console.log("Nothing to freeze — every submission already records what it was asked for.");
    console.log("So a module that un-finishes itself is not this. Run why:locked to see what it is.");
    return;
  }

  // Grouped by module, because the number is a property of the module and that
  // is the thing worth checking before writing it down for good.
  const byModule = new Map<string, { count: number; asks: number }>();
  for (const r of rows) {
    const key = `${r.startsAt ? r.startsAt.toISOString().slice(0, 10) : "no date"}  ${r.module}`;
    const seen = byModule.get(key) ?? { count: 0, asks: r.reviewsRequired };
    byModule.set(key, { count: seen.count + 1, asks: r.reviewsRequired });
  }

  console.log(`${rows.length} submission${rows.length === 1 ? "" : "s"} have no record of what they were asked for.\n`);
  console.log("These are the numbers that would be written down. Check each one is");
  console.log("what that module actually asked of its learners at the time:\n");
  for (const [module, { count, asks }] of byModule) {
    console.log(`  ${module}`);
    console.log(`    ${count} submission${count === 1 ? "" : "s"} → ${asks} critique${asks === 1 ? "" : "s"} each`);
  }

  if (!write) {
    console.log("\nNothing was changed. To write these numbers down:");
    console.log("  pnpm --filter @workspace/scripts run freeze:critiques --write");
    console.log("\nIf any number above is wrong, fix it first in the module's task editor");
    console.log("(Slides & coursework → Task → \"Critiques each learner owes\"), then run this again.");
    return;
  }

  const updated = await db
    .update(assignmentSubmissionsTable)
    .set({
      reviewsRequiredAtSubmission: sql`(
        select ${assignmentsTable.reviewsRequired} from ${assignmentsTable}
        where ${assignmentsTable.sessionId} = ${assignmentSubmissionsTable.sessionId}
      )`,
    })
    .where(and(
      isNull(assignmentSubmissionsTable.reviewsRequiredAtSubmission),
      sql`exists (
        select 1 from ${assignmentsTable}
        where ${assignmentsTable.sessionId} = ${assignmentSubmissionsTable.sessionId}
      )`,
    ))
    .returning({ id: assignmentSubmissionsTable.id });

  console.log(`\nWritten. ${updated.length} submission${updated.length === 1 ? "" : "s"} now carry the number they were asked for.`);
  console.log("Changing a module's requirement from here cannot reach back and un-finish them.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Could not freeze the requirements:", err);
    process.exit(1);
  });
