---
name: Comms Lab backend decisions
description: Durable decisions for the Afrienergy Comms Lab auth/roles/enrollment backend.
---

- **Admin bootstrap:** the first user ever JIT-provisioned becomes admin (guarded by a pg advisory lock). Test/demo users must be deleted before the real owner signs in, or they steal the admin seat.
  **Why:** no separate admin signup flow; owner is non-technical.
- **Roles:** learner (default) / instructor / admin. Instructors are pro bono facilitators — they only add meeting/recording links to their assigned sessions; admin manages everything else. User-facing label for instructor is "Facilitator".
- **Enrollment:** capacity overflow goes to waitlist; enrollment writes lock the program row in a transaction; admin cancelling an enrolled place promotes the oldest waitlisted learner (FIFO).
- **Link gating:** learners NEVER receive raw meet links from list endpoints — they must use POST /sessions/:id/join, which enforces enrollment, sequential lock, and the live window (5-min grace before start). Replay links only for sessions attended live start-to-finish. Staff (admin/assigned instructor) see raw links.
- **Progress/locking:** module completion = attended live in full + quiz passed (>=70%, unlimited retakes, graded server-side) + assignment submitted (text, auto-accepted); components a module doesn't have are not required. Progress % blends the module's present components equally. Module N locked until N-1 completed; prerequisites WAIVED if unscheduled or ended before the learner enrolled. Canonical module order: startsAt, sortOrder, id.
- **Coursework rules:** learners never receive correctIndex (field omitted, not nulled); replacing a quiz deletes all prior attempts in the same transaction (old passes must not count); assignment resubmission allowed (upsert). Quiz/assignment authoring: admin or assigned instructor, via PUT replace-all.
- **Frontend queries:** generated React Query hooks require `queryKey: get<Op>QueryKey()` when passing custom query options; `startsAt` must be sent as ISO string, not Date.
- Pre-existing framer-motion `ease: [..]` arrays need `as const` to typecheck.
