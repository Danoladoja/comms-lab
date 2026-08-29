# AfriEnergy Comms Lab

A cohort-based learning platform for the journalists, communicators and advocates
telling Africa's energy story. Learners join live classes, produce a piece of
work each module, critique two peers, and leave with a verifiable public
portfolio.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/domain run test` — the learning rules (81 unit tests)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Web build also needs: `PORT`, `BASE_PATH`, `VITE_CLERK_PUBLISHABLE_KEY`
- Recording automation (optional) needs `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and `GOOGLE_TOKEN_SECRET`.
  Without them the app runs fine and recordings are pasted in by hand. See
  `docs/recording-automation-setup.md`.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Auth: Clerk (JIT user provisioning; the first user ever created becomes admin)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Web: React 19, Vite, wouter, TanStack Query, shadcn/ui, framer-motion
- Email: Brevo
- Build: esbuild (CJS bundle)

## Where things live

| What | Where |
|---|---|
| **Learning rules (source of truth)** | `lib/domain/src` — progress, locking, live window, review pairing, certificate codes. Pure functions, unit tested, imported by *both* the API and the web client. |
| DB schema | `lib/db/src/schema/` |
| API contract | `lib/api-spec/openapi.yaml` — edit this, then run codegen |
| Generated client/Zod | `lib/api-client-react/src/generated`, `lib/api-zod/src/generated` — never hand-edit |
| API routes | `artifacts/api-server/src/routes/` |
| Progress loading | `artifacts/api-server/src/lib/progress.ts` — the only place that assembles inputs for `computeProgress` |
| Presence rules | `lib/domain/src/presence.ts` — thresholds, heartbeat crediting, replay buckets |
| Recording rules | `lib/domain/src/recordingPipeline.ts` — when to look, what to name it, when to give up |
| Google plumbing | `artifacts/api-server/src/lib/google/` — OAuth, Meet, Drive→YouTube transfer |
| Web app | `artifacts/afrienergy-comms-lab/src` |
| Design tokens | `artifacts/afrienergy-comms-lab/src/index.css` |
| Editorial content | `artifacts/afrienergy-comms-lab/src/content/` |
| Migrations / backfills | `scripts/src/` |

## Architecture decisions

- **`lib/domain` is shared by the client and the server on purpose.** The live
  join window used to be typed twice — the client offered "Join" at T−15 while
  the API refused until T−5, so the button failed for ten minutes before every
  class. Any rule both sides must agree on belongs in this package.
- **Completion needs both the class and the work.** A module completes when the
  learner has covered the class *and* finished its deliverables. Covering the
  class means reaching `PRESENCE_THRESHOLD_PCT` (90%) by either route — time in
  the live room, or distinct minutes of the recording watched. The two are never
  summed: both timelines cover the same material, so the higher one counts.
- **Live presence is a proxy, and is stored as raw seconds so it can be
  replaced.** The class runs in Google Meet, outside this app, so the classroom
  page heartbeats while it is open during the scheduled window. That measures
  *the tab being open during class*. Google Meet attendance reports or an
  in-platform video provider can be layered in later as a better input without
  any rule in `lib/domain/src/progress.ts` changing.
- **Replay watching is stored as coverage, not a total.** Fifteen-second buckets
  of the recording's timeline, so scrubbing to the end earns one bucket and
  re-watching the opening minute earns nothing.
- **Recordings must be YouTube or a direct video file.** Those are the only
  players that expose playback position, so a Vimeo or Loom link cannot be
  credited and the learner is told so on the page.
- **Peer critique is give-to-receive.** You must file your own work before the
  review queue opens, and write the critiques you owe before your feedback
  unlocks. This is what stops the loop from starving. Reviews are attributed in
  the database (so facilitators can spot abuse) but shown to authors anonymously.
- **Creating the meeting room is an admin duty.** Only admins can set `meetUrl`
  and only admins ever receive it. Everyone else — learners and facilitators
  alike — reaches the room through `POST /sessions/:id/join`, which is also what
  records attendance and applies the module lock. `hasMeetUrl` tells any page
  whether the room is ready without leaking the link. Recordings, by contrast,
  go to every enrolled learner, and instructors may set `recordingUrl`.
- **Class recordings move themselves from Meet to YouTube.** A job matches a
  finished class to its Meet recording via the Meet API (never by filename —
  a room reused weekly would publish the wrong week), streams the Drive file
  straight into a YouTube resumable upload without touching disk, and writes the
  watch URL back to the session. Hand-pasted links set `recordingStatus` to
  `manual` and are never overwritten.
- **The Google refresh token is encrypted at rest** with AES-256-GCM keyed from
  `GOOGLE_TOKEN_SECRET`, and no route ever returns it. Scopes are read-only for
  Meet and Drive; the only write is a YouTube upload.
- **Certificate codes are random and opaque**, stored on the enrollment row.
  The old `AECL-{programId}-{userId}` format was enumerable: anyone could walk
  it upward and harvest every graduate's name and your cohort sizes.
- **Certificate validity is recomputed at verification time**, never read from a
  stored "completed" flag.

## Product

- **Programs** contain ordered **sessions** (modules), each a live class. Every
  scheduled module must be attended live or watched on replay to 90%.
- **Enrollment** respects capacity with a row lock; over-capacity signups are
  waitlisted and promoted FIFO when a place opens, with email at each step.
- **Each module** can publish a **make** (assignment + rubric + review
  requirement), and optionally a quiz. Completing the make and the critiques
  unlocks the next module.
- **Peer critique**: least-reviewed work first, blind both ways, minimum
  feedback length enforced so scores never travel without reasons.
- **Certificates** are issued when every module of a program is complete, and
  verify publicly at `/verify/:code` with no sign-in. Learners can opt to
  publish their portfolio on that page.
- **Reminders**: idempotent 24h and 1h emails before each session.
- **Recordings**: published automatically as unlisted YouTube videos once the
  admin connects a Google account (Admin Console → Recordings), which also shows
  per-class status and surfaces failures.

## Gotchas

- **Always regenerate after editing `openapi.yaml`**:
  `pnpm --filter @workspace/api-spec run codegen`. CI fails if the generated
  clients are out of date.
- **Never hand-edit anything under a `generated/` directory.**
- **Never re-type a rule that lives in `lib/domain`.** Import it.
- The recording job holds one upload at a time and skips a pass if the previous
  one is still running — an hour of class video outlasts the five-minute tick.
- `GOOGLE_REDIRECT_URI` must match the Google Cloud entry exactly, trailing
  slash included. It is the usual cause of a failed connection.
- The web build fails without `PORT`, `BASE_PATH` and
  `VITE_CLERK_PUBLISHABLE_KEY` — intentional, not a bug.
- `artifacts/mockup-sandbox` is a scratch artifact; its build needs `PORT` too.
- Deploying the peer-critique schema onto a database that already has rows needs
  the backfills, in this order:
  ```
  pnpm --filter @workspace/scripts run migrate:certificate-codes -- --prepare
  pnpm --filter @workspace/db run push
  pnpm --filter @workspace/scripts run migrate:certificate-codes
  pnpm --filter @workspace/scripts run seed:rubrics
  ```
- Presence tracking adds columns to `session_attendance` and a `replay_progress`
  table; `pnpm --filter @workspace/db run push` covers both. Nothing to backfill
  — presence shipped before the first cohort was onboarded.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
