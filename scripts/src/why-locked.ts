/**
 * Why is this learner locked out of the next module?
 *
 * A locked module is always the same sentence — "finish the previous module" —
 * and the previous module is always, from the learner's side, finished. Working
 * out which of the four requirements the app disagrees about has twice meant
 * reading code and guessing, while a cohort waited.
 *
 * This asks the database instead. It prints, for every learner on a programme,
 * each module that is not complete and exactly which requirement is unmet — in
 * the same words the app would use, using the same presence rules the app uses.
 *
 *   pnpm --filter @workspace/scripts run why:locked                # every programme
 *   pnpm --filter @workspace/scripts run why:locked -- "Reporting" # one, by name
 *
 * It only reads. It changes nothing, and is safe to run at any time, including
 * during a class.
 */
import {
  db,
  programsTable,
  sessionsTable,
  enrollmentsTable,
  usersTable,
  attendanceTable,
  replayProgressTable,
  quizQuestionsTable,
  quizAttemptsTable,
  assignmentsTable,
  assignmentSubmissionsTable,
  submissionReviewsTable,
} from "@workspace/db";
import {
  presenceStatus,
  replayWatchedSeconds,
  EMPTY_PRESENCE,
  QUIZ_PASS_MARK,
} from "@workspace/domain";
import { and, asc, eq, sql } from "drizzle-orm";

const day = (d: Date | null) =>
  d ? d.toISOString().slice(0, 10) : "no date";

