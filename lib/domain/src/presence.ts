/**
 * Did the learner actually attend the class?
 *
 * A module cannot be completed on coursework alone — the learner has to have
 * been in the room, or watched the recording. Two routes, one bar:
 *
 *   - **Live**: time with the classroom open during the scheduled window.
 *   - **Replay**: distinct seconds of the recording actually watched.
 *
 * Whichever is higher must reach {@link PRESENCE_THRESHOLD_PCT}. They are not
 * added together: the two timelines cover the same material, so summing them
 * would let someone watch the first half twice and call it a full session. A
 * learner who attended most of the class live and wants to close the gap tops
 * up on the replay, whose own coverage then carries them over the bar.
 *
 * ## What the live number really measures
 *
 * The live class runs in Google Meet, outside this application, so the platform
 * cannot see the meeting. The classroom page sends a heartbeat while it is open
 * during the scheduled window, which measures *the classroom being open during
 * class* — a proxy for presence, and one a determined learner could game by
 * leaving a tab open. It is recorded as accumulated seconds rather than a
 * verdict, so a stricter source (Google Meet attendance reports, or an
 * in-platform video provider) can replace the input later without any of the
 * rules below changing.
 */

/** Fraction of the class that must be attended live or watched on replay. */
export const PRESENCE_THRESHOLD_PCT = 90;

/** How often the classroom page reports in while a live class is running. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * The server credits at most this much time per heartbeat. Without a cap, a
 * tab left open through a lunch break would bank the whole gap on the next ping.
 */
export const HEARTBEAT_MAX_CREDIT_MS = 45_000;

/**
 * Replay watching is recorded as fixed buckets of the video's timeline rather
 * than a running total, so scrubbing to the end credits one bucket and
 * re-watching the opening minute credits nothing new.
 */
export const REPLAY_BUCKET_SECONDS = 15;

/** How often the player reports the buckets it has covered. */
export const REPLAY_REPORT_INTERVAL_MS = 20_000;

export type PresenceInput = {
  /** Seconds accumulated from live heartbeats. */
  liveSeconds: number;
  /** Scheduled length of the class, in seconds. */
  sessionSeconds: number;
  /** Distinct seconds of the recording watched. */
  replayWatchedSeconds: number;
  /** Length of the recording, in seconds. Null until a player has reported it. */
  replayDurationSeconds: number | null;
};

export type PresenceStatus = {
  livePct: number;
  replayPct: number;
  /** The better of the two routes — this is what is measured against the bar. */
  bestPct: number;
  met: boolean;
  /** Which route is currently carrying the learner, for the UI to explain. */
  via: "live" | "replay" | "none";
  thresholdPct: number;
};

function pct(part: number, whole: number | null): number {
  if (!whole || whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export function presenceStatus(input: PresenceInput): PresenceStatus {
  const livePct = pct(input.liveSeconds, input.sessionSeconds);
  const replayPct = pct(input.replayWatchedSeconds, input.replayDurationSeconds);
  const bestPct = Math.max(livePct, replayPct);
  return {
    livePct,
    replayPct,
    bestPct,
    met: bestPct >= PRESENCE_THRESHOLD_PCT,
    via: bestPct === 0 ? "none" : livePct >= replayPct ? "live" : "replay",
    thresholdPct: PRESENCE_THRESHOLD_PCT,
  };
}

export const EMPTY_PRESENCE: PresenceInput = {
  liveSeconds: 0,
  sessionSeconds: 0,
  replayWatchedSeconds: 0,
  replayDurationSeconds: null,
};

/**
 * How many seconds a heartbeat should credit.
 *
 * Clamped to the scheduled window at both ends, so opening the classroom an
 * hour early or leaving it open long after the class has finished banks
 * nothing, and capped per beat so a long gap cannot be claimed in one go.
 */
export function heartbeatCredit(args: {
  previousBeatMs: number | null;
  nowMs: number;
  sessionStartMs: number;
  sessionEndMs: number;
}): number {
  const { previousBeatMs, nowMs, sessionStartMs, sessionEndMs } = args;
  // The first beat establishes a baseline; there is no elapsed time to credit yet.
  if (previousBeatMs === null) return 0;

  const from = Math.max(previousBeatMs, sessionStartMs);
  const to = Math.min(nowMs, sessionEndMs);
  const elapsed = to - from;
  if (elapsed <= 0) return 0;

  return Math.round(Math.min(elapsed, HEARTBEAT_MAX_CREDIT_MS) / 1000);
}

/** The bucket a playback position falls into. */
export function replayBucketFor(positionSeconds: number): number {
  return Math.max(0, Math.floor(positionSeconds / REPLAY_BUCKET_SECONDS));
}

/** Total buckets a recording of this length is divided into. */
export function replayBucketCount(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / REPLAY_BUCKET_SECONDS));
}

/**
 * Fold newly reported buckets into what was already covered.
 *
 * Union, sorted, de-duplicated, and bounded by the recording's length — a
 * client reporting bucket 99999 for a ten-minute video is dropped rather than
 * trusted.
 */
export function mergeReplayBuckets(
  existing: number[],
  incoming: number[],
  durationSeconds: number | null,
): number[] {
  const limit = durationSeconds ? replayBucketCount(durationSeconds) : null;
  const merged = new Set<number>();
  for (const bucket of [...existing, ...incoming]) {
    if (!Number.isInteger(bucket) || bucket < 0) continue;
    if (limit !== null && bucket >= limit) continue;
    merged.add(bucket);
  }
  return [...merged].sort((a, b) => a - b);
}

/** Distinct seconds watched, never exceeding the recording's actual length. */
export function replayWatchedSeconds(buckets: number[], durationSeconds: number | null): number {
  const raw = buckets.length * REPLAY_BUCKET_SECONDS;
  return durationSeconds ? Math.min(raw, Math.round(durationSeconds)) : raw;
}
