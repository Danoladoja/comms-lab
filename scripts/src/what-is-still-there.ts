/**
 * Is the work actually gone, or merely not being shown?
 *
 * Those are completely different emergencies and they look identical from a
 * learner's screen. This counts what is physically in the database — every
 * submission, every quiz attempt, every critique, with dates — and prints it
 * next to each learner. It reads and nothing else: no updates, no inserts, no
 * deletes anywhere in this file.
 *
 * If the counts are there, nothing has been lost and the problem is in what the
 * app is displaying, which is repairable in minutes. If the counts are zero,
 * the data is genuinely missing and the next step is Railway's backups, not
 * more code.
 *
 *   pnpm --filter @workspace/scripts run what:remains
 */
import {
  db,
  usersTable,
  programsTable,
  sessionsTable,
  enrollmentsTable,
  assignmentSubmissionsTable,
  quizAttemptsTable,
  submissionReviewsTable,
  attendanceTable,
  pool,
} from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";

function line(s = ""): void {
  console.log(s);
}

async function main(): Promise<void> {
  line("What is actually in the database right now");
  line("==========================================");
  line(`Read at ${new Date().toISOString()}`);
  line();

  // The totals first. If these are zero, nothing below matters and the answer
  // is a restore rather than a fix.
  const [totals] = await db
    .select({
      users: sql<number>`(select count(*)::int from ${usersTable})`,
      programmes: sql<number>`(select count(*)::int from ${programsTable})`,
      modules: sql<number>`(select count(*)::int from ${sessionsTable})`,
      enrolments: sql<number>`(select count(*)::int from ${enrollmentsTable})`,
      submissions: sql<number>`(select count(*)::int from ${assignmentSubmissionsTable})`,
      quizAttempts: sql<number>`(select count(*)::int from ${quizAttemptsTable})`,
      critiques: sql<number>`(select count(*)::int from ${submissionReviewsTable})`,
      attendance: sql<number>`(select count(*)::int from ${attendanceTable})`,
    })
    .from(sql`(select 1) as one`);

  line("TOTALS");
  line(`  accounts .................. ${totals.users}`);
  line(`  programmes ................ ${totals.programmes}`);
  line(`  modules ................... ${totals.modules}`);
  line(`  enrolments ................ ${totals.enrolments}`);
  line(`  written tasks submitted ... ${totals.submissions}`);
  line(`  quiz attempts ............. ${totals.quizAttempts}`);
  line(`  critiques written ......... ${totals.critiques}`);
  line(`  attendance rows ........... ${totals.attendance}`);
  line();

  if (totals.submissions === 0 && totals.quizAttempts === 0) {
    line("*** No submitted work of any kind is present. ***");
    line("Nothing in the app deletes this, so the database itself is not the one the cohort");
    line("was using. Check in Railway whether the database was replaced or re-provisioned,");
    line("and restore from a backup taken before today. Do not let the app write to it in");
    line("the meantime.");
    line();
  }

  // The oldest and newest piece of work. A gap that stops abruptly is a very
  // different story from an empty table.
  const [span] = await db
    .select({
      earliest: sql<string | null>`min(${assignmentSubmissionsTable.submittedAt})::text`,
      latest: sql<string | null>`max(${assignmentSubmissionsTable.submittedAt})::text`,
    })
    .from(assignmentSubmissionsTable);
  line(`Written work spans: ${span.earliest ?? "—"}  →  ${span.latest ?? "—"}`);
  line();

  // Per learner, per programme. The `startedAt` column is printed because it is
  // the one field today's changes write, and the one that decides which modules
  // a learner is held to — so if anything looks wrong, it will look wrong here.
  const rows = await db
    .select({
      userId: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      programme: programsTable.title,
      status: enrollmentsTable.status,
      createdAt: enrollmentsTable.createdAt,
      startedAt: enrollmentsTable.startedAt,
      submissions: sql<number>`(
        select count(*)::int from ${assignmentSubmissionsTable}
        where ${assignmentSubmissionsTable.userId} = ${usersTable.id}
      )`,
      attempts: sql<number>`(
        select count(*)::int from ${quizAttemptsTable}
        where ${quizAttemptsTable.userId} = ${usersTable.id}
      )`,
      critiques: sql<number>`(
        select count(*)::int from ${submissionReviewsTable}
        where ${submissionReviewsTable.reviewerId} = ${usersTable.id}
      )`,
    })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
    .innerJoin(programsTable, eq(programsTable.id, enrollmentsTable.programId))
    .orderBy(asc(usersTable.name));

  line("EACH LEARNER — work counted straight from the tables");
  line();
  line("  tasks  quiz  crit   counts from        who");
  line("  -----  ----  ----   ----------------   ---");

  // The first dated class, to judge whether a start date is sane.
  const [firstClass] = await db
    .select({ startsAt: sessionsTable.startsAt })
    .from(sessionsTable)
    .where(sql`${sessionsTable.startsAt} is not null`)
    .orderBy(asc(sessionsTable.startsAt))
    .limit(1);
  const firstClassMs = firstClass?.startsAt?.getTime() ?? null;

  const suspicious: string[] = [];

  for (const r of rows) {
    const countsFrom = r.startedAt ?? r.createdAt;
    const day = countsFrom.toISOString().slice(0, 10);
    const pad = (n: number, w: number) => String(n).padStart(w);
    line(`  ${pad(r.submissions, 5)}  ${pad(r.attempts, 4)}  ${pad(r.critiques, 4)}   ${day}         ${r.name || r.email} · ${r.programme} · ${r.status}`);

    // A start date after the first class means earlier modules are treated as
    // "before they joined" — shown as complete, and their prerequisites waived.
    // That is correct for a genuine late arrival and wrong for everybody else.
    if (firstClassMs !== null && countsFrom.getTime() > firstClassMs && r.submissions + r.attempts > 0) {
      suspicious.push(
        `  ${r.name || r.email} — counts from ${day}, which is after the first class, `
        + `but has ${r.submissions} task(s) and ${r.attempts} attempt(s) on record`,
      );
    }
  }

  line();
  if (suspicious.length > 0) {
    line("LEARNERS WHOSE START DATE LOOKS WRONG");
    line("Their work is all still here — the count above proves it — but the app treats");
    line("modules that ended before this date as already done, which is why a dashboard can");
    line("look emptied out. Say the word and I will send a one-command fix that sets these");
    line("back to the start of the cohort. Nothing needs restoring.");
    line();
    for (const s of suspicious) line(s);
  } else {
    line("No learner has a start date later than the first class.");
    line("So nothing today has changed which modules anybody is held to.");
  }
  line();
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
