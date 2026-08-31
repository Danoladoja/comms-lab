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
- Email needs `BREVO_API_KEY`, and optionally `BREVO_SENDER_EMAIL` and
  `BREVO_SENDER_NAME`. Without it the app runs and each skipped send is logged
  as a warning.
- Serving the web app from the API process needs the web build to exist.
  `WEB_DIST` overrides where it is looked for; without it three sensible
  locations are tried. No build found means the API runs alone, which is normal
  in development.
- Facilitator invitations need `CLERK_SECRET_KEY` (already required for auth) and
  use `APP_BASE_URL` to build the link people land on. Without `APP_BASE_URL`
  Clerk falls back to its own account portal, which works but looks less like
  your app.
- Coursework drafting (optional) needs `ANTHROPIC_API_KEY`, and optionally
  `ANTHROPIC_MODEL`. Without it slides and transcripts still upload and
  coursework is written by hand; only the drafting buttons are unavailable.

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
| Drafting rules | `lib/domain/src/courseworkDraft.ts` — the brief given to the model, and the checking of what comes back |
| Reading list rules | `lib/domain/src/readingList.ts` — URL tidying and per-row validation |
| Slide handling | `lib/domain/src/slideText.ts` (assembly, quality) + `artifacts/api-server/src/lib/slides/` (pptx parsing, Claude call) |
| Serving the web app | `artifacts/api-server/src/web.ts` — static files, the SPA fallback, and the certificate preview routes |
| Invitations and roles | `lib/domain/src/invitations.ts` — what an emailed link may grant, and how a role is read off an account |
| What the drafter reads | `lib/domain/src/courseworkSource.ts` — combining the deck and the pasted transcript, and how the budget is split |
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
- **Generated coursework is a draft, never a save.** The drafting endpoint
  writes nothing: it returns questions and a task that fill the editors, and a
  human saves them through the normal endpoints. A wrong answer key fails
  learners silently at the 70% pass mark, so a person must have looked.
  `validateDraft` drops questions with an out-of-range key, duplicate options or
  too few choices, and reports every repair rather than hiding it.
- **One process serves the API and the web app.** The browser calls `/api/...`
  on its own origin. Split across two hosts those calls land on the web server,
  which has no `/api` route, and the app is dead on arrival: signed out, every
  request returning the HTML shell instead of data. One origin removes the whole
  class of problem, keeps the Clerk session cookie working with no proxy or
  header forwarding, and costs one service to run rather than two.
- **The SPA fallback never answers a request under `/api`.** An unknown endpoint
  returns a JSON 404. A client that asked for JSON and got a 200 with an HTML
  page would parse the page as data and fail somewhere far from the cause.
- **Email talks to Brevo directly, not through a Replit connector.** The
  connector runtime only exists inside Replit; anywhere else every send failed
  while the app looked healthy. There is no longer any Replit-specific code in
  the server.
- **Facilitators are invited, not asked to sign up.** The people teaching are
  senior practitioners working pro bono; making them invent a password before
  they can see their own class spends that goodwill badly. The admin invites by
  email, Clerk sends the link, and they arrive already a facilitator with their
  classes assigned.
- **The role travels on Clerk's `publicMetadata`, never `unsafeMetadata`.**
  Public metadata can only be written by a backend. Unsafe metadata can be
  written by the account holder from their own browser — reading a role from
  there would let any learner promote themselves and open every module's answer
  keys. `roleFromPublicMetadata` returns null for anything unrecognised so a
  typo can never become a role.
- **An emailed invitation cannot grant admin.** An invitation is a link in an
  inbox: forwardable, mistypeable, sometimes read by someone else. A wrong
  facilitator can be corrected; a wrong admin can delete the programme. Admin
  stays a deliberate act on a person already known to the system.
- **A pending invitation is matched on a Clerk-verified email only.** An
  unverified address could be typed by anyone at sign-up, and would hand them
  another facilitator's cohort.
- **Accepting an invitation never takes a class off whoever is teaching it.**
  An invitation accepted three weeks late must not silently replace the person
  standing in front of that cohort, so an occupied class is skipped and
  reported. The update re-checks for an empty slot in its WHERE clause, so two
  facilitators accepting at once cannot both take the same class.
