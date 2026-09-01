import type { NextFunction, Request, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import {
  db, usersTable, sessionsTable, pendingInvitationsTable, enrollmentsTable, type User,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  effectiveRole,
  generateCertificateCode,
  invitableRoleFromPublicMetadata,
  planAssignments,
  satisfiesRole,
} from "@workspace/domain";
import { logger } from "./logger";

const userCache = new WeakMap<Request, User>();
const effectiveUserCache = new WeakMap<Request, User>();

/**
 * Returns the local user for the signed-in Clerk session, JIT-provisioning
 * a row on first sight. The very first user ever provisioned becomes the super
 * admin — the person setting the Lab up is the one who appoints everyone else.
 * Returns null when not signed in.
 *
 * The row exactly as stored. Callers outside this file want `getCurrentUser`
 * instead: the founder rule has not been applied here, and comparing this role
 * against "admin" is what shut a super admin out of half the Lab.
 */
async function loadUserRow(req: Request): Promise<User | null> {
  const cached = userCache.get(req);
  if (cached) return cached;
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;
  if (!clerkUserId) return null;

  const existing = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId));
  if (existing.length > 0) {
    // A row with no email is one that was provisioned while Clerk was
    // unreachable. Repair it now rather than leaving the person a nameless
    // learner forever — an invited facilitator would otherwise never get their
    // role or their classes, and an admin could not even identify them.
    const user = existing[0].email === "" ? await repairUser(existing[0]) : existing[0];
    userCache.set(req, user);
    return user;
  }

  // JIT provision
  const profile = await fetchProfile(clerkUserId);
  if (!profile) {
    // Clerk is unreachable. Provisioning now would write a blank, role-less row
    // that nothing later repairs — better to fail this one request and let the
    // next attempt succeed.
    logger.error({ clerkUserId }, "Could not read a Clerk profile; not provisioning yet");
    return null;
  }
  const { email, name, invitedRole, emailVerified } = profile;

  // Advisory lock makes the "first user becomes admin" bootstrap race-free.
  const inserted = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(981431)`);
    const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` }).from(usersTable);
    // The bootstrap rule wins over an invitation: the first person into an
    // empty database is the owner, whatever they were invited as.
    const role = count === 0 ? "superadmin" : (invitedRole ?? "learner");
    return tx
      .insert(usersTable)
      .values({ clerkUserId, email, name, role })
      .onConflictDoNothing({ target: usersTable.clerkUserId })
      .returning();
  });

  const user =
    inserted[0] ??
    (await db.select().from(usersTable).where(eq(usersTable.clerkUserId, clerkUserId)))[0];

  // Hand over the classes this person was invited to teach. Only for a genuine
  // first arrival, and only on an address Clerk says it has verified.
  if (inserted[0] && emailVerified && email) {
    await claimInvitation(user, email);
  }

  userCache.set(req, user);
  return user;
}

/**
 * The signed-in person, with the role they actually hold.
 *
 * Every gate in the Lab asks this one question, and each one used to answer it
 * by comparing the stored row against the word "admin". That is wrong twice
 * over: a super admin's row says "superadmin", and the founder's row says
 * whatever they last set it to. Both were locked out of things they plainly
 * own, in the same week, in different tabs.
 *
 * So the role is settled here, once, before anything downstream sees it. The
 * stored row is still what gets written back on a repair; only what we hand out
 * carries the founder rule. One extra query per request, cached alongside the
 * row it belongs to.
 */
export async function getCurrentUser(req: Request): Promise<User | null> {
  const cached = effectiveUserCache.get(req);
  if (cached) return cached;

  const row = await loadUserRow(req);
  if (!row) return null;

  const role = effectiveRole(row, { founderId: await founderId() });
  const user = role === row.role ? row : { ...row, role };
  effectiveUserCache.set(req, user);
  return user;
}

/**
 * Give an arriving facilitator the classes they were invited to teach.
 *
 * Matching is on the email address, which is only safe because Clerk has
 * verified it — an unverified address could be claimed by anyone typing it into
 * a sign-up form, and would hand them someone else's cohort.
 *
 * A class that already has a facilitator is left alone. An invitation accepted
 * three weeks late must not quietly replace the person standing in front of
 * that cohort.
 */
