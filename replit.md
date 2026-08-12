# AfriEnergy Comms Lab

A cohort-based learning platform for the journalists, communicators and advocates
telling Africa's energy story. Learners join live classes, produce a piece of
work each module, critique two peers, and leave with a verifiable public
portfolio.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/domain run test` — the learning rules (55 unit tests)
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Web build also needs: `PORT`, `BASE_PATH`, `VITE_CLERK_PUBLISHABLE_KEY`

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
| Web app | `artifacts/afrienergy-comms-lab/src` |
| Design tokens | `artifacts/afrienergy-comms-lab/src/index.css` |
| Editorial content | `artifacts/afrienergy-comms-lab/src/content/` |
| Migrations / backfills | `scripts/src/` |

## Architecture decisions

- **`lib/domain` is shared by the client and the server on purpose.** The live
  join window used to be typed twice — the client offered "Join" at T−15 while
  the API refused until T−5, so the button failed for ten minutes before every
  class. Any rule both sides must agree on belongs in this package.
- **Completion is earned by what you made, never by attendance.** A module
  completes when its published deliverables are done: the assignment filed, the
  peer critiques written, the quiz passed. `attendedLive` is recognition only.
  The audience is working journalists across four time zones with load-shedding
  and metered data; gating on presence punished circumstance, not effort.
- **Peer critique is give-to-receive.** You must file your own work before the
  review queue opens, and write the critiques you owe before your feedback
  unlocks. This is what stops the loop from starving. Reviews are attributed in
  the database (so facilitators can spot abuse) but shown to authors anonymously.
- **Entitlement is enforced server-side, never in the UI.** Learners never
  receive `meetUrl` — joining goes through `POST /sessions/:id/join` so
  attendance is recorded and the module lock is applied. Recordings, by
  contrast, go to every enrolled learner.
- **Certificate codes are random and opaque**, stored on the enrollment row.
  The old `AECL-{programId}-{userId}` format was enumerable: anyone could walk
  it upward and harvest every graduate's name and your cohort sizes.
- **Certificate validity is recomputed at verification time**, never read from a
  stored "completed" flag.

## Product

- **Programs** contain ordered **sessions** (modules), each a live class.
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

## Gotchas

- **Always regenerate after editing `openapi.yaml`**:
  `pnpm --filter @workspace/api-spec run codegen`. CI fails if the generated
  clients are out of date.
- **Never hand-edit anything under a `generated/` directory.**
- **Never re-type a rule that lives in `lib/domain`.** Import it.
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

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
