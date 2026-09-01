import { Router, type IRouter } from "express";
import {
  db, enrollmentsTable, programsTable, usersTable, pendingInvitationsTable, sessionsTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { UpdateUserRoleBody, UpdateEnrollmentBody, InviteFacilitatorBody } from "@workspace/api-zod";
import { checkRoleChange, validateInvite, describeInvite } from "@workspace/domain";
import { currentRole, founderId, requireRole, getCurrentUser } from "../lib/auth";
import { sendInvitation, revokeInvitation, invitesConfigured } from "../lib/clerkInvites";
import { sendWaitlistPromotion } from "../lib/enrollmentEmails";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use("/admin", requireRole("admin"));

/**
 * The staff.
 *
 * People used to list everybody with an account, learners included, which on a
 * cohort of fifty was a wall of names an admin had to read past to find the two
 * facilitators. Learners belong to their programme and are managed there; this
 * is the list of people who run the Lab.
 */
router.get("/admin/staff", async (req, res) => {
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(inArray(usersTable.role, ["instructor", "admin", "superadmin"]))
    .orderBy(asc(usersTable.id));

  // The classes each facilitator is actually running, so an admin can see who
  // is carrying what without opening every programme in turn.
  const teaching = await db
    .select({
      instructorId: sessionsTable.instructorId,
      programId: programsTable.id,
      programTitle: programsTable.title,
      sessions: sql<number>`count(*)::int`,
    })
    .from(sessionsTable)
    .innerJoin(programsTable, eq(sessionsTable.programId, programsTable.id))
    .where(sql`${sessionsTable.instructorId} is not null`)
    .groupBy(sessionsTable.instructorId, programsTable.id, programsTable.title);

  // The effective role, so the first admin of an older Lab shows as the super
  // admin they are treated as everywhere else.
  const mine = await currentRole(req);
  const me = await getCurrentUser(req);

  res.json({
    you: { id: me?.id ?? null, role: mine ?? "learner" },
    // Marked so the console can show the founder's role as fixed rather than
    // offering a control that will be refused.
    founderId: await founderId(),
    staff: rows.map((r) => ({
      ...r,
      role: r.id === me?.id ? (mine ?? r.role) : r.role,
      programmes: teaching
        .filter((t) => t.instructorId === r.id)
        .map((t) => ({ programId: t.programId, programTitle: t.programTitle, sessions: t.sessions })),
    })),
  });
});

router.get("/admin/users", async (_req, res) => {
  const rows = await db
    .select({
      id: usersTable.id,
      clerkUserId: usersTable.clerkUserId,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
    })
    .from(usersTable)
    .orderBy(asc(usersTable.id));
  res.json(rows);
});

router.patch("/admin/users/:id/role", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateUserRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = await getCurrentUser(req);
  const myRole = await currentRole(req);
  const founder = await founderId();

  // Counting super admins and then demoting one has to happen under a lock, or
  // two of them demoting each other at the same instant both read "2", both
  // pass, and the Lab is left with nobody able to appoint anyone. It is the
  // same lock the first-user bootstrap takes, because it guards the same thing:
  // there must always be someone who can hand out the roles.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(981431)`);

    const [target] = await tx.select().from(usersTable).where(eq(usersTable.id, id));
    if (!target) return { ok: false as const, status: 404, error: "User not found", row: null };

    const [{ superadmins }] = await tx
      .select({ superadmins: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(eq(usersTable.role, "superadmin"));

    const check = checkRoleChange({
      actorRole: myRole,
      actorId: me?.id ?? null,
      targetId: id,
      targetRole: target.role,
      nextRole: parsed.data.role,
      // An older Lab has no stored super admin and the first admin standing in
      // for one. Counting that person keeps the "last super admin" guard honest
      // rather than letting the only one demote themselves out of existence.
      superadmins: superadmins > 0 ? superadmins : (myRole === "superadmin" ? 1 : 0),
      founderId: founder,
    });
    if (!check.ok) return { ok: false as const, status: 403, error: check.problem, row: null };

    const rows = await tx.update(usersTable).set({ role: parsed.data.role }).where(eq(usersTable.id, id)).returning();
    return { ok: true as const, status: 200, error: "", row: rows[0] };
  });

  if (!outcome.ok || !outcome.row) {
    res.status(outcome.status).json({ error: outcome.error || "User not found" });
    return;
  }
  const u = outcome.row;
  logger.info({ userId: u.id, role: u.role, by: me?.id }, "Role changed");
  res.json({ id: u.id, clerkUserId: u.clerkUserId, email: u.email, name: u.name, role: u.role });
});

