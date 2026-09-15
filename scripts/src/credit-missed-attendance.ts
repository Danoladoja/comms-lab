/**
 * Credit attendance the app failed to measure.
 *
 * For weeks the heartbeat never started for anybody who opened the classroom
 * before their class began — which is almost everybody, because that is what a
 * start time is for. Those learners sat through whole classes and the app
 * recorded nothing, then told them to attend again and held the next week shut
 * behind them.
 *
 * This credits every learner the app recorded as having opened the room for a
 * class that has already finished. It writes a waiver, not a pile of invented
 * seconds: the record says the attendance could not be measured and why, rather
 * than claiming a number nobody observed.
 *
 * Only classes that have already ended, and only rows that are not already
 * credited, so running it twice changes nothing the second time.
 *
 *   pnpm --filter @workspace/scripts run credit:attendance          # show me
 *   pnpm --filter @workspace/scripts run credit:attendance --write  # do it
 */
import { db, attendanceTable, sessionsTable, usersTable } from "@workspace/db";
import { and, eq, isNull, lt, sql } from "drizzle-orm";

const REASON =
  "Credited automatically: the classroom heartbeat did not start for classes "
  + "opened before they began, so attendance went unmeasured. The learner opened the room.";

async function main() {
  const write = process.argv.includes("--write");

  // A class has ended when its start plus its scheduled length is in the past.
  const ended = sql`${sessionsTable.startsAt} + make_interval(mins => ${sessionsTable.durationMins}) < now()`;

  const rows = await db
    .select({
      attendanceId: attendanceTable.id,
      learner: usersTable.name,
      session: sessionsTable.title,
      startsAt: sessionsTable.startsAt,
      liveSeconds: attendanceTable.liveSeconds,
    })
    .from(attendanceTable)
    .innerJoin(sessionsTable, eq(sessionsTable.id, attendanceTable.sessionId))
    .innerJoin(usersTable, eq(usersTable.id, attendanceTable.userId))
    .where(and(
      isNull(attendanceTable.presenceWaivedAt),
      sql`${sessionsTable.startsAt} is not null`,
      ended,
    ));

  if (rows.length === 0) {
    console.log("Nothing to credit — every finished class with a join is already settled.");
    return;
  }

  console.log(`${rows.length} attendance record${rows.length === 1 ? "" : "s"} to credit:\n`);
  for (const r of rows) {
    const when = r.startsAt ? new Date(r.startsAt).toISOString().slice(0, 10) : "unscheduled";
    console.log(`  ${when}  ${r.learner} — ${r.session} (${r.liveSeconds}s measured)`);
  }

  if (!write) {
    console.log("\nNothing written. Re-run with --write to apply.");
    return;
  }

  const now = new Date();
  let done = 0;
  for (const r of rows) {
    await db
      .update(attendanceTable)
      .set({ presenceWaivedAt: now, presenceWaivedReason: REASON })
      .where(and(
        eq(attendanceTable.id, r.attendanceId),
        // Pinned, so a beat landing mid-run cannot be clobbered.
        isNull(attendanceTable.presenceWaivedAt),
      ));
    done += 1;
  }

  console.log(`\nCredited ${done}. Their progress recalculates on the next page load.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
