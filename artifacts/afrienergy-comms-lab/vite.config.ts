import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'fs';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import {
  buildCertificateMeta,
  fetchCertificate,
  injectMeta,
  requestOrigin,
  resolveApiBases,
} from '@workspace/og';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';
import {
  renderCertificateImage,
} from '@workspace/og';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

/**
 * Dev-server middleware that mirrors the production OG injection for
 * /verify/:certificateId, so crawlers hitting the dev preview also see
 * certificate-specific Open Graph tags.
 */
function certificateOgPlugin(): Plugin {
  return {
    name: 'certificate-og-meta',
    configureServer(server: ViteDevServer) {
      const base = basePath!.endsWith('/') ? basePath! : `${basePath}/`;
      const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}verify/([^/?#]+)`);
      const imagePattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}verify/([^/?#]+)/og-image\\.png`);
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== 'GET') return next();
        const imageMatch = imagePattern.exec(req.url ?? '');
        if (imageMatch) {
          const cert = await fetchCertificate(decodeURIComponent(imageMatch[1]), resolveApiBases(req));
          const image = cert
            ? renderCertificateImage(cert)
            : fs.readFileSync(path.resolve(import.meta.dirname, 'public', 'og-certificate.png'));
          res.statusCode = 200;
          res.setHeader('Content-Type', 'image/png');
          res.setHeader(
            'Cache-Control',
            cert ? 'public, max-age=86400, stale-while-revalidate=604800' : 'public, max-age=300',
          );
          res.end(image);
          return;
        }
        const match = pattern.exec(req.url ?? '');
        if (!match || !(req.headers.accept ?? '').includes('text/html')) return next();
        try {
          const cert = await fetchCertificate(decodeURIComponent(match[1]), resolveApiBases(req));
          const raw = fs.readFileSync(path.resolve(import.meta.dirname, 'index.html'), 'utf8');
          let html = await server.transformIndexHtml(req.url!, raw);
          if (cert) {
            html = injectMeta(html, buildCertificateMeta(cert, requestOrigin(req), base));
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html');
          res.end(html);
        } catch (e) {
          next(e);
        }
      });
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    certificateOgPlugin(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
