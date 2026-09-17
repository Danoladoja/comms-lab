/**
 * Attendance as Google saw it.
 *
 * The heartbeat measures how long the Lab's own classroom page stayed open
 * while a class ran somewhere else entirely. It is a proxy, and it fails in the
 * way proxies do: a cohort that joined Meet from the calendar invite — because
 * the app's link was 404ing — sat through whole classes the app recorded
 * nothing for, and was then told to repeat them.
 *
 * Google already knows who was in the room and for how long. The Workspace
 * Reports API emits a `call_ended` event per participant per call, carrying
 * their email address and the seconds they were connected. That is not a proxy.
 * It does not care whether anybody opened the app, which is the whole point.
 *
 * This file is the part with no network in it: reading those events, and adding
 * them up. Everything here is a pure function of what Google returned, so it
 * can be tested against the shapes the API actually produces rather than hoped
 * about.
 */

/** One participant's stint in one call, as the Reports API describes it. */
export type MeetCallEvent = {
  /** Lower-cased, because Google is inconsistent about case and we match on it. */
  email: string;
  displayName: string;
  /** Seconds connected. A rejoin produces a second event, not a longer one. */
  durationSeconds: number;
  /** Normalised: no dashes, lower case. */
  meetingCode: string;
  /** When the stint ended, for picking the right class when a room is reused. */
  endedAt: string | null;
};

/**
 * A meeting code with the punctuation taken out.
 *
 * Google writes the same code as `abc-mnop-xyz` in a URL and `abcmnopxyz` in a
 * report, sometimes with different case. Comparing them raw finds nothing, and
 * finding nothing looks exactly like nobody attending.
 */
export function normaliseMeetingCode(code: string | null | undefined): string {
  return (code ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

type RawParameter = { name?: string; value?: string; intValue?: string; boolValue?: boolean };
type RawEvent = { name?: string; parameters?: RawParameter[] };
type RawItem = { id?: { time?: string }; events?: RawEvent[] };

function parameter(params: RawParameter[], name: string): RawParameter | undefined {
  return params.find((p) => p.name === name);
}

function seconds(param: RawParameter | undefined): number {
  const raw = param?.intValue ?? param?.value;
  const n = Number(raw);
  // A missing or unreadable duration is zero rather than a guess. Somebody
  // present for an unknown length is not evidence of attendance.
  if (!Number.isFinite(n) || n < 0) return 0;
  // A fortnight is not a class. Google has reported absurd durations for
  // sessions left connected on a forgotten device, and one of those would
  // otherwise credit a learner for every class in the programme at once.
  return Math.min(Math.round(n), 24 * 60 * 60);
}

/**
 * Pull the call events out of whatever the Reports API returned.
 *
 * Tolerant on purpose: an item with no events, an event with no parameters, a
 * participant with no email — all skipped rather than thrown. A single odd row
 * in a report must not cost a whole cohort its attendance.
 */
export function readCallEvents(payload: unknown): MeetCallEvent[] {
  const items = (payload as { items?: RawItem[] })?.items;
  if (!Array.isArray(items)) return [];

  const out: MeetCallEvent[] = [];
  for (const item of items) {
    for (const event of item.events ?? []) {
      if (event.name !== "call_ended") continue;
      const params = event.parameters ?? [];

      // `identifier` is the participant. For a signed-in Workspace user it is
      // their email; for somebody who dialled in or joined anonymously it is
      // not, and those are skipped — there is nobody to credit.
      const identifierType = parameter(params, "identifier_type")?.value;
      const identifier = (parameter(params, "identifier")?.value ?? "").trim().toLowerCase();
      if (!identifier.includes("@")) continue;
      if (identifierType && identifierType !== "email_address") continue;

      out.push({
        email: identifier,
        displayName: (parameter(params, "display_name")?.value ?? "").trim(),
        durationSeconds: seconds(parameter(params, "duration_seconds")),
        meetingCode: normaliseMeetingCode(parameter(params, "meeting_code")?.value),
        endedAt: item.id?.time ?? null,
      });
    }
  }
  return out;
}

/**
 * Total seconds per person for one meeting code, within a window.
 *
 * Summed rather than maxed, because a dropped line produces two events and the
 * learner was present for both. Filtered by code because a Lab room is reused
 * week after week, and by time because the same code hosts every class in the
 * programme — without the window, week one's attendance would credit week six.
 */
export function secondsByEmail(
  events: MeetCallEvent[],
  meetingCode: string,
  window: { startMs: number; endMs: number },
): Map<string, number> {
  const code = normaliseMeetingCode(meetingCode);
  const totals = new Map<string, number>();

  for (const e of events) {
    if (code && e.meetingCode && e.meetingCode !== code) continue;
    if (e.endedAt) {
      const ended = new Date(e.endedAt).getTime();
      // An unreadable timestamp is kept: the code and the query window have
      // already narrowed this, and throwing it away would silently lose
      // somebody's attendance over a formatting quirk.
      if (Number.isFinite(ended) && (ended < window.startMs || ended > window.endMs)) continue;
    }
    totals.set(e.email, (totals.get(e.email) ?? 0) + e.durationSeconds);
  }
  return totals;
}

/**
 * The window to ask Google about, for a class.
 *
 * Wider than the class at both ends. People arrive early, a class overruns, and
 * the event is stamped when somebody *leaves* — so the last person out of a
 * class that ran long is recorded well after the scheduled end. Too narrow a
 * window silently drops exactly the people who stayed to the end.
 */
export function reportWindow(startsAtMs: number, durationMins: number): { startMs: number; endMs: number } {
  const HOUR = 60 * 60 * 1000;
  return {
    startMs: startsAtMs - HOUR,
    endMs: startsAtMs + durationMins * 60 * 1000 + 3 * HOUR,
  };
}

/**
 * How Google's number and the app's own should be reconciled.
 *
 * The higher of the two, always. They measure different things — Google counts
 * time connected to the call, the heartbeat counts time with the app open — and
 * a learner who did both has not attended twice. Taking the higher never
 * removes attendance somebody has already been credited with, which matters
 * when this runs over classes that are already settled.
 */
export function reconcileSeconds(existing: number, fromGoogle: number): number {
  return Math.max(Math.max(0, existing), Math.max(0, fromGoogle));
}