- **The bootstrap rule outranks an invitation.** The first person into an empty
  database is the owner whatever they were invited as.
- **The last admin cannot be demoted, and nobody can change their own role.**
  Enforced on the server, not only in the interface. There is no way back from
  zero admins: the first-user rule only fires on an empty database, so a
  programme with no admin needs someone with database access to repair it.
- **A transcript beats a deck, and either alone is enough.** Slides are headings;
  the class is where the reasoning happens. A facilitator pastes the transcript
  (YouTube → three dots → Show transcript) into the class-material box, and the
  drafter is told to prefer it. When both are present the deck is capped at a
  third of the budget, because a class deck is a few thousand characters while a
  transcript fills whatever it is given.
- **Pasted class material is staff-only in both directions.** A transcript is a
  verbatim record of a room people spoke freely in; publishing it to learners is
  not a decision to make by accident.
- **Redo and "draft more" are given the editor's questions, not the database's.**
  A facilitator who has reworded three questions without saving still gets a
  replacement that does not collide with them. Anything that restates an
  existing question is dropped before it is returned — the failure mode of
  "give me four more" is four rephrasings of question two.
- **Every question records its origin**: `manual`, `drafted`, or `edited`. It
  never reaches learners and never affects marking. It exists because the
  question worth answering in six months is not "was AI used" but "was anyone
  reading" — and a question saved exactly as drafted is flagged in the editor.
  Each drafting run is also logged in `coursework_drafts` with the material it
  read and how much of it.
- **The rubric is never model-generated.** Peer critique across the programme
  scores against one house rubric; a per-module invention would make critiques
  incomparable. The drafter's rubric field is discarded.
- **Slide decks live in Postgres, not on disk.** The host filesystem is
  ephemeral — a deck written to disk vanishes on restart, taking the learner's
  revision material with it. Text is extracted once at upload so redrafting
  never re-parses.
- **.pptx text is read with fflate**, not a PowerPoint library: a .pptx is a zip
  of XML and every visible string sits in an `<a:t>` element. Slides are sorted
  numerically, because `slide10.xml` sorts before `slide2.xml` alphabetically.
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
- **Slides**: one deck per module, uploaded by a facilitator or admin, optionally
  shown to learners in the classroom. A .pptx also unlocks drafting.
- **Reading list**: links a facilitator points learners at, shown as a tab in the
  classroom. Ungraded and never read by `computeProgress` — adding a link cannot
  change whether anyone can finish.
- **Facilitator invitations**: Admin Console -> People. One email, one click, role
  and classes assigned on arrival. Pending invitations can be withdrawn.
- **Class material**: the slide deck, plus anything the facilitator pastes in —
  usually the class transcript. Staff-only, and read by the drafter.
- **Coursework drafting**: reads the deck and the transcript, drafts a quiz and a
  written task for the facilitator to edit and approve. Nothing is saved
  automatically. One question can be redone on its own, and a few more asked
  for, up to twelve.
- **Recordings**: published automatically as unlisted YouTube videos once the
  admin connects a Google account (Admin Console → Recordings), which also shows
  per-class status and surfaces failures.

## Gotchas

- **Deploying anywhere: build the web app before starting the API**, or the API
  starts alone and every page 404s. `pnpm run build` at the repo root does both
  in the right order. `PORT`, `BASE_PATH` and `VITE_CLERK_PUBLISHABLE_KEY` must
  be present at BUILD time, not only at runtime — the Vite config throws without
  the first two, and the Clerk key is compiled into the bundle.
- **`packageManager` is pinned in package.json** because builders otherwise
  guess pnpm 9, which cannot read `overrides` from `pnpm-workspace.yaml` and
  refuses the frozen install.
- **Always regenerate after editing `openapi.yaml`**:
  `pnpm --filter @workspace/api-spec run codegen`. CI fails if the generated
  clients are out of date.
- **Never hand-edit anything under a `generated/` directory.**
- **Never re-type a rule that lives in `lib/domain`.** Import it.
- The slide upload route takes raw bytes (`express.raw`), not multipart — the
  filename arrives in an `x-filename` header. Avoids a file-upload dependency
  and the 33% inflation of base64.
- PDFs upload and are readable by learners but yield no text, so they cannot be
  drafted from on their own. The UI says so, and points at the transcript box.
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
