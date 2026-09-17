/**
 * Asking Google who was in the room.
 *
 * The Workspace Reports API keeps an audit trail of Meet calls: one
 * `call_ended` event per participant per stint, carrying their email address
 * and how many seconds they were connected. It needs an administrator of the
 * domain that hosts the classes, which is why this is separate from the Meet
 * API calls next door — those run as the organiser, this runs as the admin.
 *
 * Deliberately NOT filtered by meeting code in the query. The Reports API's
 * filter syntax for `meeting_code` is fussy about case and punctuation, and a
 * filter that quietly matches nothing is indistinguishable from a class nobody
 * attended — which is the exact failure this whole thing exists to end. The
 * window is one class wide, so fetching it and matching the code here costs
 * little and cannot fail silently.
 *
 * Reports are retained for about six months, so classes that have already
 * happened can be filled in.
 */
import { readCallEvents, type MeetCallEvent } from "@workspace/domain";
import { logger } from "../logger";

const REPORTS_API =
  "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/meet";

/** Pages are 1000 events; a class of fifty with reconnections is nowhere near it. */
const PAGE_SIZE = 1000;
/** A guard against paging forever if the API disagrees with us about the end. */
const MAX_PAGES = 20;

export type MeetReportResult =
  | { ok: true; events: MeetCallEvent[] }
  | { ok: false; error: string };

/**
 * Every Meet `call_ended` event in a window.
 *
 * Errors come back as a sentence somebody can act on rather than a status
 * code, because the two likely failures both have a specific remedy: the
 * connected Google account is not an administrator, or it was connected before
 * this feature existed and has not granted the reports permission.
 */
export async function fetchCallEvents(args: {
  accessToken: string;
  startMs: number;
  endMs: number;
}): Promise<MeetReportResult> {
  const events: MeetCallEvent[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(REPORTS_API);
    url.searchParams.set("eventName", "call_ended");
    url.searchParams.set("startTime", new Date(args.startMs).toISOString());
    url.searchParams.set("endTime", new Date(args.endMs).toISOString());
    url.searchParams.set("maxResults", String(PAGE_SIZE));
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    let res: Response;
    try {
      res = await fetch(url, { headers: { authorization: `Bearer ${args.accessToken}` } });
    } catch (err) {
      logger.error({ err }, "Meet reports request threw");
      return { ok: false, error: "Could not reach Google to read the attendance report. Try again shortly." };
    }

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body: body.slice(0, 400) }, "Meet reports request failed");
      if (res.status === 403) {
        return {
          ok: false,
          error: "Google refused the attendance report. The connected account must be an "
            + "administrator of the domain that hosts the classes, and must have granted the "
            + "reports permission — reconnect Google in the admin console to grant it.",
        };
      }
      if (res.status === 401) {
        return { ok: false, error: "Google rejected the connection. Reconnect Google in the admin console." };
      }
      if (res.status === 429 || res.status >= 500) {
        return { ok: false, error: "Google is rate limiting or unavailable right now. Try again in a few minutes." };
      }
      return { ok: false, error: `Google returned an error reading the attendance report (${res.status}).` };
    }

    const payload = (await res.json()) as { nextPageToken?: string };
    events.push(...readCallEvents(payload));

    pageToken = payload.nextPageToken;
    if (!pageToken) return { ok: true, events };
  }

  // Ran out of pages rather than out of data. Report what we have and say so,
  // because silently returning a partial class would under-credit people.
  logger.warn({ pages: MAX_PAGES }, "Meet reports paging hit its ceiling");
  return {
    ok: false,
    error: "The attendance report was larger than expected and was not read in full. Nothing was written.",
  };
}
