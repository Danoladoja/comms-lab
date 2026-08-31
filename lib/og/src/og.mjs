// Shared Open Graph meta-tag helpers for the /verify/:certificateId route.
// Used by the production server (server/index.mjs) and the Vite dev plugin.

const META_START = '<!-- og-meta:start -->';
const META_END = '<!-- og-meta:end -->';

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Derive the public origin (scheme + host) from the incoming request headers. */
export function requestOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${String(proto).split(',')[0]}://${String(host).split(',')[0]}`;
}

/**
 * Candidate API origins, most explicit first:
 * 1. API_ORIGIN env (set in artifact.toml for production).
 * 2. The API service's local port (API_PORT, default 8080 — the api-server
 *    artifact's configured port in both dev and production).
 * 3. The deployment's published domain(s) via REPLIT_DOMAINS (routes /api
 *    through the shared proxy).
 * 4. The origin of the incoming request itself.
 * Network-level failures move on to the next candidate; any HTTP response
 * (including 404) is authoritative and stops the chain.
 */
export function resolveApiBases(req) {
  const bases = [];
  if (process.env.API_ORIGIN) bases.push(process.env.API_ORIGIN);
  bases.push(`http://127.0.0.1:${process.env.API_PORT || 8080}`);
  const domains = (process.env.REPLIT_DOMAINS || '').split(',').filter(Boolean);
  for (const d of domains) bases.push(`https://${d.trim()}`);
  if (req) bases.push(requestOrigin(req));
  return [...new Set(bases)].map((b) => `${b.replace(/\/$/, '')}/api`);
}

/**
 * Fetch the public certificate verification payload from the API server,
 * trying each candidate base in order. Returns the certificate object, or
 * null when the ID is invalid/unearned or no API endpoint can be reached
 * (callers fall back to generic metadata).
 */
export async function fetchCertificate(certificateId, apiBases) {
  for (const base of apiBases) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(
        `${base}/certificates/${encodeURIComponent(certificateId)}/verify`,
        { signal: controller.signal },
      );
      clearTimeout(timer);
      if (!res.ok) return null; // authoritative answer: not a valid certificate
      return await res.json();
    } catch {
      // network failure — try the next candidate
    }
  }
  return null;
}

/** Build the meta-tag block for a verified certificate. */
export function buildCertificateMeta(cert, origin, basePath = '/') {
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const title = `Certificate of Completion — ${cert.programTitle}`;
  const completed = cert.completedAt
    ? ` on ${new Date(cert.completedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : '';
  const description =
    `${cert.learnerName} completed the ${cert.programTitle} program at Afrienergy Comms Lab${completed}. ` +
    `Verified certificate ${cert.certificateId}.`;
  const image = `${origin}${base}verify/${encodeURIComponent(cert.certificateId)}/og-image.png`;
  const url = `${origin}${base}verify/${cert.certificateId}`;
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:site_name" content="Afrienergy Comms Lab" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
  ].join('\n    ');
}

/**
 * Replace the marked default meta block in the HTML shell with the given
 * meta HTML. Returns the HTML unchanged when the markers are missing.
 */
export function injectMeta(html, metaHtml) {
  const start = html.indexOf(META_START);
  const end = html.indexOf(META_END);
  if (start === -1 || end === -1 || end < start) return html;
  return html.slice(0, start) + META_START + '\n    ' + metaHtml + '\n    ' + html.slice(end);
}
