/** Turn a pasted recording link into an embeddable URL when we recognise the
 *  platform (YouTube first, plus vimeo/loom/plain video files); otherwise the
 *  recording opens in a new tab. */
export function toEmbedUrl(url: string): { kind: 'iframe' | 'video'; src: string } | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return { kind: 'iframe', src: `https://www.youtube.com/embed/${u.pathname.slice(1)}` };
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const id = u.searchParams.get('v') ?? (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : null);
      if (id) return { kind: 'iframe', src: `https://www.youtube.com/embed/${id}` };
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return { kind: 'iframe', src: `https://player.vimeo.com/video/${id}` };
    }
    if (host === 'loom.com' && u.pathname.startsWith('/share/')) {
      return { kind: 'iframe', src: `https://www.loom.com/embed/${u.pathname.split('/')[2]}` };
    }
    if (/\.(mp4|webm|m3u8)$/i.test(u.pathname)) return { kind: 'video', src: url };
  } catch { /* fall through */ }
  return null;
}
