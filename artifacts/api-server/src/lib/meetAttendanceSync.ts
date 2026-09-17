/**
 * Filling in attendance from Google's own record of the room.
 *
 * The app's heartbeat only counts while the Lab's classroom page is open. When
 * the join link failed and a cohort used the calendar invite instead, the app
 * saw nothing for three weeks and then held each following week shut behind the
 * classes those people had sat through. No threshold could have fixed that: the
 * measurement was simply not being taken.
 *
 * This takes it from Google instead, which does not care whether anybody opened
 * the app. It reads only — nothing here changes anything in Google — and it
 * never lowers a number: a learner already credited with more stays credited.
 */
import {
  db,
  attendanceTable,
  sessionsTable,
  enrollmentsTable,
  usersTable,
} from "@workspace/db";
import {
  meetCodeFrom,
  secondsByEmail,
  reportWindow,
  reconcileSeconds,
} from "@workspace/domain";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { getAccessToken, getConnection, hasReportsScope } from "./google/oauth";
import { fetchCallEvents } from "./google/meetReports";
import { logger } from "./logger";

export type SyncOutcome = {
  sessionId: number;
  title: string;
  /** What happened, in a sentence somebody can act on. */
  note: string;
  /** People Google saw in the room. */
  seen: number;
  /** Of those, matched to a learner enrolled on this programme. */
  matched: number;
  /** Of those, whose recorded attendance actually went up. */
  written: number;
  /** Emails Google reported that belong to nobody on this programme. */
  unmatched: string[];
};

/**
 * Attendance for one class, from Google.
 *
 * `dryRun` does everything except the write, because the first question about a
 * tool that touches a live cohort's records is "what would it do", and that
 * question deserves an answer that costs nothing.
 */
export async function syncAttendanceForSession(
  sessionId: number,
  opts: { dryRun?: boolean } = {},
): Promise<SyncOutcome | { error: string }> {
  const [session] = await db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      programId: sessionsTable.programId,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      meetUrl: sessionsTable.meetUrl,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));

  if (!session) return { error: `No module with id ${sessionId}.` };
  if (!session.startsAt) return { error: `"${session.title}" has no date, so there was no class.` };

  const meetCode = meetCodeFrom(session.meetUrl);
  if (!meetCode) {
    return {
      error: `"${session.title}" has no Google Meet link saved, so there is no room to ask about. `
        + "Add the meeting link to the module first.",
    };
  }

  const connection = await getConnection();
  if (!connection) return { error: "Google is not connected. Connect it in the admin console." };
  if (!hasReportsScope(connection.scopes)) {
    return {
      error: "The Google connection predates attendance reading and has not been granted the "
        + "reports permission. Reconnect Google in the admin console — it is the same button, "
        + "and the consent screen will now ask for one extra permission.",
    };
  }

  const accessToken = await getAccessToken();
  if (!accessToken) return { error: "Could not refresh the Google connection. Reconnect it in the admin console." };

  const window = reportWindow(session.startsAt.getTime(), session.durationMins);
  const report = await fetchCallEvents({ accessToken, startMs: window.startMs, endMs: window.endMs });
  if (!report.ok) return { error: report.error };

  const totals = secondsByEmail(report.events, meetCode, window);

  // Everybody on the programme, with whatever the app already has for them.
  // Matched on lower-cased email because that is the only thing Google and the
  // Lab both hold — and the Lab's own index on users is already lower-cased.
  const learners = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      liveSeconds: attendanceTable.liveSeconds,
      hasRow: attendanceTable.id,
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

  const byEmail = new Map(learners.map((l) => [l.email.trim().toLowerCase(), l]));
  const matchedEmails = new Set<string>();
  let written = 0;

  for (const [email, seconds] of totals) {
    const learner = byEmail.get(email);
    if (!learner) continue;
    matchedEmails.add(email);

    const next = reconcileSeconds(learner.liveSeconds ?? 0, seconds);
    // Nothing to do when the app already has as much or more. Writing anyway
    // would restamp the source on a number Google did not produce.
    if (next <= (learner.liveSeconds ?? 0) && learner.hasRow !== null) continue;
    written += 1;
    if (opts.dryRun) continue;

    await db
      .insert(attendanceTable)
      .values({
        userId: learner.id,
        sessionId,
        joinedAt: session.startsAt,
        liveSeconds: next,
        liveSource: "google",
      })
      .onConflictDoUpdate({
        target: [attendanceTable.userId, attendanceTable.sessionId],
        set: { liveSeconds: next, liveSource: "google" },
      });
  }

  const unmatched = [...totals.keys()].filter((e) => !matchedEmails.has(e)).sort();

  if (!opts.dryRun) {
    logger.info(
      { sessionId, seen: totals.size, matched: matchedEmails.size, written },
      "Synced Meet attendance",
    );
  }

  return {
    sessionId,
    title: session.title,
    note: totals.size === 0
      ? "Google has no record of anybody in this room during the class. If it ran, check the "
        + "meeting link saved on the module is the one that was actually used."
      : `${matchedEmails.size} of ${totals.size} people Google saw are on this programme.`,
    seen: totals.size,
    matched: matchedEmails.size,
    written,
    unmatched,
  };
}


