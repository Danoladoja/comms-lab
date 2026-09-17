/**
 * Set how long a programme's classes actually run.
 *
 * Attendance is a share of a class's *scheduled* length. So when the Lab moved
 * from ninety-minute classes to sixty-minute ones and the modules went on
 * saying ninety, nobody changed a threshold — the denominator moved underneath
 * everybody. A learner who sat through every minute of an hour was recorded at
 * 67%, and the ones who joined a few minutes late landed at 57-59% and were
 * failed for missing nothing.
 *
 * It is worse at a 70% bar: 70% of ninety minutes is sixty-three, which is
 * longer than the class. Nobody in the room can clear it, however well they
 * attend, and the app has no way to know that is what it is doing.
 *
 * Every module can be edited by hand in the console — this exists because eight
 * of them at a time, correctly, under pressure, is how a nine gets typed as a
 * ninety.
 *
 *   pnpm --filter @workspace/scripts run set:length -- "AfriEnergy" 60
 *   pnpm --filter @workspace/scripts run set:length -- "AfriEnergy" 60 --write
 *
 * Classes that already say the right thing are left alone, so running it twice
 * changes nothing the second time. It never touches a module's date.
 */
import { db, programsTable, sessionsTable } from "@workspace/db";
import { and, asc, eq, ne } from "drizzle-orm";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const write = process.argv.includes("--write");
  const minutes = Number(args[args.length - 1]);
  const wanted = args.slice(0, -1).join(" ").trim();

  if (!wanted || !Number.isInteger(minutes) || minutes < 5 || minutes > 600) {
    console.error("Which programme, and how many minutes does a class run?");
    console.error('  pnpm --filter @workspace/scripts run set:length -- "AfriEnergy" 60');
    process.exit(1);
  }

  const programmes = await db
    .select({ id: programsTable.id, title: programsTable.title })
    .from(programsTable)
    .orderBy(asc(programsTable.id));

  const matched = programmes.filter((p) => p.title.toLowerCase().includes(wanted.toLowerCase()));
  if (matched.length === 0) {
    console.error(`No programme matches "${wanted}". There are:`);
    for (const p of programmes) console.error(`  ${p.title}`);
    process.exit(1);
  }
  if (matched.length > 1) {
    console.error(`"${wanted}" matches more than one programme. Be more specific:`);
    for (const p of matched) console.error(`  ${p.title}`);
    process.exit(1);
  }

  const programme = matched[0];
  const sessions = await db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      recordingSeconds: sessionsTable.recordingDurationSeconds,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.programId, programme.id))
    .orderBy(asc(sessionsTable.startsAt), asc(sessionsTable.id));

  const changing = sessions.filter((s) => s.durationMins !== minutes);

  console.log(`\n${programme.title}`);
  console.log(`  ${sessions.length} modules · setting each class to ${minutes} minutes\n`);

  for (const s of sessions) {
    const when = s.startsAt ? s.startsAt.toISOString().slice(0, 10) : "no date";
    const rec = s.recordingSeconds ? `${Math.round(s.recordingSeconds / 60)} min recording` : "no recording yet";
    const move = s.durationMins === minutes
      ? "already right"
      : `${s.durationMins} -> ${minutes}`;
    console.log(`  ${when}  ${s.title}`);
    console.log(`      ${move}   (${rec})`);
  }

  if (changing.length === 0) {
    console.log("\nNothing to change.");
    return;
  }

  // The recording is the only independent record of how long a class ran, so
  // it is worth a second look before the number is taken as read.
  const disagrees = changing.filter((s) => {
    if (!s.recordingSeconds) return false;
    const recMins = s.recordingSeconds / 60;
    return recMins < minutes * 0.8 || recMins > minutes * 1.25;
  });
  if (disagrees.length > 0) {
    console.log(`\n  Worth checking — these recordings are not close to ${minutes} minutes:`);
    for (const s of disagrees) {
      console.log(`    ${s.title}: recording ${Math.round((s.recordingSeconds ?? 0) / 60)} min`);
    }
    console.log("  A recording can be trimmed or cut short, so this is a question, not an error.");
  }

  if (!write) {
    console.log(`\nNothing was changed. ${changing.length} module${changing.length === 1 ? "" : "s"} would move:`);
    console.log(`  pnpm --filter @workspace/scripts run set:length -- "${wanted}" ${minutes} --write`);
    console.log("\nThen check what it opens:");
    console.log("  pnpm --filter @workspace/scripts run why:locked");
    return;
  }

  const updated = await db
    .update(sessionsTable)
    .set({ durationMins: minutes })
    .where(and(eq(sessionsTable.programId, programme.id), ne(sessionsTable.durationMins, minutes)))
    .returning({ id: sessionsTable.id });

  console.log(`\nDone. ${updated.length} module${updated.length === 1 ? "" : "s"} now say ${minutes} minutes.`);
  console.log("Everybody's attendance percentage moves with it — nothing was credited or waived,");
  console.log("the same minutes are simply being measured against the right length.");
  console.log("\nSee what that opened:");
  console.log("  pnpm --filter @workspace/scripts run why:locked");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Could not set the class length:", err);
    process.exit(1);
  });
