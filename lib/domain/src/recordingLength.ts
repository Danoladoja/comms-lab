/**
 * How long a recording is, and who is allowed to say so.
 *
 * Replay coverage is a fraction: seconds watched over the recording's length.
 * The numerator is hard to forge — it is a set of fifteen-second slices the
 * player reports as it passes them. The denominator was trivial to forge,
 * because it arrived in the same request: a learner who said "this recording is
 * one second long and I watched one second of it" was recorded as having
 * watched all of it, which completed the module, unlocked every week after it
 * and earned a certificate. One request, no skill required.
 *
 * The fix is to stop asking each learner how long the video is. The length
 * belongs to the recording, not to the person watching it, so it is settled
 * once for the whole cohort and then left alone.
 *
 * Only a browser can measure it — the Lab does not hold the video file — so the
 * first plausible report wins and every later one is ignored. Two things make
 * that safe enough. A report has to be in proportion to the class it came from,
 * so the one-second answer is refused outright rather than being enshrined. And
 * being first requires being the first person in the cohort to open the replay,
 * which is neither predictable nor repeatable — and leaves a wrong number in
 * one visible place that staff can correct, instead of in every learner's own
 * private record where nobody would ever see it.
 */

/**
 * A recording can reasonably run from a quarter of the scheduled class — a
 * session that ended early, or one where recording started late — to three
 * times it, since a class can overrun and Meet sometimes keeps rolling after
 * everyone has gone. Outside that band the number is not a measurement.
 */
export const MIN_RECORDING_SHARE = 0.25;
export const MAX_RECORDING_SHARE = 3;

/** An unscheduled module has no class length to compare against. */
export const FALLBACK_MIN_RECORDING_SECONDS = 60;

/**
 * Is this a believable length for a recording of this class?
 *
 * Refusing a bad value matters more than accepting every good one: a rejected
 * report simply means the next learner's report is used instead, whereas an
 * accepted bad one becomes the denominator for the whole cohort.
 */
export function plausibleRecordingLength(
  reportedSeconds: number | null | undefined,
  scheduledMins: number | null | undefined,
): boolean {
  const seconds = Number(reportedSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return false;

  const scheduled = Number(scheduledMins);
  if (!Number.isFinite(scheduled) || scheduled <= 0) {
    // Nothing to compare against, so only the obviously absurd is refused.
    return seconds >= FALLBACK_MIN_RECORDING_SECONDS;
  }

  const expected = scheduled * 60;
  return seconds >= expected * MIN_RECORDING_SHARE && seconds <= expected * MAX_RECORDING_SHARE;
}

/**
 * The length to measure everybody's watching against.
 *
 * Once settled it never moves, which is the whole point: a learner cannot
 * shrink their own denominator, and a learner watching a re-uploaded recording
 * is not silently measured against the old one's length either, because
 * replacing a recording clears this.
 */
export function settleRecordingLength(args: {
  /** What the session already holds, or null if nobody has watched yet. */
  stored: number | null | undefined;
  /** What this player says, which may be missing, wrong or hostile. */
  reported: number | null | undefined;
  scheduledMins: number | null | undefined;
}): number | null {
  if (args.stored && args.stored > 0) return args.stored;
  if (plausibleRecordingLength(args.reported, args.scheduledMins)) {
    return Math.round(Number(args.reported));
  }
  return null;
}
