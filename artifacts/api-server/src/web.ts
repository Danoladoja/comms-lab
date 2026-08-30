import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import express, { type IRouter, Router } from "express";
import {
  buildCertificateMeta,
  fetchCertificate,
  injectMeta,
  requestOrigin,
  renderCertificateImage,
} from "@workspace/og";
import { logger } from "./lib/logger";

/**
 * Serving the built web app from the same process as the API.
 *
 * The browser calls the API at `/api/...` on its own origin. Split across two
 * hosts those calls land on the web server, which has no `/api` route, and the
 * app is dead on arrival — signed out, with every request returning the HTML
 * shell instead of data. One origin removes the whole class of problem, keeps
 * the Clerk session cookie working with no proxy or header forwarding, and
 * costs one service to run rather than two.
 *
 * Mounted after the API routes, so `/api` always wins and the SPA fallback only
 * sees what is genuinely a page request.
 */

/** Where the web build landed. Overridable so a container can put it anywhere. */
function publicDir(): string | null {
  const configured = process.env.WEB_DIST;
  const candidates = configured
    ? [path.resolve(configured)]
    : [
        // Running from artifacts/api-server/dist/index.mjs in the monorepo.
        path.resolve(__dirname, "../../afrienergy-comms-lab/dist/public"),
        // Running from a flattened deploy directory.
        path.resolve(process.cwd(), "artifacts/afrienergy-comms-lab/dist/public"),
        path.resolve(process.cwd(), "dist/public"),
      ];

  for (const dir of candidates) {
    if (existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

/**
 * The certificate lookup the preview routes need.
 *
 * Still fetched over HTTP, against this same process on the loopback address,
 * rather than by calling the query directly. The verification rules are
 * genuinely intricate — a certificate is only real if every module is complete
 * — and they are covered by tests against that endpoint. A millisecond on
 * localhost is a cheap price for not maintaining a second copy of them.
 */
function localApiBase(): string {
  return `http://127.0.0.1:${process.env.PORT ?? 8080}/api`;
}

export function webRouter(): IRouter | null {
  const dir = publicDir();
  if (!dir) {
    logger.warn(
      { tried: process.env.WEB_DIST ?? "default locations" },
      "No web build found; serving the API only",
    );
    return null;
  }

  const basePath = process.env.BASE_PATH || "/";
  const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const indexHtml = readFileSync(path.join(dir, "index.html"), "utf8");
  const router: IRouter = Router();

  logger.info({ dir, base }, "Serving the web app");

  // A rendered certificate, so a shared link previews as the qualification
  // rather than as a bare URL.
  router.get(`${base}verify/:certificateId/og-image.png`, async (req, res) => {
    const cert = await fetchCertificate(req.params.certificateId, [localApiBase()]);
    if (!cert) {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.sendFile(path.join(dir, "og-certificate.png"));
      return;
    }
    const image = renderCertificateImage(cert);
    res.set({
      "Content-Type": "image/png",
      "Content-Length": String(image.length),
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    });
    res.status(200).send(image);
  });

  // The HTML shell with certificate-specific Open Graph tags injected, for
  // crawlers that never run JavaScript.
  router.get(`${base}verify/:certificateId`, async (req, res) => {
    const cert = await fetchCertificate(req.params.certificateId, [localApiBase()]);
    const html = cert
      ? injectMeta(indexHtml, buildCertificateMeta(cert, requestOrigin(req), base))
      : indexHtml;
    res.status(200).type("html").send(html);
  });

  router.use(base, express.static(dir, { index: "index.html" }));

  // Anything else that is a page request is the single-page app's business.
  //
  // Two things never reach it. Non-GET requests fall through, so a mistyped
  // POST gets a 404 rather than a page pretending the request worked. And
  // anything under /api falls through even for GET: an unknown endpoint must
  // answer as an API, because a client that asked for JSON and received a
  // 200 with an HTML page would parse the page as data and fail somewhere far
  // away from the cause.
  router.use((req, res, next) => {
    if (req.method !== "GET") { next(); return; }
    if (req.path === "/api" || req.path.startsWith("/api/")) { next(); return; }
    res.status(200).type("html").send(indexHtml);
  });

  return router;
}