async function claimInvitation(user: User, email: string): Promise<void> {
  try {
    const [invite] = await db
      .select()
      .from(pendingInvitationsTable)
      .where(and(
        eq(pendingInvitationsTable.email, email.trim().toLowerCase()),
        isNull(pendingInvitationsTable.acceptedAt),
      ));
    if (!invite) return;

    const wanted = invite.sessionIds ?? [];
    let outcome = { assigned: [] as number[], alreadyTaken: [] as number[], missing: [] as number[] };

    if (wanted.length > 0) {
      const rows = await db
        .select({ id: sessionsTable.id, instructorId: sessionsTable.instructorId })
        .from(sessionsTable)
        .where(inArray(sessionsTable.id, wanted));
      outcome = planAssignments(wanted, rows);

      if (outcome.assigned.length > 0) {
        await db
          .update(sessionsTable)
          .set({ instructorId: user.id })
          // Re-checking for an empty slot inside the update closes the gap
          // between reading and writing, so two facilitators accepting at once
          // cannot both take the same class.
          .where(and(inArray(sessionsTable.id, outcome.assigned), isNull(sessionsTable.instructorId)));
      }
    }

    // A learner invited to a cohort is enrolled on the way in, so the classes
    // are waiting rather than needing a second step from them or the admin.
    // Doing nothing if a row already exists means an invitation accepted after
    // the person enrolled themselves cannot wipe out the status an admin set.
    let enrolled = false;
    if (invite.programId) {
      const [row] = await db
        .insert(enrollmentsTable)
        .values({
          userId: user.id,
          programId: invite.programId,
          status: "enrolled",
          certificateCode: generateCertificateCode(),
        })
        .onConflictDoNothing({ target: [enrollmentsTable.userId, enrollmentsTable.programId] })
        .returning();
      enrolled = !!row;
    }

    // An invited admin is raised here rather than by anything Clerk carries.
    // This row is written only by this server, and only a super admin can cause
    // one to say "admin" — so link-borne metadata still cannot make an admin,
    // and nothing at all can make a super admin.
    if (invite.role === "admin" && !satisfiesRole(user.role, ["admin"])) {
      await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.id, user.id));
      logger.info({ userId: user.id }, "Invited admin arrived and was given the role");
    }

    await db
      .update(pendingInvitationsTable)
      .set({ acceptedAt: new Date(), acceptedByUserId: user.id })
      .where(eq(pendingInvitationsTable.id, invite.id));

    logger.info(
      {
        userId: user.id,
        role: invite.role,
        assigned: outcome.assigned.length,
        alreadyTaken: outcome.alreadyTaken.length,
        programId: invite.programId ?? null,
        enrolled,
      },
      "Invited person arrived",
    );
  } catch (err) {
    // Never block a sign-in over this. They are in; an admin can assign classes
    // by hand, and the log says what went wrong.
    logger.error({ err, userId: user.id }, "Could not apply a pending invitation");
  }
}

type Profile = { email: string; name: string; invitedRole: string | null; emailVerified: boolean };

/**
 * Read a person's details off Clerk.
 *
 * Returns null when Clerk cannot be reached, so the caller can decline to write
 * a half-formed row rather than baking a transient outage into the database.
 */
async function fetchProfile(clerkUserId: string): Promise<Profile | null> {
  try {
    const cu = await clerkClient.users.getUser(clerkUserId);
    const primary = cu.primaryEmailAddress ?? cu.emailAddresses[0];
    const email = primary?.emailAddress ?? "";
    return {
      email,
      name: [cu.firstName, cu.lastName].filter(Boolean).join(" ") || email,
      emailVerified: primary?.verification?.status === "verified",
      // SECURITY: publicMetadata only, and only the roles an invitation is
      // allowed to grant. Clerk also exposes unsafeMetadata, which the account
      // holder can write from their own browser; and a role of "admin" written
      // by anyone with Clerk dashboard access is refused here rather than
      // trusted, because dashboard access is not admin access here.
      invitedRole: invitableRoleFromPublicMetadata(cu.publicMetadata),
    };
  } catch (err) {
    logger.error({ err, clerkUserId }, "Could not read a Clerk profile");
    return null;
  }
}

/**
 * Fill in a row that was written while Clerk was unreachable, and give the
 * person whatever their invitation promised.
 *
 * Only runs for a row with a blank email, so it costs one extra Clerk call in a
 * rare case and none in the normal one.
 */
async function repairUser(user: User): Promise<User> {
  const profile = await fetchProfile(user.clerkUserId);
  if (!profile || !profile.email) return user;

  const [updated] = await db
    .update(usersTable)
    .set({
      email: profile.email,
      name: profile.name || user.name,
      // Only ever raises a learner to what they were invited as. An admin is
      // never demoted by a repair, and a role someone was given by hand in the
      // People list is not overwritten.
      role: user.role === "learner" && profile.invitedRole ? profile.invitedRole : user.role,
    })
    .where(eq(usersTable.id, user.id))
    .returning();

  const repaired = updated ?? user;
  if (profile.emailVerified) await claimInvitation(repaired, profile.email);
  logger.info({ userId: user.id }, "Repaired a user row provisioned during a Clerk outage");
  return repaired;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * The role this person actually holds, super admin included.
 *
 * The founder — the first staff account, the person who set the Lab up — is
 * always treated as a super admin. Without that, appointing a colleague costs
 * the founder the ability to undo the appointment, which is how the live Lab
 * locked its owner out within an hour of the tier existing.
 *
 * The two extra rows this reads are cached for the request.
 */
export async function currentRole(req: Request): Promise<string | null> {
  return (await getCurrentUser(req))?.role ?? null;
}

/**
 * The first staff account, by id. Learners are excluded so that a Lab whose
 * lowest-numbered row happens to be a learner does not hand them everything.
 */
export async function founderId(): Promise<number | null> {
  const [first] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.role, ["admin", "superadmin"]))
    .orderBy(asc(usersTable.id))
    .limit(1);
  return first?.id ?? null;
}

export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = await getCurrentUser(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    // Asking for the effective role rather than the stored one, so a super
    // admin passes every admin check without being written down twice.
    const role = roles.includes("superadmin") || roles.includes("admin")
      ? await currentRole(req)
      : user.role;
    if (!satisfiesRole(role, roles)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  };
}
