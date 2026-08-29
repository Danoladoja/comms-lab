/**
 * Finding the recording that belongs to a particular class.
 *
 * Filename matching would be guesswork — two classes on the same day, a
 * renamed file, a facilitator's own recording sitting in the same folder. The
 * Meet API removes the guessing: a meeting code identifies a space, a space has
 * conference records (one per time the room was used), and each record lists
 * its recordings with the exact Drive file.
 */

const MEET_API = "https://meet.googleapis.com/v2";

export type MeetRecording = {
  /** The Drive file holding the video. */
  driveFileId: string;
  state: string;
  startTime: string | null;
  endTime: string | null;
};

async function meetGet<T>(accessToken: string, path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${MEET_API}/${path}`);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meet API ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * The finished recordings for a meeting code, from conferences that started
 * within the given window.
 *
 * The window matters: a room reused week after week accumulates conference
 * records, and last week's class must not be published as this week's replay.
 */
export async function findRecordings(args: {
  accessToken: string;
  meetCode: string;
  windowStartMs: number;
  windowEndMs: number;
}): Promise<MeetRecording[]> {
  const { accessToken, meetCode, windowStartMs, windowEndMs } = args;

  // A meeting code resolves to a space; conference records hang off its name.
  const space = await meetGet<{ name?: string }>(accessToken, `spaces/${encodeURIComponent(meetCode)}`);
  if (!space.name) return [];

  const conferences = await meetGet<{
    conferenceRecords?: { name: string; startTime?: string; endTime?: string }[];
  }>(accessToken, "conferenceRecords", {
    filter: `space.name="${space.name}"`,
    pageSize: "20",
  });

  const inWindow = (conferences.conferenceRecords ?? []).filter((c) => {
    if (!c.startTime) return false;
    const started = new Date(c.startTime).getTime();
    return started >= windowStartMs && started <= windowEndMs;
  });

  const recordings: MeetRecording[] = [];
  for (const conference of inWindow) {
    const result = await meetGet<{
      recordings?: {
        state?: string;
        startTime?: string;
        endTime?: string;
        driveDestination?: { file?: string };
      }[];
    }>(accessToken, `${conference.name}/recordings`);

    for (const recording of result.recordings ?? []) {
      const fileId = recording.driveDestination?.file;
      // FILE_GENERATED is Meet saying the video is written and complete;
      // anything else is still in progress and would download as a stub.
      if (!fileId || recording.state !== "FILE_GENERATED") continue;
      recordings.push({
        driveFileId: fileId,
        state: recording.state,
        startTime: recording.startTime ?? null,
        endTime: recording.endTime ?? null,
      });
    }
  }

  // Longest first: if a host started and stopped recording, the substantial
  // take is the class.
  return recordings.sort((a, b) => durationOf(b) - durationOf(a));
}

function durationOf(r: MeetRecording): number {
  if (!r.startTime || !r.endTime) return 0;
  return new Date(r.endTime).getTime() - new Date(r.startTime).getTime();
}
