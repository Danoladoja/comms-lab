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

/* ------------------------------------------------------------------ *
 * Transcripts
 * ------------------------------------------------------------------ */

/**
 * One transcript of one conference.
 *
 * Meet writes a Google Doc per transcribed conference and hands back its id.
 * `entries` on the API give the same thing as structured turns — speaker and
 * text — which is the better source for drafting, since a Doc has to be
 * exported and parsed. Both routes need the transcript to exist in the first
 * place, which is the part nobody can assume: somebody has to have started it,
 * or an administrator has to have turned on automatic transcription.
 */
export type MeetTranscript = {
  /** conferenceRecords/{record}/transcripts/{transcript} — the handle for the entries. */
  name: string;
  state: string;
  startTime: string | null;
  endTime: string | null;
  /** The Google Doc, when one has been written. */
  documentId: string | null;
  exportUri: string | null;
};

/** What Google actually holds for one class. Nothing here writes anything. */
export type MeetHoldings = {
  /** Times this room was used inside the window. Zero means the class did not happen here. */
  conferences: number;
  recordings: MeetRecording[];
  transcripts: MeetTranscript[];
};

/**
 * Everything Google has for a meeting code in a window: conferences, their
 * recordings and their transcripts, in one pass.
 *
 * Read-only by construction — every call here is a GET — because the first
 * question about a live cohort's records is "what is actually there", and that
 * question should be answerable without risking an answer that changes it.
 */
export async function findHoldings(args: {
  accessToken: string;
  meetCode: string;
  windowStartMs: number;
  windowEndMs: number;
}): Promise<MeetHoldings> {
  const { accessToken, meetCode, windowStartMs, windowEndMs } = args;

  const space = await meetGet<{ name?: string }>(accessToken, `spaces/${encodeURIComponent(meetCode)}`);
  if (!space.name) return { conferences: 0, recordings: [], transcripts: [] };

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
  const transcripts: MeetTranscript[] = [];

  for (const conference of inWindow) {
    const recorded = await meetGet<{
      recordings?: {
        state?: string;
        startTime?: string;
        endTime?: string;
        driveDestination?: { file?: string };
      }[];
    }>(accessToken, `${conference.name}/recordings`);

    for (const recording of recorded.recordings ?? []) {
      const fileId = recording.driveDestination?.file;
      if (!fileId || recording.state !== "FILE_GENERATED") continue;
      recordings.push({
        driveFileId: fileId,
        state: recording.state,
        startTime: recording.startTime ?? null,
        endTime: recording.endTime ?? null,
      });
    }

    const written = await meetGet<{
      transcripts?: {
        name?: string;
        state?: string;
        startTime?: string;
        endTime?: string;
        docsDestination?: { document?: string; exportUri?: string };
      }[];
    }>(accessToken, `${conference.name}/transcripts`);

    for (const transcript of written.transcripts ?? []) {
      if (!transcript.name) continue;
      // Unlike recordings, a transcript that has not finished writing is still
      // worth reporting: it tells an admin transcription was on, which is the
      // thing they are usually trying to find out.
      transcripts.push({
        name: transcript.name,
        state: transcript.state ?? "STATE_UNSPECIFIED",
        startTime: transcript.startTime ?? null,
        endTime: transcript.endTime ?? null,
        documentId: transcript.docsDestination?.document ?? null,
        exportUri: transcript.docsDestination?.exportUri ?? null,
      });
    }
  }

  return { conferences: inWindow.length, recordings, transcripts };
}
