import { isOpenableMeetUrl, normaliseMeetUrl } from '@workspace/domain';

/**
 * Send a learner to their class.
 *
 * The last gate before a browser travels. A link with no scheme is not an
 * address but a path, so `window.open` would resolve it against this site and
 * land the learner on a 404 — which is exactly what a cohort reported as "the
 * Google link is broken". Anything that cannot be repaired into a real address
 * is refused here, and the caller says so, because telling somebody the link
 * needs fixing beats sending them somewhere that does not exist.
 *
 * Returns whether the class actually opened.
 */
export function openJoinLink(raw: string | null | undefined): boolean {
  const url = normaliseMeetUrl(raw);
  if (!url || !isOpenableMeetUrl(url)) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
