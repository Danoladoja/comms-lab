import { describe, expect, it } from "vitest";
import {
  presenceStatus,
  heartbeatCredit,
  mergeReplayBuckets,
  replayBucketFor,
  replayBucketCount,
  replayWatchedSeconds,
  PRESENCE_THRESHOLD_PCT,
  HEARTBEAT_MAX_CREDIT_MS,
  REPLAY_BUCKET_SECONDS,
} from "./presence";

const HOUR_SECONDS = 3600;

describe("presenceStatus", () => {
  it("passes on live attendance alone at the threshold", () => {
    const s = presenceStatus({
      liveSeconds: HOUR_SECONDS * 0.9,
      sessionSeconds: HOUR_SECONDS,
      replayWatchedSeconds: 0,
      replayDurationSeconds: null,
    });
    expect(s.livePct).toBe(PRESENCE_THRESHOLD_PCT);
    expect(s.met).toBe(true);
    expect(s.via).toBe("live");
  });

  it("fails just below the threshold", () => {
    const s = presenceStatus({
      liveSeconds: HOUR_SECONDS * 0.89,
      sessionSeconds: HOUR_SECONDS,
      replayWatchedSeconds: 0,
      replayDurationSeconds: null,
    });
    expect(s.met).toBe(false);
  });

  it("passes on the replay alone", () => {
    const s = presenceStatus({
      liveSeconds: 0,
      sessionSeconds: HOUR_SECONDS,
      replayWatchedSeconds: 3400,
      replayDurationSeconds: 3600,
    });
    expect(s.met).toBe(true);
    expect(s.via).toBe("replay");
  });

  it("takes the better route rather than adding them together", () => {
    // Half live and half replay is not a full class — the two timelines cover
    // the same material.
    const s = presenceStatus({
      liveSeconds: HOUR_SECONDS * 0.5,
      sessionSeconds: HOUR_SECONDS,
      replayWatchedSeconds: 1800,
      replayDurationSeconds: 3600,
    });
    expect(s.bestPct).toBe(50);
    expect(s.met).toBe(false);
  });

  it("lets a partial live attendance be topped up by replay coverage", () => {
    const s = presenceStatus({
      liveSeconds: HOUR_SECONDS * 0.6,
      sessionSeconds: HOUR_SECONDS,
      replayWatchedSeconds: 3300,
      replayDurationSeconds: 3600,
    });
    expect(s.met).toBe(true);
    expect(s.via).toBe("replay");
  });

  it("reports nothing rather than dividing by zero when unmeasured", () => {
    const s = presenceStatus({
      liveSeconds: 0,
      sessionSeconds: 0,
      replayWatchedSeconds: 0,
      replayDurationSeconds: null,
    });
    expect(s.bestPct).toBe(0);
    expect(s.via).toBe("none");
    expect(s.met).toBe(false);
  });

  it("never reports more than 100% however long the tab was open", () => {
    const s = presenceStatus({
      liveSeconds: HOUR_SECONDS * 5,
      sessionSeconds: HOUR_SECONDS,
      replayWatchedSeconds: 0,
      replayDurationSeconds: null,
    });
    expect(s.livePct).toBe(100);
  });
});

describe("heartbeatCredit", () => {
  const start = Date.UTC(2026, 8, 10, 14, 0, 0);
  const end = start + HOUR_SECONDS * 1000;

  it("credits nothing on the first beat — there is no elapsed time yet", () => {
    expect(heartbeatCredit({ previousBeatMs: null, nowMs: start + 60_000, sessionStartMs: start, sessionEndMs: end }))
      .toBe(0);
  });

  it("credits the gap between beats", () => {
    const credit = heartbeatCredit({
      previousBeatMs: start + 60_000,
      nowMs: start + 90_000,
      sessionStartMs: start,
      sessionEndMs: end,
    });
    expect(credit).toBe(30);
  });

  it("caps a long gap so a tab left open cannot bank it all at once", () => {
    const credit = heartbeatCredit({
      previousBeatMs: start + 60_000,
      nowMs: start + 40 * 60_000,
      sessionStartMs: start,
      sessionEndMs: end,
    });
    expect(credit).toBe(HEARTBEAT_MAX_CREDIT_MS / 1000);
  });

  it("does not credit time before the class starts", () => {
    const credit = heartbeatCredit({
      previousBeatMs: start - 30 * 60_000,
      nowMs: start + 10_000,
      sessionStartMs: start,
      sessionEndMs: end,
    });
    expect(credit).toBe(10);
  });

  it("does not credit time after the class has ended", () => {
    const credit = heartbeatCredit({
      previousBeatMs: end - 10_000,
      nowMs: end + 30 * 60_000,
      sessionStartMs: start,
      sessionEndMs: end,
    });
    expect(credit).toBe(10);
  });

  it("credits nothing for a beat entirely outside the window", () => {
    const credit = heartbeatCredit({
      previousBeatMs: end + 60_000,
      nowMs: end + 90_000,
      sessionStartMs: start,
      sessionEndMs: end,
    });
    expect(credit).toBe(0);
  });

  it("credits nothing when the clock appears to go backwards", () => {
    const credit = heartbeatCredit({
      previousBeatMs: start + 90_000,
      nowMs: start + 60_000,
      sessionStartMs: start,
      sessionEndMs: end,
    });
    expect(credit).toBe(0);
  });
});

describe("replay buckets", () => {
  it("maps a position to its bucket", () => {
    expect(replayBucketFor(0)).toBe(0);
    expect(replayBucketFor(REPLAY_BUCKET_SECONDS - 0.1)).toBe(0);
    expect(replayBucketFor(REPLAY_BUCKET_SECONDS)).toBe(1);
  });

  it("counts the buckets in a recording, rounding up the tail", () => {
    expect(replayBucketCount(60)).toBe(4);
    expect(replayBucketCount(61)).toBe(5);
    expect(replayBucketCount(0)).toBe(1);
  });

  it("merges without duplicates and keeps order", () => {
    expect(mergeReplayBuckets([0, 2], [2, 1], 60)).toEqual([0, 1, 2]);
  });

  it("drops buckets beyond the end of the recording", () => {
    // A client claiming bucket 9999 of a one-minute video is not trusted.
    expect(mergeReplayBuckets([], [0, 9999], 60)).toEqual([0]);
  });

  it("drops negative and non-integer buckets", () => {
    expect(mergeReplayBuckets([], [-1, 1.5, 2], 60)).toEqual([2]);
  });

  it("accepts anything when the duration is not yet known", () => {
    expect(mergeReplayBuckets([], [0, 500], null)).toEqual([0, 500]);
  });

  it("gives no credit for scrubbing to the end", () => {
    // Jumping straight to the last bucket of an hour-long recording.
    const buckets = mergeReplayBuckets([], [replayBucketFor(3590)], 3600);
    expect(replayWatchedSeconds(buckets, 3600)).toBe(REPLAY_BUCKET_SECONDS);
  });

  it("gives no extra credit for re-watching the same stretch", () => {
    const first = mergeReplayBuckets([], [0, 1, 2], 3600);
    const again = mergeReplayBuckets(first, [0, 1, 2], 3600);
    expect(replayWatchedSeconds(again, 3600)).toBe(3 * REPLAY_BUCKET_SECONDS);
  });

  it("never reports more watched than the recording is long", () => {
    const buckets = Array.from({ length: 100 }, (_, i) => i);
    expect(replayWatchedSeconds(buckets, 60)).toBe(60);
  });
});
