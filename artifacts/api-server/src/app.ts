import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { schemaBehindMessage } from "@workspace/domain";
import router from "./routes";
import { webRouter } from "./web";
import { logger } from "./lib/logger";

/**
 * Comfortably above the largest thing anyone posts as JSON — a class transcript.
 * Slide decks do not come through here; they are raw bytes on their own route.
 */
const JSON_BODY_LIMIT = "1mb";

const app: Express = express();

/**
 * Railway terminates TLS and forwards to this process, so without this every
 * request appears to come from the proxy — one address for the whole internet.
 * Anything that reasons about who is calling, such as the partnership form's
 * per-address budget, would then treat all visitors as one caller and turn away
 * the second genuine partner of the day.
 *
 * One hop, not `true`: trusting the whole chain would let a caller prepend any
 * X-Forwarded-For they liked and mint a fresh identity for every request.
 */
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy must be mounted before body parsers (streams raw bytes)
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
// The default 100kb would refuse a pasted class transcript — MAX_NOTES_CHARS is
// 150,000 characters, and JSON escaping adds to that. The refusal happens in the
// body parser, before any route runs, so it cannot be raised per route.
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

// An unknown endpoint must still answer as an API. Without this it reaches
// Express's default handler and comes back as an HTML error page, which a
// client expecting JSON will either fail to parse or, worse, parse as text and
// carry on with.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// The built web app, served from this same process so the browser's `/api`
// calls and the pages that make them share one origin. Null when no build is
// present — running the API alone in development is perfectly normal.
const web = webRouter();
if (web) app.use(web);

/**
 * Body-parser rejects a malformed or oversized body before any route runs, so
 * those failures never reach a handler that knows how to answer in JSON.
 * Without this the caller gets Express's default HTML error page and the UI can
 * only say "something went wrong".
 */
const bodyErrors: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) { next(err); return; }
  const type = (err as { type?: string })?.type;
  if (type === "entity.too.large") {
    res.status(413).json({ error: "That is too large to save. Shorten it and try again." });
    return;
  }
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: "The request could not be read." });
    return;
  }
  next(err);
};
app.use(bodyErrors);

/**
 * The last word on anything that went wrong inside a route.
 *
 * Without this, an unhandled error reaches Express's default handler, which
 * answers with an HTML page containing the stack trace — and, for a database
 * failure, the full SQL statement. That page is returned to whoever made the
 * request, and some of these endpoints are public and unauthenticated, so it is
 * an invitation to go looking. It also breaks any caller expecting JSON.
 *
 * The detail is not lost; it goes to the log, where the people who can act on
 * it will see it and the person who tripped it will not.
 */
/**
 * The database is behind the code, and the app can tell.
 *
 * Schema changes are applied by hand after a deploy, so there is always a
 * window where the running code writes to a column the database does not have
 * yet. Postgres answers with 42703 (no such column) or 42P01 (no such table),
 * which reached the browser as "Something went wrong. Please try again" —
 * advice that is wrong in every particular. Trying again cannot help, nothing
 * the person did caused it, and the thing that fixes it is one command in a
 * console they were not looking at.
 *
 * This is the one internal failure worth naming out loud, because the person
 * who sees it is also the person who can fix it, and it has cost an afternoon
 * twice. Postgres's own message is passed through — it names the column, which
 * is exactly what makes the fix obvious.
 */
const MISSING_SCHEMA = new Set(["42703", "42P01"]);

export function schemaBehindCode(err: unknown): string | null {
  // Drizzle reports "Failed query" and hangs the real error off `cause`, so
  // the useful message and the code both have to come from the same place —
  // taking the code from the cause and the message from the wrapper produced a
  // warning that named no column at all.
  const own = err as { code?: unknown; message?: unknown } | null;
  const cause = (err as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const source = typeof own?.code === "string" && MISSING_SCHEMA.has(own.code)
    ? own
    : typeof cause?.code === "string" && MISSING_SCHEMA.has(cause.code)
      ? cause
      : null;
  if (!source) return null;

  const said = typeof source.message === "string" ? source.message : "";
  // The wording lives in the domain, where the one thing that matters about it
  // is tested: it must never send a frightened person to `push --force`, whose
  // purpose is to make the database match the code by any means — including
  // dropping columns and tables. That is how somebody worried about lost work
  // loses it for real. This used to say exactly that.
  return schemaBehindMessage(said);
}

const apiErrors: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) { next(err); return; }

  logger.error({ err, method: req.method, url: req.url?.split("?")[0] }, "Unhandled error");

  const behind = schemaBehindCode(err);
  if (behind) {
    res.status(503).json({ error: behind });
    return;
  }

  const status = Number((err as { status?: number; statusCode?: number })?.status
    ?? (err as { statusCode?: number })?.statusCode);
  // A 4xx that a route threw deliberately is the caller's business; anything
  // else is ours, and gets a flat 500 with nothing behind it.
  const code = Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;

  res.status(code).json({
    error: code === 500 ? "Something went wrong. Please try again." : "That request could not be completed.",
  });
};
app.use(apiErrors);

export default app;
