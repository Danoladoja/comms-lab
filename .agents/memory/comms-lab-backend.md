---
name: Comms Lab backend decisions
description: Durable decisions for the Afrienergy Comms Lab auth/roles/enrollment backend.
---

- **Admin bootstrap:** the first user ever JIT-provisioned becomes admin (guarded by a pg advisory lock). Test/demo users must be deleted before the real owner signs in, or they steal the admin seat.
  **Why:** no separate admin signup flow; owner is non-technical.
- **Roles:** learner (default) / instructor / admin. Instructors are pro bono facilitators — they only add meeting/recording links to their assigned sessions; admin manages everything else. User-facing label for instructor is "Facilitator".
- **Enrollment:** capacity overflow goes to waitlist; enrollment writes lock the program row in a transaction; admin cancelling an enrolled place promotes the oldest waitlisted learner (FIFO).
- **Link gating:** meet/recording URLs are stripped from session responses unless the viewer is admin, an instructor assigned to that program, or actively enrolled.
- **Frontend queries:** generated React Query hooks require `queryKey: get<Op>QueryKey()` when passing custom query options; `startsAt` must be sent as ISO string, not Date.
- Pre-existing framer-motion `ease: [..]` arrays need `as const` to typecheck.
