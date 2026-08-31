/**
 * Deciding whether an uploaded file is really an image.
 *
 * A programme thumbnail is the one file this application takes from a person
 * and then serves back to the public, unauthenticated, from its own domain.
 * That makes it worth more care than its size suggests.
 *
 * Two rules follow, and both are enforced here rather than at the route, so
 * they can be tested without a database or a network:
 *
 * The type is read from the file's own first bytes, never from the header the
 * uploader sent. A caller controls that header completely; they do not control
 * what a PNG looks like.
 *
 * SVG is refused even though it is a perfectly good image format. An SVG is
 * XML, it may carry <script>, and a browser shown one from our own origin runs
 * that script with our origin's privileges. The gain — sharper logos on a
 * thumbnail nobody will zoom into — is not worth handing the site a way to be
 * turned against the people signed into it.
 */

export const MAX_THUMBNAIL_BYTES = 3 * 1024 * 1024;
export const MIN_THUMBNAIL_BYTES = 64;

export type ImageType = {
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  extension: "jpg" | "png" | "webp" | "gif";
};

const TYPES: ImageType[] = [
  { mimeType: "image/jpeg", extension: "jpg" },
  { mimeType: "image/png", extension: "png" },
  { mimeType: "image/webp", extension: "webp" },
  { mimeType: "image/gif", extension: "gif" },
];

/** What a person may be told to upload, in the order the file picker lists it. */
export const ACCEPTED_IMAGE_MIME = TYPES.map((t) => t.mimeType).join(",");
export const ACCEPTED_IMAGE_LABEL = "JPEG, PNG, WebP or GIF";

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Identify an image from its leading bytes.
 *
 * Returns null for anything not recognised, which includes SVG, HTML, a PDF
 * renamed to .png, and an empty file. Null always means "refuse it".
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  // JPEG: SOI marker.
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return TYPES[0];

  // PNG: the 8-byte signature, including the CR/LF pair that catches files
  // mangled by a text-mode transfer.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return TYPES[1];

  // WebP: "RIFF" .... "WEBP" — both halves, or a plain RIFF container passes.
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return TYPES[2];
  }

  // GIF: "GIF87a" or "GIF89a".
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return TYPES[3];
  }

  return null;
}

export type ThumbnailRejection = { ok: false; problem: string };
export type ThumbnailAcceptance = { ok: true; type: ImageType; sizeBytes: number };
export type ThumbnailCheck = ThumbnailAcceptance | ThumbnailRejection;

/**
 * Check an uploaded thumbnail before it is stored.
 *
 * Every refusal is a sentence an admin can act on. "Unsupported media type"
 * tells somebody who just tried to upload a screenshot nothing at all.
 */
export function checkThumbnail(bytes: Uint8Array): ThumbnailCheck {
  if (bytes.length === 0) {
    return { ok: false, problem: "That file was empty." };
  }
  if (bytes.length < MIN_THUMBNAIL_BYTES) {
    return { ok: false, problem: "That file is too small to be an image." };
  }
  if (bytes.length > MAX_THUMBNAIL_BYTES) {
    const mb = (MAX_THUMBNAIL_BYTES / 1024 / 1024).toFixed(0);
    return { ok: false, problem: `Images must be under ${mb}MB. Try saving it at a smaller size.` };
  }

  const type = sniffImageType(bytes);
  if (!type) {
    return { ok: false, problem: `That does not look like an image. Use ${ACCEPTED_IMAGE_LABEL}.` };
  }

  return { ok: true, type, sizeBytes: bytes.length };
}

/**
 * Where a stored thumbnail is served from.
 *
 * A path rather than a full address, so the same stored value works on the
 * live domain, on a preview deployment and on a laptop. It is written into the
 * programme's `thumbnailUrl`, which means every page already showing that field
 * displays uploaded images with no change at all.
 */
export function thumbnailPath(programId: number, version: string | number = ""): string {
  const v = String(version).trim();
  // The version is the row's updated time. Without it a replaced image would
  // sit behind whatever the browser cached, and the admin would swear the
  // upload had not worked.
  return v ? `/api/programs/${programId}/thumbnail?v=${encodeURIComponent(v)}` : `/api/programs/${programId}/thumbnail`;
}

/** True when a programme's thumbnail is one we stored, rather than a pasted link. */
export function isStoredThumbnail(url: string | null | undefined): boolean {
  return typeof url === "string" && /^\/api\/programs\/\d+\/thumbnail(\?|$)/.test(url);
}