router.get("/admin/enrollments", async (req, res) => {
  const programId = req.query.programId ? Number(req.query.programId) : undefined;
  const base = db
    .select({
      id: enrollmentsTable.id,
      userId: enrollmentsTable.userId,
      programId: enrollmentsTable.programId,
      status: enrollmentsTable.status,
      programTitle: programsTable.title,
      programStartDate: programsTable.startDate,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(enrollmentsTable)
    .innerJoin(programsTable, eq(enrollmentsTable.programId, programsTable.id))
    .innerJoin(usersTable, eq(enrollmentsTable.userId, usersTable.id));
  const rows = programId
    ? await base.where(eq(enrollmentsTable.programId, programId)).orderBy(asc(enrollmentsTable.id))
    : await base.orderBy(asc(enrollmentsTable.id));
  res.json(rows);
});

router.patch("/admin/enrollments/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateEnrollmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  type PromotedLearner = { email: string; name: string; program: { title: string; startDate: string } };
  let promoted: PromotedLearner | null = null;
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(enrollmentsTable)
      .set({ status: parsed.data.status })
      .where(eq(enrollmentsTable.id, id))
      .returning();
    if (rows.length === 0) return rows;
    // If a place opened up, promote the oldest waitlisted learner (FIFO).
    if (parsed.data.status === "cancelled") {
      const programId = rows[0].programId;
      await tx.execute(sql`select id from ${programsTable} where id = ${programId} for update`);
      const [program] = await tx.select().from(programsTable).where(eq(programsTable.id, programId));
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(enrollmentsTable)
        .where(and(eq(enrollmentsTable.programId, programId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
      if (program && count < program.capacity) {
        const waitlisted = await tx
          .select()
          .from(enrollmentsTable)
          .where(and(eq(enrollmentsTable.programId, programId), eq(enrollmentsTable.status, "waitlisted")))
          .orderBy(asc(enrollmentsTable.createdAt), asc(enrollmentsTable.id))
          .limit(1);
        if (waitlisted.length > 0) {
          await tx.update(enrollmentsTable).set({ status: "enrolled" }).where(eq(enrollmentsTable.id, waitlisted[0].id));
          const [learner] = await tx
            .select({ email: usersTable.email, name: usersTable.name })
            .from(usersTable)
            .where(eq(usersTable.id, waitlisted[0].userId));
          if (learner) {
            promoted = { ...learner, program: { title: program.title, startDate: program.startDate } };
          }
        }
      }
    }
    return rows;
  });
  // Email only after the promotion has committed; failure only logs.
  const p = promoted as PromotedLearner | null;
  if (p) {
    sendWaitlistPromotion({ email: p.email, name: p.name }, p.program);
  }
  if (updated.length === 0) {
    res.status(404).json({ error: "Enrollment not found" });
    return;
  }
  res.json(updated[0]);
});

/* ---------- Inviting facilitators ---------- */

/**
 * The people teaching here are senior practitioners giving their time for
 * nothing. Asking them to invent a password before they can see the class they
 * agreed to teach is a poor way to spend that goodwill.
 *
 * So: the admin invites by email, Clerk sends the link, and the facilitator
 * arrives already a facilitator with their classes waiting. The role travels on
 * Clerk's public metadata, which only a backend can write.
 */
router.post("/admin/invitations", async (req, res) => {
  if (!invitesConfigured()) {
    res.status(503).json({ error: "Clerk is not configured on the server, so invitations cannot be sent." });
    return;
  }

  const parsed = InviteFacilitatorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Who is asking decides what they may hand out: a super admin can invite an
  // admin, an admin cannot, and nobody invites a super admin by email.
  const myRole = await currentRole(req);
  const { invite, problems } = validateInvite({ ...parsed.data, actorRole: myRole ?? undefined });
  if (!invite) { res.status(403).json({ error: problems.join(" ") }); return; }

  const me = await getCurrentUser(req);

  // Somebody already here does not need an invitation; they need their role
  // changing, which is a different button. Compared case-insensitively because
  // the users table stores whatever Clerk gave it, unnormalised.
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(and(sql`lower(${usersTable.email}) = ${invite.email}`, sql`${usersTable.email} <> ''`));
  if (existing) {
    res.status(400).json({ error: "That person already has an account. Change their role in the list below instead." });
    return;
  }

  const [prior] = await db
    .select()
    .from(pendingInvitationsTable)
    .where(eq(pendingInvitationsTable.email, invite.email));

  // An invitation already taken up is a record of what happened, not something
  // to overwrite. The person exists somewhere; the admin wants the People list.
  if (prior?.acceptedAt) {
    res.status(400).json({
      error: "That invitation has already been accepted. Find them in the list below and change their role there.",
    });
    return;
  }

  // Withdraw the previous invitation before issuing another, or the first link
  // stays live forever with nothing recording its id — a second ticket in the
  // same inbox, still granting facilitator, and unrevocable through this app.
  if (prior?.clerkInvitationId) {
    const outcome = await revokeInvitation(prior.clerkInvitationId);
    if (outcome === "failed") {
      res.status(502).json({
        error: "Could not withdraw the previous invitation to this address, so a second was not sent. Try again shortly.",
      });
      return;
    }
    if (outcome === "already-accepted") {
      res.status(400).json({
        error: "They have already used their first invitation. Find them in the list below and change their role there.",
      });
      return;
    }
  }

  // Clerk is told "facilitator" even for an admin invitation. The admin role is
  // applied on arrival from the pending-invitation row below, which only this
  // server writes — so a forwarded link, or Clerk dashboard access, still
  // cannot make somebody an admin here.
  const sent = await sendInvitation({
    email: invite.email,
    role: invite.role === "admin" ? "instructor" : invite.role,
  });
  if (!sent.ok) { res.status(400).json({ error: sent.error }); return; }

  const values = {
    email: invite.email,
    role: invite.role,
    sessionIds: invite.sessionIds,
    clerkInvitationId: sent.invitation.id,
    invitedByUserId: me?.id ?? null,
    // Re-inviting is a fresh invitation, and dates it as one: otherwise it keeps
    // the original date, sorts to the bottom of the admin's list, and reports
    // the wrong day.
    createdAt: new Date(),
    acceptedAt: null,
    acceptedByUserId: null,
  };

  // Re-inviting replaces rather than stacks, so nobody ends up with two sets
  // of classes from two invitations.
  let saved;
  try {
    [saved] = await db
      .insert(pendingInvitationsTable)
      .values(values)
      .onConflictDoUpdate({ target: pendingInvitationsTable.email, set: values })
      .returning();
  } catch (err) {
    // The link is already in the post. Take it back rather than leaving a live
    // invitation with nothing recording it.
    await revokeInvitation(sent.invitation.id);
    logger.error({ err, email: invite.email }, "Could not record an invitation; withdrew it again");
    res.status(500).json({ error: "Could not record that invitation, so it has been withdrawn. Try again." });
    return;
  }

  logger.info({ email: invite.email, role: invite.role, classes: invite.sessionIds.length }, "Facilitator invited");
  res.status(201).json(invitePayload(saved));
});

router.get("/admin/invitations", async (_req, res) => {
  // Pending first, always. Accepted rows are kept forever as a record, and with
  // a plain date ordering they would eventually push a still-live invitation
  // off the end of the list — where it could no longer be withdrawn, which is
  // exactly the invitation most likely to need withdrawing.
  const rows = await db
    .select()
    .from(pendingInvitationsTable)
    .orderBy(sql`${pendingInvitationsTable.acceptedAt} is not null`, desc(pendingInvitationsTable.createdAt))
    .limit(200);
  res.json(rows.map(invitePayload));
});

router.delete("/admin/invitations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [invite] = await db.select().from(pendingInvitationsTable).where(eq(pendingInvitationsTable.id, id));
  if (!invite) { res.status(404).json({ error: "Invitation not found" }); return; }

  if (invite.acceptedAt) {
    res.status(400).json({ error: "That person has already joined. Change their role in the list instead." });
    return;
  }

  // acceptedAt is only written when the person first uses the app, so somebody
  // who has completed sign-up but not yet browsed still looks pending here.
  // Clerk is the authority on whether the link has been spent, and the local
  // row is only removed once Clerk confirms the grant is gone.
  const outcome = await revokeInvitation(invite.clerkInvitationId);

  if (outcome === "already-accepted") {
    // Record it as accepted so the admin sees the truth, and say plainly that
    // the role is now on that person's account and has to be removed there.
    await db
      .update(pendingInvitationsTable)
      .set({ acceptedAt: new Date() })
      .where(eq(pendingInvitationsTable.id, id));
    res.status(400).json({
      error: "They have already accepted, so the invitation cannot be withdrawn. They will appear in the list below once they sign in, and you can change their role there.",
    });
    return;
  }

  if (outcome === "failed") {
    res.status(502).json({
      error: "Could not reach Clerk to withdraw it, so the invitation is still live. Try again shortly.",
    });
    return;
  }

  await db.delete(pendingInvitationsTable).where(eq(pendingInvitationsTable.id, id));
  res.status(204).end();
});

function invitePayload(row: {
  id: number;
  email: string;
  role: string;
  sessionIds: number[];
  createdAt: Date;
  acceptedAt: Date | null;
}) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    sessionIds: row.sessionIds ?? [],
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    summary: describeInvite({
      email: row.email,
      role: row.role,
      sessionCount: (row.sessionIds ?? []).length,
      createdAt: row.createdAt,
    }),
  };
}

export default router;
