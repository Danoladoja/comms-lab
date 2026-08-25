/**
 * Moving one recording from Drive to YouTube.
 *
 * The video is streamed straight from Drive into YouTube's upload — never
 * written to disk and never held in memory. An hour of class video is easily a
 * gigabyte, and the server this runs on has neither the disk nor the headroom
 * to buffer that.
 */

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const YOUTUBE_UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos";

export type DriveFile = { id: string; name: string; sizeBytes: number | null; mimeType: string };

export async function getDriveFile(accessToken: string, fileId: string): Promise<DriveFile> {
  const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,size,mimeType");
  url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Could not read the recording from Drive (${res.status})`);
  }
  const json = (await res.json()) as { id: string; name: string; size?: string; mimeType: string };
  return {
    id: json.id,
    name: json.name,
    sizeBytes: json.size ? Number(json.size) : null,
    mimeType: json.mimeType,
  };
}

async function openDriveStream(accessToken: string, fileId: string): Promise<ReadableStream<Uint8Array>> {
  const url = new URL(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("alt", "media");
  url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok || !res.body) {
    throw new Error(`Could not download the recording from Drive (${res.status})`);
  }
  return res.body;
}

/**
 * Copy a Drive file onto YouTube as an unlisted video, returning the video id.
 *
 * YouTube's resumable upload is used in two steps — reserve a slot with the
 * details, then send the bytes — because a plain upload of a file this size
 * fails far too readily.
 */
export async function transferToYouTube(args: {
  accessToken: string;
  driveFileId: string;
  title: string;
  description: string;
}): Promise<string> {
  const { accessToken, driveFileId, title, description } = args;

  const file = await getDriveFile(accessToken, driveFileId);

  const metadata = {
    snippet: {
      title,
      description,
      // 27 is "Education". Category is required.
      categoryId: "27",
    },
    status: {
      privacyStatus: "unlisted",
      // YouTube refuses uploads that do not state this either way.
      selfDeclaredMadeForKids: false,
    },
  };

  const startRes = await fetch(`${YOUTUBE_UPLOAD}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "X-Upload-Content-Type": file.mimeType || "video/mp4",
      ...(file.sizeBytes ? { "X-Upload-Content-Length": String(file.sizeBytes) } : {}),
    },
    body: JSON.stringify(metadata),
  });

  if (!startRes.ok) {
    const body = await startRes.text();
    throw new Error(`YouTube would not start the upload (${startRes.status}): ${body.slice(0, 300)}`);
  }

  const uploadUrl = startRes.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return an upload location");

  const source = await openDriveStream(accessToken, driveFileId);

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": file.mimeType || "video/mp4",
      ...(file.sizeBytes ? { "content-length": String(file.sizeBytes) } : {}),
    },
    body: source,
    // Required by Node's fetch when the body is a stream.
    duplex: "half",
  } as RequestInit & { duplex: "half" });

  if (!uploadRes.ok) {
    const body = await uploadRes.text();
    throw new Error(`YouTube rejected the upload (${uploadRes.status}): ${body.slice(0, 300)}`);
  }

  const uploaded = (await uploadRes.json()) as { id?: string };
  if (!uploaded.id) throw new Error("YouTube accepted the upload but returned no video id");
  return uploaded.id;
}