async function main() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ").trim();

  const programmes = await db
    .select({ id: programsTable.id, title: programsTable.title, progression: programsTable.progression })
    .from(programsTable)
    .orderBy(asc(programsTable.id));

  const chosen = wanted
    ? programmes.filter((p) => p.title.toLowerCase().includes(wanted.toLowerCase()))
    : programmes;

  if (chosen.length === 0) {
    console.log(wanted ? `No programme matches "${wanted}".` : "No programmes.");
    console.log("\nProgrammes:");
    for (const p of programmes) console.log(`  ${p.title}`);
    return;
  }

  for (const programme of chosen) {
    const sessions = await db
      .select({
        id: sessionsTable.id,
        title: sessionsTable.title,
        startsAt: sessionsTable.startsAt,
        durationMins: sessionsTable.durationMins,
        recordingSeconds: sessionsTable.recordingDurationSeconds,
        quizDraft: sessionsTable.quizDraft,
      })
      .from(sessionsTable)
      .where(eq(sessionsTable.programId, programme.id))
      .orderBy(asc(sessionsTable.startsAt), asc(sessionsTable.id));

    const learners = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        startedAt: enrollmentsTable.startedAt,
        createdAt: enrollmentsTable.createdAt,
      })
      .from(enrollmentsTable)
      .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
      .where(and(
        eq(enrollmentsTable.programId, programme.id),
        sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
      ))
      .orderBy(asc(usersTable.name));

    console.log(`\n${"=".repeat(70)}`);
    console.log(`${programme.title}   (${programme.progression} by ${programme.progression})`);
    console.log(`${sessions.length} modules · ${learners.length} learners`);
    console.log("=".repeat(70));

    if (sessions.length === 0 || learners.length === 0) continue;

    const ids = sessions.map((s) => s.id);
    const inSessions = sql`${sessionsTable.id} in ${ids}`;
    void inSessions;

    // What each module currently asks for. Drafts are excluded exactly as the
    // app excludes them: an unposted piece asks nothing of anybody.
    const [quizzes, tasks] = await Promise.all([
      db
        .selectDistinct({ sessionId: quizQuestionsTable.sessionId })
        .from(quizQuestionsTable)
        .innerJoin(sessionsTable, eq(sessionsTable.id, quizQuestionsTable.sessionId))
        .where(eq(sessionsTable.quizDraft, false)),
      db
        .select({
          sessionId: assignmentsTable.sessionId,
          reviewsRequired: assignmentsTable.reviewsRequired,
          dueAt: assignmentsTable.dueAt,
        })
        .from(assignmentsTable)
        .where(eq(assignmentsTable.draft, false)),
    ]);

    const hasQuiz = new Set(quizzes.map((q) => q.sessionId));
    const taskBySession = new Map(tasks.map((t) => [t.sessionId, t]));

    for (const session of sessions) {
      if (!ids.includes(session.id)) continue;
      const task = taskBySession.get(session.id);
      const asksQuiz = hasQuiz.has(session.id);

      const [attendance, replays, attempts, submissions, reviews, peers] = await Promise.all([
        db.select().from(attendanceTable).where(eq(attendanceTable.sessionId, session.id)),
        db.select().from(replayProgressTable).where(eq(replayProgressTable.sessionId, session.id)),
        db
          .select({ userId: quizAttemptsTable.userId, best: sql<number>`max(${quizAttemptsTable.scorePct})::int` })
          .from(quizAttemptsTable)
          .where(eq(quizAttemptsTable.sessionId, session.id))
          .groupBy(quizAttemptsTable.userId),
        db
          .select({
            userId: assignmentSubmissionsTable.userId,
            askedAtSubmission: assignmentSubmissionsTable.reviewsRequiredAtSubmission,
          })
          .from(assignmentSubmissionsTable)
          .where(eq(assignmentSubmissionsTable.sessionId, session.id)),
        db
          .select({ reviewerId: submissionReviewsTable.reviewerId, count: sql<number>`count(*)::int` })
          .from(submissionReviewsTable)
          .where(eq(submissionReviewsTable.sessionId, session.id))
          .groupBy(submissionReviewsTable.reviewerId),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(assignmentSubmissionsTable)
          .where(eq(assignmentSubmissionsTable.sessionId, session.id)),
      ]);

      const joinedBy = new Map(attendance.map((a) => [a.userId, a]));
      const replayBy = new Map(replays.map((r) => [r.userId, r]));
      const bestBy = new Map(attempts.map((a) => [a.userId, a.best]));
      const submittedBy = new Map(submissions.map((s) => [s.userId, s]));
      const givenBy = new Map(reviews.map((r) => [r.reviewerId, r.count]));
      const filedCount = peers[0]?.count ?? 0;

      const unfinished: string[] = [];
      /** How many learners the app measured at all, and the best anyone managed. */
      let measured = 0;
      let bestLivePct = 0;

      for (const learner of learners) {
        const enrolledAt = (learner.startedAt ?? learner.createdAt)?.getTime() ?? 0;
        const start = session.startsAt?.getTime() ?? null;
        const end = start !== null ? start + session.durationMins * 60 * 1000 : null;
        // A module that ran before somebody's first day counts as done for them.
        if (end !== null && end < enrolledAt) continue;

        const why: string[] = [];

        if (start !== null) {
          const joined = joinedBy.get(learner.id);
          const replay = replayBy.get(learner.id);
          const presence = presenceStatus({
            ...EMPTY_PRESENCE,
            waived: !!joined?.presenceWaivedAt,
            liveSeconds: joined?.liveSeconds ?? 0,
            replayWatchedSeconds: replay ? replayWatchedSeconds(replay.buckets, replay.durationSeconds) : 0,
            replayDurationSeconds: replay?.durationSeconds ?? null,
            sessionSeconds: session.durationMins * 60,
          });
          if (joined || replay) {
            measured += 1;
            bestLivePct = Math.max(bestLivePct, presence.livePct);
          }
          if (!presence.met) {
            // Minutes, not a share of anything. The first version of this
            // printed `share`, which is progress *towards the bar* — so a
            // learner who sat through 59% of a class read as "99%" and looked
            // like someone the app was wrongly refusing. It sent me looking in
            // the wrong place, and it would have sent anyone else there too.
            const mins = Math.round((joined?.liveSeconds ?? 0) / 60);
            why.push(
              !joined && !replay
                ? "no record of opening the class or the replay"
                : `${mins} of the class's ${session.durationMins} scheduled minutes measured (${presence.livePct}%)`
                  + `, replay ${presence.replayPct}% — needs ${presence.liveThresholdPct}% live or ${presence.replayThresholdPct}% of the replay`,
            );
          }
        }

        if (task) {
          const mine = submittedBy.get(learner.id);
          if (!mine) {
            why.push("written task not filed");
          } else {
            // The number they were actually asked for when they filed. Where
            // that was never recorded the app falls back to what the module
            // asks *now* — which is how an edit to a task can un-finish work
            // that was finished.
            const askedNow = Math.min(task.reviewsRequired, Math.max(0, filedCount - 1));
            const frozen = mine.askedAtSubmission;
            const asked = frozen ?? askedNow;
            const given = givenBy.get(learner.id) ?? 0;
            if (given < asked) {
              const note = frozen === null
                ? `  <-- not recorded at the time, so this follows the module's CURRENT setting of ${task.reviewsRequired}`
                : "";
              why.push(`${given} of ${asked} critiques written${note}`);
            }
          }
        }

        if (asksQuiz) {
          const best = bestBy.get(learner.id) ?? null;
          if ((best ?? 0) < QUIZ_PASS_MARK) {
            why.push(best === null ? "quiz not attempted" : `quiz best ${best}% — needs ${QUIZ_PASS_MARK}%`);
          }
        }

        if (why.length > 0) {
          unfinished.push(`    ${learner.name || learner.email}\n${why.map((w) => `      · ${w}`).join("\n")}`);
        }
      }

      const asks = [
        session.startsAt ? "attendance" : null,
        task ? `task + ${task.reviewsRequired} critique${task.reviewsRequired === 1 ? "" : "s"}` : null,
        asksQuiz ? "quiz" : null,
      ].filter(Boolean).join(", ") || "nothing";

      console.log(`\n  ${session.title}   (${day(session.startsAt)})`);
      console.log(`  asks for: ${asks}`);

      if (session.startsAt) {
        const rec = session.recordingSeconds ? Math.round(session.recordingSeconds / 60) : null;
        console.log(
          `  attendance measured for ${measured} of ${learners.length}`
          + ` · scheduled ${session.durationMins} min`
          + (rec === null ? " · no recording length known" : ` · recording ${rec} min`),
        );
        // A bar nobody in the room could clear is not a cohort that did not
        // turn up. Presence is measured against the *scheduled* length, so a
        // class that ran short makes 60% unreachable for everyone in it.
        // Not said once everybody has been credited by hand: the measurement is
        // still poor, but nobody is standing behind it, and a warning nobody
        // needs to act on is a warning that teaches people to skip warnings.
        if (measured > 0 && bestLivePct < 60 && unfinished.length > 0) {
          console.log(`  !! the best attendance anybody managed here is ${bestLivePct}% — nobody cleared the 60% bar.`);
          console.log("     A class that ran shorter than its scheduled length does exactly this,");
          console.log("     because presence is measured against the scheduled minutes.");
          if (rec !== null && rec < session.durationMins) {
            console.log(`     The recording is ${rec} min against ${session.durationMins} scheduled, which fits.`);
          }
        }
        if (measured === 0) {
          console.log("  !! nobody has any attendance record for this class at all.");
          console.log("     If it ran and people were in it, the app did not see them —");
          console.log("     joining Meet directly from a calendar invite leaves no trace here.");
        }
      }

      if (unfinished.length === 0) {
        console.log("  everyone has finished this one.");
        continue;
      }
      console.log(`  ${unfinished.length} of ${learners.length} have not finished it, so the module after it is shut for them:\n`);
      console.log(unfinished.join("\n"));
    }
  }

  console.log("\nNothing here was changed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Could not read the progress data:", err);
    process.exit(1);
  });
