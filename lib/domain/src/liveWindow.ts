/**
 * The live-session time window — the single source of truth for both the API
 * and the web client.
 *
 * Before this module existed the client offered a "Join live class" button from
 * T-15 while the server rejected joins before T-5, so for ten minutes every
 * class the button failed with "The class has not started yet". Import these
 * constants; never re-type the numbers.
 */

/** The room opens this long before the scheduled start. Joining is allowed from here. */
export const JOIN_OPENS_BEFORE_MS = 10 * 60 * 1000;

/**
 * Join at or before start + this and you are credited as having been there from
 * the beginning. Join later and you are still checked in, but the attendance
 * bonus is not awarded (see `attendedLive`).
 */
export const ON_TIME_GRACE_MS = 5 * 60 * 1000;

export type LiveWindowState = "unscheduled" | "before" | "open" | "live" | "ended";

export type LiveWindowInfo = {
  state: LiveWindowState;
  /** The server will accept a join right now. */
  canJoin: boolean;
  /** Joining right now would still earn the on-time attendance bonus. */
  countsAsOnTime: boolean;
  /** ms until the room opens; 0 once it has. */
  msUntilOpen: number;
  /** ms until on-time credit is lost; 0 once it has passed. */
  msUntilLateMark: number;
  startsAtMs: number | null;
  endsAtMs: number | null;
};

/**
 * Describe the live window for a session at a point in time. Pure — pass `now`
 * in tests.
 */
export function liveWindow(
  session: { startsAt: Date | string | null | undefined; durationMins: number },
  now: number = Date.now(),
): LiveWindowInfo {
  const raw = session.startsAt;
  const startsAtMs = raw ? new Date(raw).getTime() : null;

  if (startsAtMs === null || Number.isNaN(startsAtMs)) {
    return {
      state: "unscheduled",
      canJoin: false,
      countsAsOnTime: false,
      msUntilOpen: 0,
      msUntilLateMark: 0,
      startsAtMs: null,
      endsAtMs: null,
    };
  }

  const endsAtMs = startsAtMs + session.durationMins * 60 * 1000;
  const opensAtMs = startsAtMs - JOIN_OPENS_BEFORE_MS;
  const lateMarkMs = startsAtMs + ON_TIME_GRACE_MS;

  let state: LiveWindowState;
  if (now > endsAtMs) state = "ended";
  else if (now >= startsAtMs) state = "live";
  else if (now >= opensAtMs) state = "open";
  else state = "before";

  return {
    state,
    canJoin: now >= opensAtMs && now <= endsAtMs,
    countsAsOnTime: now <= lateMarkMs && now >= opensAtMs,
    msUntilOpen: Math.max(0, opensAtMs - now),
    msUntilLateMark: Math.max(0, lateMarkMs - now),
    startsAtMs,
    endsAtMs,
  };
}
