---
name: Comms Lab backend decisions
description: Durable decisions for the Afrienergy Comms Lab auth/roles/enrollment backend.
---

- **Admin bootstrap:** the first user ever JIT-provisioned becomes admin (guarded by a pg advisory lock). Test/demo users must be deleted before the real owner signs in, or they steal the admin seat.
  **Why:** no separate admin signup flow; owner is non-technical.
- **Roles:** learner (default) / instructor / admin. Instructors are pro bono facilitators — they only add meeting/recording links to their assigned sessions; admin manages everything else. User-facing label for instructor is "Facilitator".
- **Enrollment:** capacity overflow goes to waitlist; enrollment writes lock the program row in a transaction; admin cancelling an enrolled place promotes the oldest waitlisted learner (FIFO).
- **Link gating:** learners NEVER receive raw meet links from list endpoints — they must use POST /sessions/:id/join, which enforces enrollment, sequential lock, and the live window (5-min grace before start). Replay links only for sessions attended live start-to-finish. Staff (admin/assigned instructor) see raw links.
- **Progress/locking:** per-module progress computed from session_attendance.joined_at vs starts_at/duration. Module N locked until N-1 attended live in full; prerequisites are WAIVED if unscheduled or if they ended before the learner enrolled (late joiners aren't locked out). Canonical module order: startsAt, sortOrder, id.
- **Frontend queries:** generated React Query hooks require `queryKey: get<Op>QueryKey()` when passing custom query options; `startsAt` must be sent as ISO string, not Date.
- Pre-existing framer-motion `ease: [..]` arrays need `as const` to typecheck.
