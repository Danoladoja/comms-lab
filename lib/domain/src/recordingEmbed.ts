/**
 * Turning a pasted recording link into something that plays inside the Lab.
 *
 * This is a rule with a right answer, and it decides something a learner meets
 * months later: watch time is only counted by the Lab's own player, and watch
 * time is how somebody who missed the live class completes the module. A
 * recording that opens somewhere else plays perfectly well and counts for
 * nothing — and nobody finds out until the next module refuses to open.
 *
 * The link is picked apart with a pattern rather than the browser's own URL
 * reader, because these rules run on the server too, where there is no browser.
 */

type Parts = { host: string; path: string; query: string };

function partsOf(url: string): Parts | null {
  const m = /^https?:\/\/([^/?#\s]+)([^?#\s]*)(?:\?([^#\s]*))?/i.exec(url.trim());
  if (!m) return null;
  return {
    host: m[1].toLowerCase().replace(/^www\./, ""),
    path: m[2] ?? "",
    query: m[3] ?? "",
  };
}

/** A YouTube id, as far as anything can tell from the outside. */
const looksLikeId = (id: string) => /^[A-Za-z0-9_-]{6,}$/.test(id);

const firstSegment = (path: string) => path.split("/").filter(Boolean)[0] ?? "";

export type Embed = { kind: "iframe" | "video"; src: string };

/**
 * The embeddable form of a recording link, or null when we do not recognise it.
 *
 * YouTube first, because that is what the Lab asks facilitators for; Vimeo,
 * Loom and plain video files after, because people paste them anyway and a
 * recording that plays is better than a dead link.
 */
export function toEmbedUrl(url: string): Embed | null {
  const parts = partsOf(url);
  if (!parts) return null;
  const { host, path, query } = parts;

  if (host === "youtu.be") {
    const id = firstSegment(path);
    if (looksLikeId(id)) return { kind: "iframe", src: `https://www.youtube.com/embed/${id}` };
  }

  if (host === "youtube.com" || host === "m.youtube.com") {
    // Either ?v=… however many other parameters follow it, or an /embed/ link
    // somebody has already converted.
    const fromQuery = /(?:^|&)v=([^&]+)/.exec(query)?.[1] ?? "";
    const fromPath = path.startsWith("/embed/") ? path.slice("/embed/".length).split("/")[0] : "";
    const id = fromQuery || fromPath;
    if (looksLikeId(id)) return { kind: "iframe", src: `https://www.youtube.com/embed/${id}` };
  }

  if (host === "vimeo.com") {
    const id = firstSegment(path);
    if (/^\d+$/.test(id)) return { kind: "iframe", src: `https://player.vimeo.com/video/${id}` };
  }

  if (host === "loom.com" && path.startsWith("/share/")) {
    const id = path.slice("/share/".length).split("/")[0];
    if (id) return { kind: "iframe", src: `https://www.loom.com/embed/${id}` };
  }

  if (/\.(mp4|webm|m3u8)$/i.test(path)) return { kind: "video", src: url.trim() };

  return null;
}

/**
 * Can watch time be measured in this recording?
 *
 * Only YouTube and direct video files report playback position. A Vimeo or Loom
 * link plays perfectly and counts for nothing — so the admin is told at the
 * moment they paste it, rather than the learner three weeks later.
 *
 * The single source of truth for this question: the player and the admin form
 * must never disagree about what will count.
 */
export function isMeasurableRecording(url: string): boolean {
  const embed = toEmbedUrl(url);
  if (!embed) return false;
  return embed.kind === "video" || embed.src.includes("youtube.com/embed/");
}
