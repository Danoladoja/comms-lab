// Production server for the Afrienergy Comms Lab SPA.
// Serves the built static bundle from dist/public and injects certificate
// Open Graph meta tags into the HTML shell for /verify/:certificateId so
// link crawlers (LinkedIn, etc.) see a rich preview. Invalid or unearned
// certificate IDs fall back to the generic site metadata baked into the shell.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import {
  buildCertificateMeta,
  fetchCertificate,
  injectMeta,
  requestOrigin,
  resolveApiBases,
} from './og.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// PUBLIC_DIR override exists for integration tests; production uses dist/public.
const publicDir = process.env.PUBLIC_DIR
  ? path.resolve(process.env.PUBLIC_DIR)
  : path.resolve(dirname, '..', 'dist', 'public');
const indexHtml = readFileSync(path.join(publicDir, 'index.html'), 'utf8');

const rawPort = process.env.PORT;
if (!rawPort || Number.isNaN(Number(rawPort))) {
  throw new Error(`PORT environment variable is required (got "${rawPort}")`);
}
const basePath = process.env.BASE_PATH || '/';
const base = basePath.endsWith('/') ? basePath : `${basePath}/`;

const app = express();
app.disable('x-powered-by');

// OG-injected HTML shell for certificate verification links.
app.get(`${base}verify/:certificateId`, async (req, res) => {
  const cert = await fetchCertificate(req.params.certificateId, resolveApiBases(req));
  let html = indexHtml;
  if (cert) {
    html = injectMeta(html, buildCertificateMeta(cert, requestOrigin(req), base));
  }
  res.status(200).type('html').send(html);
});

// Static assets, then SPA fallback for all other GET routes.
app.use(base, express.static(publicDir, { index: 'index.html' }));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.status(200).type('html').send(indexHtml);
});

app.listen(Number(rawPort), '0.0.0.0', () => {
  console.log(`web server listening on ${rawPort} (base ${base})`);
});
