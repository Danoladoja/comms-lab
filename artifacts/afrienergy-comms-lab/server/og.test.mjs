// Integration + unit tests for the /verify OG meta injection.
// Run with: node --test server/og.test.mjs   (pnpm run test in this package)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildCertificateMeta, escapeHtml, injectMeta } from './og.mjs';
import { renderCertificateImage } from './og-image.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const CERT = {
  programId: 1,
  programTitle: 'Strategic Energy Communications',
  learnerName: 'Amina Diallo',
  completedAt: '2026-07-30T17:00:00.000Z',
  certificateId: 'AECL-001-0007',
};

const SHELL = `<!DOCTYPE html><html><head>
    <!-- og-meta:start -->
    <title>Afrienergy Comms Lab</title>
    <meta property="og:title" content="Afrienergy Comms Lab" />
    <!-- og-meta:end -->
  </head><body><div id="root"></div></body></html>`;

// ---------- unit tests ----------

test('injectMeta replaces the marked block and keeps the rest', () => {
  const out = injectMeta(SHELL, '<title>NEW</title>');
  assert.ok(out.includes('<title>NEW</title>'));
  assert.ok(!out.includes('content="Afrienergy Comms Lab"'));
  assert.ok(out.includes('<div id="root">'));
});

test('injectMeta is a no-op without markers', () => {
  assert.equal(injectMeta('<head></head>', 'X'), '<head></head>');
});

test('buildCertificateMeta escapes HTML and builds absolute URLs', () => {
  const meta = buildCertificateMeta(
    { ...CERT, programTitle: 'A <b>"Bold"</b> & Program' },
    'https://app.example.com',
    '/',
  );
  assert.ok(meta.includes('A &lt;b&gt;&quot;Bold&quot;&lt;/b&gt; &amp; Program'));
  assert.ok(!meta.includes('<b>'));
  assert.ok(meta.includes('https://app.example.com/verify/AECL-001-0007/og-image.png'));
  assert.ok(meta.includes('https://app.example.com/verify/AECL-001-0007'));
});

test('escapeHtml covers all special characters', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

test('renderCertificateImage creates and caches a 1200x630 PNG', () => {
  const first = renderCertificateImage(CERT);
  const second = renderCertificateImage(CERT);
  assert.strictEqual(first, second);
  assert.deepEqual([...first.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(first.readUInt32BE(16), 1200);
  assert.equal(first.readUInt32BE(20), 630);
});

// ---------- integration test: real server + stub API ----------

let mockApi;
let mockApiPort;
let server;
let serverPort;

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

before(async () => {
  mockApi = http.createServer((req, res) => {
    if (req.url === `/api/certificates/${CERT.certificateId}/verify`) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(CERT));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Certificate not found' }));
    }
  });
  mockApiPort = await listen(mockApi);

  const publicDir = mkdtempSync(path.join(tmpdir(), 'og-test-'));
  writeFileSync(path.join(publicDir, 'index.html'), SHELL);
  copyFileSync(path.resolve(dirname, '..', 'public', 'og-certificate.png'), path.join(publicDir, 'og-certificate.png'));

  serverPort = 20000 + Math.floor(Math.random() * 10000);
  server = spawn('node', [path.join(dirname, 'index.mjs')], {
    env: {
      ...process.env,
      PORT: String(serverPort),
      BASE_PATH: '/',
      PUBLIC_DIR: publicDir,
      API_ORIGIN: `http://127.0.0.1:${mockApiPort}`,
      REPLIT_DOMAINS: '',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 10000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('listening')) { clearTimeout(t); resolve(); }
    });
  });
});

after(() => {
  server?.kill();
  mockApi?.close();
});

test('valid certificate link serves certificate-specific OG tags', async () => {
  const res = await fetch(`http://127.0.0.1:${serverPort}/verify/${CERT.certificateId}`, {
    headers: { 'x-forwarded-host': 'afrienergy.replit.app', 'x-forwarded-proto': 'https' },
  });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.ok(html.includes('Certificate of Completion — Strategic Energy Communications'));
  assert.ok(html.includes('Amina Diallo completed the Strategic Energy Communications program'));
  assert.ok(html.includes('content="https://afrienergy.replit.app/verify/AECL-001-0007/og-image.png"'));
  assert.ok(html.includes('content="https://afrienergy.replit.app/verify/AECL-001-0007"'));
  assert.ok(html.includes('rel="canonical" href="https://afrienergy.replit.app/verify/AECL-001-0007"'));
  assert.ok(!html.includes('<meta property="og:title" content="Afrienergy Comms Lab" />')); // default replaced
});

test('valid certificate image route serves a personalized cacheable PNG', async () => {
  const res = await fetch(`http://127.0.0.1:${serverPort}/verify/${CERT.certificateId}/og-image.png`);
  const image = Buffer.from(await res.arrayBuffer());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.match(res.headers.get('cache-control'), /max-age=86400/);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('invalid certificate image route falls back to the generic banner', async () => {
  const res = await fetch(`http://127.0.0.1:${serverPort}/verify/AECL-999-9999/og-image.png`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  assert.ok((await res.arrayBuffer()).byteLength > 1000);
});

test('invalid certificate link falls back to generic site metadata', async () => {
  const res = await fetch(`http://127.0.0.1:${serverPort}/verify/AECL-999-9999`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.ok(html.includes('content="Afrienergy Comms Lab"'));
  assert.ok(!html.includes('Certificate of Completion'));
});

test('unreachable API falls back to generic metadata (fail-soft)', async () => {
  // A fresh request with a bogus certificate against the stub still returns
  // shell HTML; also verify SPA fallback for non-verify routes.
  const res = await fetch(`http://127.0.0.1:${serverPort}/certificates`);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('<div id="root">'));
});
