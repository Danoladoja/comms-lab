/**
 * Credit a whole class's attendance, when the app never saw it happen.
 *
 * `credit:attendance` fixes a different problem: it credits learners the app
 * recorded as opening the room but failed to measure. It works from the rows
 * that exist — so for a class where nobody has a row at all, it credits nobody.
 *
 * That case is real. A cohort that joins Meet from the calendar invite rather
 * than through the classroom leaves no trace here, and the app then holds the
 * following week shut behind a class those people sat through.
 *
 * This writes a waiver — "attendance could not be measured" — rather than a
 * pile of invented seconds. It cannot tell who was actually in the room, and it
 * does not pretend to: read what it prints before running it with --write.
 *
 *   pnpm --filter @workspace/scripts run credit:class -- 12
 *   pnpm --filter @workspace/scripts run credit:class -- 12 --write
 *   pnpm --filter @workspace/scripts run credit:class -- 12 --write --measured-only
 *
 * Before reaching for this, check what why:locked says about the class. If the
 * best attendance anybody managed is under the bar, the class probably ran
 * shorter than its scheduled length — and correcting the module's duration is
 * the honest fix, because it raises everybody's real percentage at once instead
 * of papering over a measurement that was right all along.
 *
 * Rows already credited are left alone, so running it twice changes nothing.
 */
import {
  db,
  attendanceTable,
  sessionsTable,
  enrollmentsTable,
  usersTable,
} from "@workspace/db";
import { and, asc, eq, isNull, sql } from "drizzle-orm";

const REASON =
  "Credited by hand: the app has no usable measurement for this class. "
  + "Attendance was not observed, so this records that rather than a number.";

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const measuredOnly = args.includes("--measured-only");
  const sessionId = Number(args.find((a) => !a.startsWith("--")));

  if (!Number.isInteger(sessionId)) {
    console.error("Which module? Pass its id:");
    console.error("  pnpm --filter @workspace/scripts run credit:class -- 12");
    console.error("\nThe ids are in the address bar when you open a module in the console.");
    process.exit(1);
  }

  const [session] = await db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      programId: sessionsTable.programId,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      recordingSeconds: sessionsTable.recordingDurationSeconds,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));

  if (!session) {
    console.error(`No module with id ${sessionId}.`);
    process.exit(1);
  }
  if (!session.startsAt) {
    console.error(`"${session.title}" has no date, so there is no class to have attended.`);
    process.exit(1);
  }

  const learners = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      liveSeconds: attendanceTable.liveSeconds,
      waivedAt: attendanceTable.presenceWaivedAt,
    })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
    .leftJoin(attendanceTable, and(
      eq(attendanceTable.userId, enrollmentsTable.userId),
      eq(attendanceTable.sessionId, sessionId),
    ))
    .where(and(
      eq(enrollmentsTable.programId, session.programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ))
    .orderBy(asc(usersTable.name));

  const already = learners.filter((l) => l.waivedAt !== null);
  const candidates = learners.filter((l) => l.waivedAt === null
    && (!measuredOnly || (l.liveSeconds ?? 0) > 0));

  const rec = session.recordingSeconds ? Math.round(session.recordingSeconds / 60) : null;
  console.log(`\n${session.title}`);
  console.log(`  ${session.startsAt.toISOString().slice(0, 16).replace("T", " ")} · scheduled ${session.durationMins} min`
    + (rec === null ? "" : ` · recording ${rec} min`));
  console.log(`  ${learners.length} enrolled · ${already.length} already credited\n`);

  if (rec !== null && rec < session.durationMins * 0.9) {
    console.log(`  Note: the recording is ${rec} min against ${session.durationMins} scheduled.`);
    console.log("  If the class simply ran short, correcting the module's length is the");
    console.log("  better fix — it raises everyone's real percentage instead of waiving it.\n");
  }

  if (candidates.length === 0) {
    console.log("Nobody left to credit here.");
    return;
  }

  console.log(measuredOnly
    ? `${candidates.length} learner${candidates.length === 1 ? "" : "s"} the app measured but did not credit:\n`
    : `${candidates.length} learner${candidates.length === 1 ? "" : "s"} would be credited — including anyone who was not there:\n`);
  for (const l of candidates) {
    const seen = (l.liveSeconds ?? 0) > 0 ? `${Math.round((l.liveSeconds ?? 0) / 60)} min measured` : "nothing measured";
    console.log(`  ${l.name || l.email}  (${seen})`);
  }

  if (!write) {
    console.log("\nNothing was changed. To credit them:");
    console.log(`  pnpm --filter @workspace/scripts run credit:class -- ${sessionId} --write`);
    console.log("\nOr, to credit only the ones the app saw something for:");
    console.log(`  pnpm --filter @workspace/scripts run credit:class -- ${sessionId} --write --measured-only`);
    return;
  }

  const now = new Date();
  for (const l of candidates) {
    await db
      .insert(attendanceTable)
      .values({
        userId: l.id,
        sessionId,
        joinedAt: session.startsAt,
        presenceWaivedAt: now,
        presenceWaivedReason: REASON,
      })
      .onConflictDoUpdate({
        target: [attendanceTable.userId, attendanceTable.sessionId],
        set: { presenceWaivedAt: now, presenceWaivedReason: REASON },
        setWhere: isNull(attendanceTable.presenceWaivedAt),
      });
  }

  console.log(`\nCredited ${candidates.length}. Their attendance for this class now reads`);
  console.log("\"could not be measured\" rather than \"did not attend\".");
  console.log("\nCheck what it opened with:");
  console.log("  pnpm --filter @workspace/scripts run why:locked");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Could not credit this class:", err);
    process.exit(1);
  });
