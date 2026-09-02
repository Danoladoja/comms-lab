import { liveWindow, type LiveWindowInfo } from "./liveWindow";

/**
 * The rules for a Live Session.
 *
 * A Live Session is a standalone evening: one subject, one speaker, no
 * programme and no certificate. Anyone with an account can register; the
 * joining link and the recording afterwards go only to the people who did.
 *
 * That last part is the whole design. Registration has to buy something, or
 * nobody does it and the Lab never learns who its audience is. What it buys is
 * the link and the replay, which is honest: they are the two things worth
 * having.
 */

export type LiveSessionStatus = "draft" | "published" | "cancelled";

export function isLiveSessionStatus(value: unknown): value is LiveSessionStatus {
  return value === "draft" || value === "published" || value === "cancelled";
}

/** Only a published one is listed. A draft is the admin's, a cancelled one is nobody's. */
export function showsInLiveSessionList(status: string): boolean {
  return status === "published";
}

export type LiveSessionState =
  /** Scheduled, not yet open. */
  | "upcoming"
  /** The room is open, or the session is under way. */
  | "live"
  /** It has finished. */
  | "past"
  /** Published with no date yet: "coming soon". */
  | "unscheduled"
  | "cancelled";

export function liveSessionState(
  session: { startsAt: Date | string | null | undefined; durationMins: number; status: string },
  now: number = Date.now(),
): LiveSessionState {
  if (session.status === "cancelled") return "cancelled";
  const window = liveWindow(session, now);
  if (window.state === "unscheduled") return "unscheduled";
  if (window.state === "ended") return "past";
  if (window.state === "open" || window.state === "live") return "live";
  return "upcoming";
}

/**
 * May somebody put their name down?
 *
 * Up to the moment it ends, which is deliberate: people find these an hour
 * before they start, and turning them away at the door to protect a number in
 * a database would be perverse. Registering during the session is normal.
 */
export function canRegisterForLiveSession(
  session: { startsAt: Date | string | null | undefined; durationMins: number; status: string; capacity: number },
  registeredCount: number,
  alreadyRegistered: boolean,
  now: number = Date.now(),
): { allowed: boolean; reason: string | null } {
  if (alreadyRegistered) return { allowed: false, reason: "You are already registered." };
  if (session.status === "cancelled") return { allowed: false, reason: "This session was cancelled." };
  if (session.status !== "published") return { allowed: false, reason: "This session is not open yet." };

  const state = liveSessionState(session, now);
  if (state === "past") return { allowed: false, reason: "This session has finished." };

  // Zero means no limit, which is the usual case.
  if (session.capacity > 0 && registeredCount >= session.capacity) {
    return { allowed: false, reason: "This session is full." };
  }
  return { allowed: true, reason: null };
}

/**
 * May this person be given the joining link right now?
 *
 * Registered, and inside the window the room is actually open. Handing the link
 * out a week early guarantees somebody wanders in during the sound check.
 */
export function mayJoinLiveSession(
  session: { startsAt: Date | string | null | undefined; durationMins: number; status: string },
  registered: boolean,
  now: number = Date.now(),
): boolean {
  if (!registered || session.status !== "published") return false;
  return liveWindow(session, now).canJoin;
}

/**
 * May this person watch the recording?
 *
 * Registered. Not "attended": somebody who signed up and then had a power cut
 * has done nothing wrong, and withholding the replay from exactly the people
 * most likely to need it would be the wrong lesson.
 */
export function maySeeLiveSessionRecording(
  session: { status: string; recordingUrl: string | null },
  registered: boolean,
): boolean {
  return registered && session.status !== "draft" && !!session.recordingUrl;
}

/** The line under the title in a listing: what to do about this one, now. */
export function liveSessionCallToAction(state: LiveSessionState, registered: boolean): string {
  if (state === "cancelled") return "Cancelled";
  if (state === "past") return registered ? "Watch the recording" : "Finished";
  if (state === "live") return registered ? "Join now" : "Register and join";
  if (state === "unscheduled") return registered ? "You are registered" : "Register for the date";
  return registered ? "You are registered" : "Register";
}

/** Soonest first for what is coming, most recent first for what has been. */
export function sortLiveSessions<T extends { startsAt: Date | string | null | undefined; durationMins: number; status: string }>(
  sessions: readonly T[],
  now: number = Date.now(),
): { upcoming: T[]; past: T[] } {
  const at = (s: T) => (s.startsAt ? new Date(s.startsAt).getTime() : Number.POSITIVE_INFINITY);
  const upcoming: T[] = [];
  const past: T[] = [];

  for (const session of sessions) {
    (liveSessionState(session, now) === "past" ? past : upcoming).push(session);
  }
  upcoming.sort((a, b) => at(a) - at(b));
  past.sort((a, b) => at(b) - at(a));
  return { upcoming, past };
}

export type { LiveWindowInfo };
