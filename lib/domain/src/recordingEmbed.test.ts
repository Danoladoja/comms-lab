import { describe, expect, it } from 'vitest';
import { toEmbedUrl, isMeasurableRecording } from "./recordingEmbed";

/**
 * A recording has to play inside the Lab.
 *
 * Not for tidiness. Watch time is only counted by the Lab's own player, and
 * watch time is how a learner who missed the live class completes the module.
 * A recording that opens somewhere else plays perfectly and counts for nothing,
 * and the learner finds out weeks later when the next module will not open.
 *
 * So the two questions worth pinning down are: can this link be embedded, and
 * will watching it actually count.
 */

// The real link from the Lab's first module, pasted as YouTube's share button
// gives it.
const SHARED = 'https://youtu.be/u_miyGwxEEU';

describe('a YouTube link', () => {
  it('embeds however it was copied', () => {
    for (const url of [
      SHARED,
      'https://www.youtube.com/watch?v=u_miyGwxEEU',
      'https://youtube.com/watch?v=u_miyGwxEEU&t=90',
      'https://m.youtube.com/watch?v=u_miyGwxEEU',
    ]) {
      expect(toEmbedUrl(url)).toEqual({
        kind: 'iframe',
        src: 'https://www.youtube.com/embed/u_miyGwxEEU',
      });
    }
  });

  it('counts towards finishing the module', () => {
    expect(isMeasurableRecording(SHARED)).toBe(true);
  });
});

describe('everything else', () => {
  it('plays a video file directly, and counts', () => {
    const url = 'https://cdn.example.org/class-one.mp4';
    expect(toEmbedUrl(url)).toEqual({ kind: 'video', src: url });
    expect(isMeasurableRecording(url)).toBe(true);
  });

  it('embeds Vimeo and Loom but does not pretend they count', () => {
    // They play. Nothing reports back. The admin is warned at the moment they
    // paste one, rather than the learner three weeks later.
    for (const url of ['https://vimeo.com/76979871', 'https://www.loom.com/share/abc123']) {
      expect(toEmbedUrl(url)?.kind).toBe('iframe');
      expect(isMeasurableRecording(url)).toBe(false);
    }
  });

  it('refuses to guess at a link it does not recognise', () => {
    for (const url of ['https://example.org/some/page', 'not a link at all', '']) {
      expect(toEmbedUrl(url)).toBeNull();
      expect(isMeasurableRecording(url)).toBe(false);
    }
  });
});
