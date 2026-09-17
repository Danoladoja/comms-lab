/**
 * The class's meeting: making it, and keeping it true.
 *
 * For three weeks this cohort's attendance was empty. The cause was not a
 * threshold or a measurement: the link in the Lab and the link in the calendar
 * invite were two separate things maintained by hand, the Lab's one 404'd,
 * everybody joined from the calendar, and the app watched an empty room.
 *
 * This removes the second thing. The Lab creates the calendar event, takes the
 * joining link off it, and remembers which event it was — so when the class
 * moves, the event moves with it, and there is never a second copy to disagree.
 */
import { db, sessionsTable, programsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import {
  eventWindow,
  eventSummary,
  eventDescription,
  meetingProblem,
} from "@workspace/domain";
import { getAccessToken, getConnection, hasCalendarScope } from "./google/oauth";
import { createClassEvent, readClassEvent, moveClassEvent } from "./google/calendarApi";
import { appUrl } from "./enrollmentEmails";
import { logger } from "./logger";

export type MeetingOutcome = {
  sessionId: number;
  meetUrl: string | null;
  calendarLink: string | null;
  note: string;
};

async function loadClass(sessionId: number) {
  const [row] = await db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      meetUrl: sessionsTable.meetUrl,
      calendarEventId: sessionsTable.calendarEventId,
      programmeTitle: programsTable.title,
    })
    .from(sessionsTable)
    .innerJoin(programsTable, eq(programsTable.id, sessionsTable.programId))
    .where(eq(sessionsTable.id, sessionId));
  return row ?? null;
}

/** Make this class a meeting, and put its link on the module. */
export async function createMeetingForSession(
  sessionId: number,
): Promise<MeetingOutcome | { error: string }> {
  const session = await loadClass(sessionId);
  if (!session) return { error: `No module with id ${sessionId}.` };

  const connection = await getConnection();
  const problem = meetingProblem({
    startsAt: session.startsAt,
    calendarConnected: !!connection,
    calendarAuthorised: hasCalendarScope(connection?.scopes),
    existingMeetUrl: session.meetUrl,
  });
  if (problem) return { error: problem };

  const accessToken = await getAccessToken();
  if (!accessToken) return { error: "Could not refresh the Google connection. Reconnect it on the Recordings page." };

  // An event may already exist from an attempt that timed out while Google was
  // still minting the conference. Reading it again is how a second press
  // finishes the first attempt instead of booking a second meeting.
  if (session.calendarEventId) {
    const existing = await readClassEvent({ accessToken, eventId: session.calendarEventId });
    if (existing.meetUrl) {
      await db.update(sessionsTable)
        .set({ meetUrl: existing.meetUrl })
        .where(eq(sessionsTable.id, sessionId));
      return {
        sessionId,
        meetUrl: existing.meetUrl,
        calendarLink: existing.htmlLink,
        note: "The meeting was already made — its link is now on the module.",
      };
    }
  }

  const window = eventWindow(session.startsAt as Date, session.durationMins);
  const created = await createClassEvent({
    accessToken,
    summary: eventSummary(session.programmeTitle, session.title),
    description: eventDescription({ moduleUrl: appUrl(`/classroom/${sessionId}`) }),
    startIso: window.startIso,
    endIso: window.endIso,
    // Google uses this to recognise a retried request, so a network hiccup
    // cannot turn one press of the button into two meetings.
    requestId: randomBytes(12).toString("hex"),
  });

  await db
    .update(sessionsTable)
    .set({
      calendarEventId: created.eventId,
      // Only when there is one. Storing an empty link would look like a module
      // with no meeting, and the retry above would never find the event.
      ...(created.meetUrl ? { meetUrl: created.meetUrl } : {}),
    })
    .where(eq(sessionsTable.id, sessionId));

  logger.info({ sessionId, eventId: created.eventId, gotLink: !!created.meetUrl }, "Class meeting created");

  return {
    sessionId,
    meetUrl: created.meetUrl,
    calendarLink: created.htmlLink,
    note: created.meetUrl
      ? "Meeting created. The Lab and the calendar now share one link, so they cannot drift apart."
      : "The event was created, but Google is still attaching the joining link. Press the button again "
        + "in a few seconds — it will finish this one rather than making a second meeting.",
  };
}

/**
 * Follow the class when its date or length changes.
 *
 * Called after a module is saved. Quiet by design: a module with no event of
 * ours is left alone, and a failure is logged rather than thrown, because the
 * admin was saving a module and a calendar that is briefly out of step is not
 * a reason to tell them their save failed.
 */
export async function syncMeetingTime(sessionId: number): Promise<void> {
  try {
    const session = await loadClass(sessionId);
    if (!session?.calendarEventId || !session.startsAt) return;

    const connection = await getConnection();
    if (!connection || !hasCalendarScope(connection.scopes)) return;
    const accessToken = await getAccessToken();
    if (!accessToken) return;

    const window = eventWindow(session.startsAt, session.durationMins);
    await moveClassEvent({
      accessToken,
      eventId: session.calendarEventId,
      summary: eventSummary(session.programmeTitle, session.title),
      startIso: window.startIso,
      endIso: window.endIso,
    });
    logger.info({ sessionId, startsAt: session.startsAt }, "Class meeting moved to follow the module");
  } catch (err) {
    logger.error({ err, sessionId }, "Could not move the class meeting — the calendar may be out of step");
  }
}
