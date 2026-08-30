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
import router from "./routes";
import { webRouter } from "./web";
import { logger } from "./lib/logger";

/**
 * Comfortably above the largest thing anyone posts as JSON — a class transcript.
 * Slide decks do not come through here; they are raw bytes on their own route.
 */
const JSON_BODY_LIMIT = "1mb";

const app: Express = express();

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

export default app;
