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
  programsTable,
} from "@workspace/db";
import { and, asc, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";

const REASON =
  "Credited by hand: the app has no usable measurement for this class. "
  + "Attendance was not observed, so this records that rather than a number.";

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const measuredOnly = args.includes("--measured-only");
  const untilArg = args.find((a) => a.startsWith("--until="));

  // Two ways in. By date is the one to reach for: "every class up to here was
  // ours to get wrong, so stop holding it against anybody", which is a sentence
  // about the teaching rather than about module ids nobody knows by heart.
  if (untilArg) {
    await creditUpTo(args.filter((a) => !a.startsWith("--")).join(" ").trim(), untilArg.slice(8), write, measuredOnly);
    return;
  }

  const sessionId = Number(args.find((a) => !a.startsWith("--")));

  if (!Number.isInteger(sessionId)) {
    console.error("Either one module by id, or every class up to a date:");
    console.error("  pnpm --filter @workspace/scripts run credit:class -- 12");
    console.error('  pnpm --filter @workspace/scripts run credit:class -- "AfriEnergy" --until=2026-09-20');
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

  await creditOne(sessionId, measuredOnly);

  console.log(`\nCredited ${candidates.length}. Their attendance for this class now reads`);
  console.log("\"could not be measured\" rather than \"did not attend\".");
  console.log("\nCheck what it opened with:");
  console.log("  pnpm --filter @workspace/scripts run why:locked");
}

/**
 * Write the waiver for one class, and say how many rows it touched.
 *
 * Rows that already carry a waiver are left exactly as they are, so running
 * this twice changes nothing the second time and a hand-written reason from
 * last week is never overwritten by this one.
 */
async function creditOne(sessionId: number, measuredOnly: boolean): Promise<number> {
  const [session] = await db
    .select({ programId: sessionsTable.programId, startsAt: sessionsTable.startsAt })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  if (!session) return 0;

  const learners = await db
    .select({
      id: usersTable.id,
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
    ));

  const candidates = learners.filter((l) => l.waivedAt === null
    && (!measuredOnly || (l.liveSeconds ?? 0) > 0));

  const now = new Date();
  for (const l of candidates) {
    await db
      .insert(attendanceTable)
      .values({
        userId: l.id,
        sessionId,
        joinedAt: session.startsAt ?? now,
        presenceWaivedAt: now,
        presenceWaivedReason: REASON,
      })
      .onConflictDoUpdate({
        target: [attendanceTable.userId, attendanceTable.sessionId],
        set: { presenceWaivedAt: now, presenceWaivedReason: REASON },
        setWhere: isNull(attendanceTable.presenceWaivedAt),
      });
  }
  return candidates.length;
}

/**
 * Credit every scheduled class in a programme up to and including a date.
 *
 * For the weeks where the fault was the Lab's — a join link that 404'd, so the
 * cohort used the calendar invite and the app saw nothing. There is no
 * measurement to rescue and no way to tell who was in the room, so this says
 * "not measured" for all of them and stops holding it against anybody.
 */
async function creditUpTo(wanted: string, until: string, write: boolean, measuredOnly: boolean) {
  const cutoff = new Date(`${until}T23:59:59.999Z`);
  if (!Number.isFinite(cutoff.getTime())) {
    console.error(`"${until}" is not a date I can read. Use --until=2026-09-20`);
    process.exit(1);
  }

  const programmes = await db
    .select({ id: programsTable.id, title: programsTable.title })
    .from(programsTable);
  const matched = programmes.filter((p) => p.title.toLowerCase().includes(wanted.toLowerCase()));
  if (matched.length !== 1) {
    console.error(matched.length === 0
      ? `No programme matches "${wanted}".`
      : `"${wanted}" matches more than one programme.`);
    for (const p of programmes) console.error(`  ${p.title}`);
    process.exit(1);
  }

  const classes = await db
    .select({ id: sessionsTable.id, title: sessionsTable.title, startsAt: sessionsTable.startsAt })
    .from(sessionsTable)
    .where(and(
      eq(sessionsTable.programId, matched[0].id),
      isNotNull(sessionsTable.startsAt),
      lte(sessionsTable.startsAt, cutoff),
    ))
    .orderBy(asc(sessionsTable.startsAt));

  if (classes.length === 0) {
    console.log(`No scheduled classes in "${matched[0].title}" on or before ${until}.`);
    return;
  }

  console.log(`\n${matched[0].title}`);
  console.log(`  ${classes.length} class${classes.length === 1 ? "" : "es"} on or before ${until}:\n`);
  for (const c of classes) {
    console.log(`  ${c.startsAt?.toISOString().slice(0, 10)}  ${c.title}`);
  }
  console.log("\nEverybody enrolled will be credited for these, whether or not the app");
  console.log("measured them. Attendance from the class after these is unaffected.\n");

  if (!write) {
    console.log("Nothing was changed. To do it:");
    console.log(`  pnpm --filter @workspace/scripts run credit:class -- "${wanted}" --until=${until} --write`);
    return;
  }

  let total = 0;
  for (const c of classes) {
    total += await creditOne(c.id, measuredOnly);
  }
  console.log(`Credited ${total} attendance record${total === 1 ? "" : "s"} across ${classes.length} classes.`);
  console.log("\nSee what that opened:");
  console.log("  pnpm --filter @workspace/scripts run why:locked");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Could not credit this class:", err);
    process.exit(1);
  });
