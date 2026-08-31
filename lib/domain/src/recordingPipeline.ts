/**
 * Getting the class recording from Google Meet onto YouTube, without anyone
 * doing it by hand.
 *
 * Meet saves its recordings to the admin's Google Drive. The platform watches
 * for one belonging to a class that has finished, copies it to YouTube as an
 * unlisted video, and stores the link on the session. From the learner's side
 * the replay simply appears.
 *
 * The rules for *when* to look, *what* to look for, and *what to give up on*
 * live here so they can be tested without touching Google.
 */

/** Meet needs time to finish writing the recording to Drive after a class ends. */
export const RECORDING_SEARCH_DELAY_MS = 10 * 60 * 1000;

/** How long to keep looking before treating the recording as never coming. */
export const RECORDING_SEARCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Wait this long between attempts for the same session. */
export const RECORDING_RETRY_INTERVAL_MS = 15 * 60 * 1000;

/** Give up after this many failed attempts; a human takes over. */
export const RECORDING_MAX_ATTEMPTS = 12;

export type RecordingStatus =
  /** Nothing has happened yet. */
  | "pending"
  /** Looking in Drive for the finished recording. */
  | "searching"
  /** Copying it to YouTube. */
  | "uploading"
  /** Done — the link is on the session. */
  | "ready"
  /** Tried and failed; a person needs to look. */
  | "failed"
  /** Someone pasted a link by hand; leave it alone. */
  | "manual";

export type SessionRecordingState = {
  sessionId: number;
  startsAtMs: number | null;
  durationMins: number;
  meetUrl: string | null;
  recordingUrl: string | null;
  status: RecordingStatus;
  attempts: number;
  lastCheckedAtMs: number | null;
};

/**
 * Pull the meeting code out of a Meet link.
 *
 * `https://meet.google.com/abc-defg-hij` → `abc-defg-hij`. Anything that is not
 * a Meet link — a Zoom room, a typo, an empty field — returns null, and the
 * session is simply skipped rather than crashing the run.
 */
export function meetCodeFrom(meetUrl: string | null | undefined): string | null {
  if (!meetUrl) return null;
  // Matched rather than parsed with URL, because this package is shared with
  // the browser and compiles without DOM or Node globals. The scheme is
  // required: a link without one would not open when clicked either.
  // Meet codes are three groups of letters — xxx-xxxx-xxx.
  const match = /^\s*https?:\/\/(?:www\.)?meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:[/?#]|\s*$)/i
    .exec(meetUrl);
  return match ? match[1].toLowerCase() : null;
}

export type DueReason = "" | "no-meet-code" | "not-ended" | "too-soon" | "already-have-one" | "gave-up" | "window-closed" | "backing-off";

export type Dueness = { due: boolean; reason: DueReason };

/**
 * Should this session be checked for a recording right now?
 *
 * Deliberately conservative: it waits for the class to be properly over, backs
 * off between attempts, stops after a week, and never touches a session where
 * someone has already put a link in by hand.
 */
export function recordingCheckDue(state: SessionRecordingState, now = Date.now()): Dueness {
  if (state.recordingUrl || state.status === "ready" || state.status === "manual") {
    return { due: false, reason: "already-have-one" };
  }
  if (state.status === "failed" || state.attempts >= RECORDING_MAX_ATTEMPTS) {
    return { due: false, reason: "gave-up" };
  }
  if (!meetCodeFrom(state.meetUrl)) {
    return { due: false, reason: "no-meet-code" };
  }
  if (state.startsAtMs === null) {
    return { due: false, reason: "not-ended" };
  }

  const endsAtMs = state.startsAtMs + state.durationMins * 60 * 1000;
  if (now < endsAtMs) return { due: false, reason: "not-ended" };
  if (now < endsAtMs + RECORDING_SEARCH_DELAY_MS) return { due: false, reason: "too-soon" };
  if (now > endsAtMs + RECORDING_SEARCH_WINDOW_MS) return { due: false, reason: "window-closed" };

  if (state.lastCheckedAtMs !== null && now - state.lastCheckedAtMs < RECORDING_RETRY_INTERVAL_MS) {
    return { due: false, reason: "backing-off" };
  }
  return { due: true, reason: "" };
}

/** Everything that needs looking at, oldest class first. */
export function sessionsDueForRecording(
  sessions: SessionRecordingState[],
  now = Date.now(),
): SessionRecordingState[] {
  return sessions
    .filter((s) => recordingCheckDue(s, now).due)
    .sort((a, b) => (a.startsAtMs ?? 0) - (b.startsAtMs ?? 0));
}

export type VideoDetails = { title: string; description: string };

/**
 * What the video is called on YouTube.
 *
 * YouTube rejects titles over 100 characters and anything containing angle
 * brackets, so the module title is trimmed rather than the upload failing after
 * the whole file has been sent.
 */
export function videoDetailsFor(args: {
  programTitle: string;
  sessionTitle: string;
  startsAtMs: number | null;
  instructorName?: string | null;
}): VideoDetails {
  const strip = (s: string) => s.replace(/[<>]/g, "").trim();
  const program = strip(args.programTitle);
  const session = strip(args.sessionTitle);

  let title = `${program} — ${session}`;
  if (title.length > 100) {
    const room = 100 - program.length - 3 - 1;
    title = room > 12 ? `${program} — ${session.slice(0, room - 1).trimEnd()}…` : session.slice(0, 99) + "…";
  }

  const when = args.startsAtMs
    ? new Date(args.startsAtMs).toISOString().slice(0, 10)
    : null;

  const description = [
    `${session} — a recorded class from ${program}.`,
    args.instructorName ? `Led by ${args.instructorName}.` : null,
    when ? `Recorded ${when}.` : null,
    "",
    "Ananse Comms Lab. This recording is unlisted and intended for enrolled learners.",
  ]
    .filter((line) => line !== null)
    .join("\n");

  return { title, description };
}

/** The watch URL for a video id, in the form the player already understands. */
export function youtubeUrlFor(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