/* ------------------------------------------------------------------ *
 * Running it without being asked
 * ------------------------------------------------------------------ */

/** How often to look for classes whose attendance has not been read yet. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

/** Classes that have finished, settled, and still have nothing from Google. */
async function classesToRead(): Promise<number[]> {
  const rows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(and(
      isNotNull(sessionsTable.startsAt),
      isNotNull(sessionsTable.meetUrl),
      // An hour after the class was due to end, because Google's audit trail is
      // not instant and the event is written when somebody *leaves*. Reading
      // too eagerly gets a partial room — and since this never lowers a number,
      // a partial room read once stays partial unless somebody notices.
      sql`${sessionsTable.startsAt} + make_interval(mins => ${sessionsTable.durationMins}) < now() - interval '1 hour'`,
      // Only the last few weeks. Google keeps reports for about six months, but
      // re-reading a term's worth of settled classes every half hour is a lot
      // of requests to learn nothing.
      sql`${sessionsTable.startsAt} > now() - interval '30 days'`,
      // Nothing from Google for this class yet. Once one row says "google" the
      // class has been read, and reading it again would only repeat itself.
      sql`not exists (
        select 1 from ${attendanceTable}
        where ${attendanceTable.sessionId} = ${sessionsTable.id}
          and ${attendanceTable.liveSource} = 'google'
      )`,
    ))
    .orderBy(asc(sessionsTable.startsAt));
  return rows.map((r) => r.id);
}

let running = false;

export async function runMeetAttendanceSync(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const connection = await getConnection();
    // Quiet when there is nothing to work with. This runs every half hour
    // forever, and a log line each time about a feature nobody has switched on
    // is how real warnings get ignored.
    if (!connection || !hasReportsScope(connection.scopes)) return;

    const ids = await classesToRead();
    for (const id of ids) {
      const result = await syncAttendanceForSession(id);
      if ("error" in result) {
        logger.warn({ sessionId: id, error: result.error }, "Meet attendance sync skipped a class");
        // A refused permission will refuse the next one too. Stopping keeps one
        // misconfiguration from becoming forty identical log lines.
        if (result.error.includes("administrator") || result.error.includes("Reconnect")) return;
      }
    }
  } catch (err) {
    logger.error({ err }, "Meet attendance sync pass failed");
  } finally {
    running = false;
  }
}

export function startMeetAttendanceSync(): void {
  setTimeout(() => void runMeetAttendanceSync(), 60_000).unref?.();
  setInterval(() => void runMeetAttendanceSync(), CHECK_EVERY_MS).unref?.();
  logger.info("Meet attendance sync scheduled");
}
