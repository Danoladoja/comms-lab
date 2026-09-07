import { db, enrollmentsTable, programsTable, sessionsTable, usersTable, sessionRemindersTable } from "@workspace/db";
import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { labLetter } from "@workspace/domain";
import { sendEmail, EmailRejectedError } from "./email";
import { labLogoUrl } from "./enrollmentEmails";
import { logger } from "./logger";

const CHECK_EVERY_MS = 5 * 60 * 1000;
const APP_BASE_PATH = "/afrienergy-comms-lab";

// Two reminders per session: the day before, and shortly before class opens.
// minLeadMs keeps the kinds disjoint: a session under an hour away gets only
// the "1h" reminder, never a misleading "tomorrow" one.
const REMINDER_KINDS = [
  { kind: "24h", windowMs: 24 * 60 * 60 * 1000, minLeadMs: 60 * 60 * 1000, lead: "tomorrow" },
  { kind: "1h", windowMs: 60 * 60 * 1000, minLeadMs: 0, lead: "in the next hour" },
] as const;

/**
 * APP_BASE_URL first, which is what Railway sets and what invitation links
 * already use. The Replit variables below exist only in that workspace, and on
 * Railway neither did — which left every "open my classroom" link in every
 * reminder as a bare path that opens nothing from an inbox. The same bug was
 * found and fixed in the enrolment emails; this copy was missed.
 */
function appUrl(path: string): string {
  const configured = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (configured) return `${configured}${path}`;

  const domain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  return domain ? `https://${domain}${APP_BASE_PATH}${path}` : `${APP_BASE_PATH}${path}`;
}

function whenText(startsAt: Date, durationMins: number): string {
  return `${startsAt.toLocaleString("en-GB", {
    weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  })} (${durationMins} min)`;
}

async function runOnce(): Promise<void> {
  const now = new Date();
  for (const { kind, windowMs, minLeadMs, lead } of REMINDER_KINDS) {
    const horizon = new Date(now.getTime() + windowMs);
    const floor = new Date(now.getTime() + minLeadMs);
    const upcoming = await db
      .select({
        id: sessionsTable.id,
        title: sessionsTable.title,
        startsAt: sessionsTable.startsAt,
        durationMins: sessionsTable.durationMins,
        programId: sessionsTable.programId,
        programTitle: programsTable.title,
      })
      .from(sessionsTable)
      .innerJoin(programsTable, eq(sessionsTable.programId, programsTable.id))
      .where(and(gt(sessionsTable.startsAt, floor), lte(sessionsTable.startsAt, horizon)));
    if (upcoming.length === 0) continue;

    const programIds = [...new Set(upcoming.map((s) => s.programId))];
    const learners = await db
      .select({
        userId: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        programId: enrollmentsTable.programId,
      })
      .from(enrollmentsTable)
      .innerJoin(usersTable, eq(enrollmentsTable.userId, usersTable.id))
      .where(and(inArray(enrollmentsTable.programId, programIds), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));

    for (const session of upcoming) {
      if (!session.startsAt) continue;
      for (const learner of learners.filter((l) => l.programId === session.programId)) {
        // Claim the reminder first so concurrent runs cannot double-send.
        const claimed = await db
          .insert(sessionRemindersTable)
          .values({ userId: learner.userId, sessionId: session.id, kind })
          .onConflictDoNothing()
          .returning();
        if (claimed.length === 0) continue;
        try {
          const { html, text } = labLetter({
            greetingName: learner.name,
            paragraphs: [
              `${session.title}, part of ${session.programTitle}, starts ${lead}.`,
              whenText(session.startsAt, session.durationMins),
              "The classroom opens fifteen minutes before the start. Joining from the classroom checks you in, and attending live is what unlocks the replay afterwards.",
            ],
            action: { label: "Open my classroom", url: appUrl(`/classroom/${session.id}`) },
            logoUrl: labLogoUrl(),
          });
          await sendEmail({
            to: { email: learner.email, name: learner.name || learner.email },
            subject: `Reminder: ${session.title} starts ${lead}`,
            html,
            text,
          });
        } catch (err) {
          // Only release the claim when the provider definitively rejected the
          // send. Ambiguous failures (timeouts, lost responses) may still have
          // delivered, so retrying would risk duplicate emails.
          if (err instanceof EmailRejectedError) {
            await db
              .delete(sessionRemindersTable)
              .where(and(
                eq(sessionRemindersTable.userId, learner.userId),
                eq(sessionRemindersTable.sessionId, session.id),
                eq(sessionRemindersTable.kind, kind),
              ));
          }
          logger.error({ err, sessionId: session.id, userId: learner.userId, kind }, "Reminder email failed");
        }
      }
    }
  }
}

export function startReminderScheduler(): void {
  // Single-flight guard: a slow run must not stack on top of the next tick.
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      await runOnce();
    } catch (err) {
      logger.error({ err }, "Reminder scheduler run failed");
    } finally {
      inFlight = false;
    }
  };
  void tick();
  setInterval(() => void tick(), CHECK_EVERY_MS);
  logger.info("Session reminder scheduler started");
}
