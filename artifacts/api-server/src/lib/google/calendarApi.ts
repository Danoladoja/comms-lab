/**
 * Making the class's meeting, as a calendar event that carries a Meet link.
 *
 * There is a Meet API that creates a bare meeting space, and it would be one
 * call instead of two. It is the wrong one. A bare space exists nowhere a person
 * can see it; a calendar event is a thing the organiser can open, move, and
 * check — and moving it is how the link and the class stay married when a date
 * changes. Since the whole reason for doing this is that two copies of a link
 * drifted apart, the version with fewer copies wins.
 *
 * No attendees are added. The event sits on the connected account's own
 * calendar and the Lab shows the link; nobody is emailed. That was a deliberate
 * choice — a cohort of forty-five does not want an invite every time somebody
 * adjusts a date that is still being decided.
 */
import { logger } from "../logger";
import { meetLinkFrom, conferenceProgress } from "@workspace/domain";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

/** Google mints the conference asynchronously; this is how long we wait for it. */
const POLL_ATTEMPTS = 6;
const POLL_GAP_MS = 1500;

export type ClassEvent = {
  eventId: string;
  /** Null while Google is still making the conference. */
  meetUrl: string | null;
  htmlLink: string | null;
};

type EventResponse = {
  id?: string;
  htmlLink?: string;
  conferenceData?: unknown;
};

async function calendarFetch<T>(args: {
  accessToken: string;
  path: string;
  method?: string;
  params?: Record<string, string>;
  body?: unknown;
}): Promise<T> {
  const url = new URL(`${CALENDAR_API}${args.path}`);
  for (const [k, v] of Object.entries(args.params ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method: args.method ?? "GET",
    headers: {
      authorization: `Bearer ${args.accessToken}`,
      ...(args.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
  });

  if (!res.ok) {
    const said = await res.text();
    logger.error({ status: res.status, body: said.slice(0, 400), path: args.path }, "Calendar API call failed");
    if (res.status === 403) {
      throw new Error(
        "Google refused to create the meeting. The connected account needs permission to manage its "
        + "calendar — reconnect Google to grant it.",
      );
    }
    if (res.status === 401) {
      throw new Error("Google rejected the connection. Reconnect Google in the admin console.");
    }
    throw new Error(`Google could not create the meeting (${res.status}).`);
  }
  return (await res.json()) as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Create the event, then wait for Google to attach the joining link.
 *
 * The insert returns immediately with the conference marked `pending` and no
 * link on it. Returning at that point would leave the module with an event id
 * and no link, and the obvious next move — press the button again — books a
 * second meeting for the same class. So the event id is held and the link
 * polled for; a timeout returns the id with a null link, which the caller
 * stores, so a retry resumes rather than duplicates.
 */
export async function createClassEvent(args: {
  accessToken: string;
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  /** A stable string per attempt, so a retried request cannot mint two conferences. */
  requestId: string;
}): Promise<ClassEvent> {
  const created = await calendarFetch<EventResponse>({
    accessToken: args.accessToken,
    path: "/calendars/primary/events",
    method: "POST",
    // Without this, Google silently ignores the conference request and returns
    // a perfectly ordinary event with no link on it.
    params: { conferenceDataVersion: "1", sendUpdates: "none" },
    body: {
      summary: args.summary,
      description: args.description,
      start: { dateTime: args.startIso },
      end: { dateTime: args.endIso },
      conferenceData: { createRequest: { requestId: args.requestId } },
    },
  });

  if (!created.id) throw new Error("Google created the meeting but did not say which event it is.");

  let conference = created.conferenceData;
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const progress = conferenceProgress(conference);
    if (progress === "ready") break;
    if (progress === "failed") {
      throw new Error("Google could not attach a Meet link to the event. Try again in a moment.");
    }
    await sleep(POLL_GAP_MS);
    const reread = await calendarFetch<EventResponse>({
      accessToken: args.accessToken,
      path: `/calendars/primary/events/${encodeURIComponent(created.id)}`,
      params: { conferenceDataVersion: "1" },
    });
    conference = reread.conferenceData;
  }

  return {
    eventId: created.id,
    meetUrl: meetLinkFrom(conference),
    htmlLink: created.htmlLink ?? null,
  };
}

/** Read an event again, for the case where the link arrived after we stopped waiting. */
export async function readClassEvent(args: {
  accessToken: string;
  eventId: string;
}): Promise<ClassEvent> {
  const event = await calendarFetch<EventResponse>({
    accessToken: args.accessToken,
    path: `/calendars/primary/events/${encodeURIComponent(args.eventId)}`,
    params: { conferenceDataVersion: "1" },
  });
  return {
    eventId: args.eventId,
    meetUrl: meetLinkFrom(event.conferenceData),
    htmlLink: event.htmlLink ?? null,
  };
}

/**
 * Move the event when the class moves.
 *
 * The entire point of the app owning the event. A date changed in the Lab and
 * not on the calendar is the two copies drifting apart again, which is the
 * failure this replaced. `conferenceDataVersion: 1` is sent on the patch too,
 * because omitting it has been known to drop the conference from the event —
 * which would take the link away from a class mid-programme.
 */
export async function moveClassEvent(args: {
  accessToken: string;
  eventId: string;
  summary: string;
  startIso: string;
  endIso: string;
}): Promise<void> {
  await calendarFetch({
    accessToken: args.accessToken,
    path: `/calendars/primary/events/${encodeURIComponent(args.eventId)}`,
    method: "PATCH",
    params: { conferenceDataVersion: "1", sendUpdates: "none" },
    body: {
      summary: args.summary,
      start: { dateTime: args.startIso },
      end: { dateTime: args.endIso },
    },
  });
}
