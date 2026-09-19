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

/**
 * Two routes, two bars — because they are not the same act.
 *
 * Live attendance is measured by a heartbeat from a browser tab while the class
 * runs in Google Meet somewhere else entirely. It is interrupted by a dropped
 * line, a power cut, a phone locking, a browser throttling a background tab. It
 * is a proxy, and a noisy one, so the bar is set where somebody who genuinely
 * sat through the class will clear it without a perfect connection.
 *
 * The replay is the opposite: deliberate, repeatable, and measured directly from
 * the player. Somebody watching a recording can pause it, rewind it and come
 * back tomorrow, so none of the excuses that justify a lenient live bar apply —
 * and at the Lab most of the people who were in the class watch it again
 * anyway. A replay route that could be cleared by skimming would let somebody
 * pass on neither route while appearing to pass on one.
 *
 * Not 100, though it means "all of it". Coverage is counted in fifteen-second
 * buckets and players stop reporting a second or two before the end, so the last
 * bucket is often unreachable and a literal 100 would fail people who watched
 * every frame. Ninety-five cannot be reached by skipping.
 *
 * ---
 *
 * Both of these are shares of the class's SCHEDULED length, and that is the part
 * that bites. When the Lab moved from ninety-minute classes to sixty-minute
 * ones, the modules went on saying ninety: a learner who sat through every
 * minute of an hour was recorded at 67%, and the ones who joined five minutes
 * late landed at 57–59% and were failed for missing nothing.
 *
 * So these numbers only mean what they say while a module's length is the length
 * it actually runs. Seventy per cent of a sixty-minute class is forty-two
 * minutes. Seventy per cent of a sixty-minute class recorded as ninety is
 * sixty-three — longer than the class, and unreachable by everyone in it.
 * `why:locked` reports the scheduled length beside the recording's for exactly
 * this reason.
 */
export const PRESENCE_LIVE_THRESHOLD_PCT = 70;
export const PRESENCE_REPLAY_THRESHOLD_PCT = 95;

/**
 * Kept so existing callers and stored values still mean something. It is the
 * live bar, which is the one the app quotes when it talks about attending.
 */
export const PRESENCE_THRESHOLD_PCT = PRESENCE_LIVE_THRESHOLD_PCT;

/** How often the classroom page reports in while a live class is running. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * The server credits at most this much time per heartbeat. Without a cap, a
 * tab left open through a lunch break would bank the whole gap on the next ping.
 */
/**
 * The server credits at most this much time per heartbeat.
 *
 * It exists so a tab left open through a lunch break cannot bank the whole gap
 * on the next ping. It used to be 45 seconds against a 30-second interval,
 * which quietly made full attendance impossible: browsers throttle timers in a
 * background tab to about once a minute, and a learner who clicked Join and
 * moved to the Meet tab — which is everybody — therefore beat once a minute and
 * was credited 45 seconds of each. A ceiling of 75%, against a bar of 90.
 *
 * Three minutes leaves room for throttling and a brief drop without letting an
 * abandoned tab claim an afternoon: the gap is still clamped to the scheduled
 * window at both ends, so the most an idle tab can gain is one cap per beat.
 */
export const HEARTBEAT_MAX_CREDIT_MS = 180_000;

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
  /**
   * Credited without measurement, and why.
   *
   * For the weeks when the app failed to record attendance it was being shown,
   * and for any case a facilitator judges on evidence the app cannot see. It is
   * a separate field rather than a pile of invented seconds because the record
   * should say "we could not measure this", not claim a number nobody observed.
   */
  waived?: boolean;
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
  /** The better of the two routes, as a share of that route's own bar. */
  bestPct: number;
  met: boolean;
  /** Which route is currently carrying the learner, for the UI to explain. */
  via: "live" | "replay" | "waived" | "none";
  /** The bar the learner is closest to clearing, so the UI can name a number. */
  thresholdPct: number;
  /**
   * How far along they are as a fraction of that bar, 0 to 1.
   *
   * Computed here rather than left to callers to divide `bestPct` by
   * `thresholdPct`, because those two can describe different routes — the raw
   * higher percentage and the nearer bar — and dividing one by the other told
   * a learner who attended half the class and watched most of the recording
   * that they were at 100% of a module that would not complete.
   */
  share: number;
  liveThresholdPct: number;
  replayThresholdPct: number;
};

function pct(part: number, whole: number | null): number {
  if (!whole || whole <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}

export function presenceStatus(input: PresenceInput): PresenceStatus {
  const livePct = pct(input.liveSeconds, input.sessionSeconds);
  const replayPct = pct(input.replayWatchedSeconds, input.replayDurationSeconds);

  const liveMet = livePct >= PRESENCE_LIVE_THRESHOLD_PCT;
  const replayMet = replayPct >= PRESENCE_REPLAY_THRESHOLD_PCT;
  const waived = !!input.waived;

  // The two routes have different bars, so "which is further along" is a
  // question about progress towards each bar, not about the raw percentages.
  // Forty per cent of a replay is further from its bar than forty per cent of a
  // class is from its own, and the learner should be pointed at the nearer one.
  const liveShare = livePct / PRESENCE_LIVE_THRESHOLD_PCT;
  const replayShare = replayPct / PRESENCE_REPLAY_THRESHOLD_PCT;
  const onLive = liveShare >= replayShare;
  const share = waived ? 1 : Math.min(1, Math.max(liveShare, replayShare));

  const via: PresenceStatus["via"] = waived
    ? "waived"
    : livePct === 0 && replayPct === 0
      ? "none"
      : onLive ? "live" : "replay";

  return {
    livePct,
    replayPct,
    bestPct: waived ? 100 : Math.max(livePct, replayPct),
    met: waived || liveMet || replayMet,
    via,
    share,
    thresholdPct: onLive ? PRESENCE_LIVE_THRESHOLD_PCT : PRESENCE_REPLAY_THRESHOLD_PCT,
    liveThresholdPct: PRESENCE_LIVE_THRESHOLD_PCT,
    replayThresholdPct: PRESENCE_REPLAY_THRESHOLD_PCT,
  };
}

export const EMPTY_PRESENCE: PresenceInput = {
  waived: false,
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
 * Union, sorted, de-duplicated. What a client *reports* is bounded by the
 * recording's length — one claiming bucket 99999 for a ten-minute video is
 * dropped rather than trusted.
 *
 * What the learner already had is never dropped, and that distinction is the
 * whole of this function.
 *
 * The agreed length of a recording can be cleared and settled again — a
 * replaced video, or an admin saving a module row. The next player to report
 * then sets it, and the Lab accepts anything from a quarter of the class
 * length to three times it. If it lands short, bounding the *existing* set
 * silently deleted every minute a learner had watched beyond the new mark, for
 * good, because only the total is kept and not the history. Watching is a
 * thing somebody did; a number that moved afterwards cannot make it not have
 * happened.
 */
export function mergeReplayBuckets(
  existing: number[],
  incoming: number[],
  durationSeconds: number | null,
): number[] {
  const limit = durationSeconds ? replayBucketCount(durationSeconds) : null;
  const merged = new Set<number>();
  for (const bucket of existing) {
    if (!Number.isInteger(bucket) || bucket < 0) continue;
    merged.add(bucket);
  }
  for (const bucket of incoming) {
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
