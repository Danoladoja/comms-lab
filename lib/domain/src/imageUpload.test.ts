import { describe, expect, it } from "vitest";
import {
  MAX_THUMBNAIL_BYTES,
  checkThumbnail,
  isStoredThumbnail,
  sniffImageType,
  thumbnailPath,
} from "./imageUpload";

/** Build a buffer that begins with `signature` and is padded to a real size. */
function file(signature: number[], size = 1024): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(signature.slice(0, size));
  return bytes;
}

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];

function webp(): Uint8Array {
  const bytes = new Uint8Array(1024);
  bytes.set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP" at offset 8
  return bytes;
}

function ascii(text: string, size = 1024): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < text.length && i < size; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

describe("sniffImageType", () => {
  it("recognises the formats we accept", () => {
    expect(sniffImageType(file(JPEG))?.mimeType).toBe("image/jpeg");
    expect(sniffImageType(file(PNG))?.mimeType).toBe("image/png");
    expect(sniffImageType(webp())?.mimeType).toBe("image/webp");
    expect(sniffImageType(file(GIF89))?.mimeType).toBe("image/gif");
    expect(sniffImageType(file(GIF87))?.mimeType).toBe("image/gif");
  });

  it("refuses SVG, however it is dressed up", () => {
    // The whole reason this function exists. An SVG is XML that may carry
    // script, and we serve thumbnails from our own origin to signed-in people.
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImageType(ascii('<?xml version="1.0"?><svg></svg>'))).toBeNull();
    expect(sniffImageType(ascii("   \n\t<svg>"))).toBeNull();
  });

  it("refuses HTML and scripts", () => {
    expect(sniffImageType(ascii("<!DOCTYPE html><html><body>hi"))).toBeNull();
    expect(sniffImageType(ascii("<html>"))).toBeNull();
    expect(sniffImageType(ascii("#!/bin/sh\nrm -rf /"))).toBeNull();
  });

  it("refuses other real file types that are not images we serve", () => {
    expect(sniffImageType(ascii("%PDF-1.7"))).toBeNull();
    expect(sniffImageType(file([0x50, 0x4b, 0x03, 0x04])))?.toBeNull?.(); // zip / pptx
    expect(sniffImageType(file([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
  });

  it("is not fooled by a near-miss signature", () => {
    // PNG's signature includes a CR/LF pair; a file mangled in transfer fails.
    expect(sniffImageType(file([0x89, 0x50, 0x4e, 0x47, 0x0a, 0x1a, 0x0a]))).toBeNull();
    // RIFF without the WEBP tag is some other RIFF container, such as a WAV.
    const riffOnly = new Uint8Array(1024);
    riffOnly.set([0x52, 0x49, 0x46, 0x46]);
    expect(sniffImageType(riffOnly)).toBeNull();
  });

  it("does not read past the end of a very short file", () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0xff]))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46]))).toBeNull();
  });
});

describe("checkThumbnail", () => {
  it("accepts a real image and reports its type and size", () => {
    const result = checkThumbnail(file(PNG, 2048));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.type.mimeType).toBe("image/png");
      expect(result.sizeBytes).toBe(2048);
    }
  });

  it("refuses an empty file", () => {
    const result = checkThumbnail(new Uint8Array([]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/empty/i);
  });

  it("refuses a file too large to be sensible", () => {
    const result = checkThumbnail(file(PNG, MAX_THUMBNAIL_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/MB/);
  });

  it("accepts a file exactly on the limit", () => {
    expect(checkThumbnail(file(PNG, MAX_THUMBNAIL_BYTES)).ok).toBe(true);
  });

  it("explains what to upload when the file is not an image", () => {
    const result = checkThumbnail(ascii("<svg><script>alert(1)</script></svg>"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/JPEG, PNG, WebP or GIF/);
  });
});

describe("thumbnailPath", () => {
  it("is a path, not a full address, so it works on any host", () => {
    expect(thumbnailPath(7)).toBe("/api/programs/7/thumbnail");
  });

  it("carries a version so a replaced image is not hidden by the browser cache", () => {
    const path = thumbnailPath(7, "2026-08-31T10:00:00.000Z");
    expect(path).toContain("/api/programs/7/thumbnail?v=");
    expect(path).toContain(encodeURIComponent("2026-08-31T10:00:00.000Z"));
  });

  it("round-trips through the recogniser", () => {
    expect(isStoredThumbnail(thumbnailPath(7))).toBe(true);
    expect(isStoredThumbnail(thumbnailPath(7, "123"))).toBe(true);
  });
});

describe("isStoredThumbnail", () => {
  it("tells an uploaded image apart from a pasted link", () => {
    expect(isStoredThumbnail("https://example.com/photo.jpg")).toBe(false);
    expect(isStoredThumbnail("")).toBe(false);
    expect(isStoredThumbnail(null)).toBe(false);
    expect(isStoredThumbnail(undefined)).toBe(false);
    // Not ours: a lookalike path on somebody else's host.
    expect(isStoredThumbnail("https://evil.example/api/programs/1/thumbnail")).toBe(false);
  });
});
