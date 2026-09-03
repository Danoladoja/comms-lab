/**
 * Inviting a facilitator, rather than asking them to sign up.
 *
 * The people teaching on this programme are senior practitioners giving their
 * time for nothing. Asking them to invent a password before they can see the
 * class they agreed to teach is a poor way to spend that goodwill. So the admin
 * invites them by email, they click once, and they arrive already a facilitator
 * with their classes waiting.
 *
 * The rules that must not be got wrong live here, where they can be tested
 * without a network: which roles an emailed link may grant, and how a role is
 * read back off an account.
 */

// A type-only import, so this stays a one-way dependency at runtime: staffRoles
// takes the Role type from here, and only the type.
import { rolesInvitableBy } from "./staffRoles";

export type Role = "learner" | "instructor" | "admin" | "superadmin";

export const ROLES: Role[] = ["learner", "instructor", "admin", "superadmin"];

/**
 * What an emailed invitation may grant.
 *
 * Admin is deliberately absent. An invitation is a link sitting in an inbox: it
 * can be forwarded, an inbox can be compromised, and a mistyped address goes to
 * a stranger. A facilitator can be given the wrong class; an admin can delete
 * the programme. Admin stays a deliberate act performed on a person who is
 * already known to the system, in the People list.
 */
export const INVITABLE_ROLES: Role[] = ["instructor", "learner"];

/**
 * A super admin may invite an admin, and that is deliberately NOT done by
 * widening the list above.
 *
 * The rule that link-borne metadata can never make somebody an admin still
 * holds exactly as written. An invited admin arrives as a facilitator as far as
 * Clerk is concerned, and is raised to admin by `claimInvitation` reading our
 * own pending-invitation row — a record only this server can write, created
 * only by a super admin. Clerk dashboard access, which is a different privilege
 * from being an admin here, still cannot mint one.
 */
export const CONSOLE_GRANTABLE_ROLES: Role[] = ["admin", "instructor", "learner"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as string[]).includes(value);
}

export function isInvitableRole(value: unknown): value is Role {
  return typeof value === "string" && (INVITABLE_ROLES as string[]).includes(value);
}

/**
 * The role carried on a Clerk account, read from public metadata.
 *
 * SECURITY: this must only ever be given Clerk's `publicMetadata`, which only a
 * backend can write. Clerk also exposes `unsafeMetadata`, which the account
 * holder can set from their own browser — reading a role from that would let any
 * learner make themselves a facilitator and open every module's answer keys.
 *
 * Anything unrecognised returns null, so a malformed or absent value falls back
 * to the caller's default rather than becoming a role by accident.
 */
export function roleFromPublicMetadata(metadata: unknown): Role | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>).role;
  // Super admin is never read off an account, whatever is written there. It is
  // granted in the console by somebody who already holds it, acting on a person
  // they can see — so metadata, which Clerk dashboard access can also write, is
  // not a route to the one role that can appoint every other.
  if (value === "superadmin") return null;
  return isRole(value) ? value : null;
}

/**
 * The role to actually grant someone arriving through an invitation.
 *
 * Narrower than `roleFromPublicMetadata` on purpose. That function reports what
 * is written on an account; this one decides what an arrival may become, and it
 * refuses admin.
 *
 * The two must be different, because "an invitation cannot grant admin" has to
 * hold at the point of *reading* as well as the point of sending. Enforcing it
 * only when sending leaves the invariant resting on this codebase being the
 * only thing that ever writes Clerk metadata — and it is not. Anyone with Clerk
 * dashboard access, which is a different privilege from being an admin here,
 * can use Clerk's own invite button and set whatever metadata they like.
 */
export function invitableRoleFromPublicMetadata(metadata: unknown): Role | null {
  const role = roleFromPublicMetadata(metadata);
  return role && isInvitableRole(role) ? role : null;
}

/** Tidy an address for storing and comparing. */
export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Good enough to catch a typo before an invitation is spent, without trying to
 * out-guess what a valid address is. Clerk rejects genuinely bad ones anyway.
 */
export function isPlausibleEmail(input: string): boolean {
  const email = normaliseEmail(input);
  if (email.length < 6 || email.length > 320) return false;
  if (/\s/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

export const MAX_SESSIONS_PER_INVITE = 20;

export type InviteProblem = string;

export type InviteRequest = {
  email: string;
  role: Role;
  sessionIds: number[];
};

/**
 * Check an invitation before it is sent.
 *
 * An invitation costs an email to a busy senior person, so a mistake is worth
 * catching here rather than after it has landed in their inbox.
 */
export function validateInvite(raw: {
  email?: string;
  role?: string;
  sessionIds?: number[];
  /**
   * Who is sending it. A super admin may invite an admin; anybody else may not,
   * and nobody may invite a super admin. Defaults to an admin, so a caller that
   * says nothing gets the narrower rule rather than the wider one.
   */
  actorRole?: string;
}): { invite: InviteRequest | null; problems: InviteProblem[] } {
  const problems: InviteProblem[] = [];
  const email = normaliseEmail(raw.email ?? "");

  if (!email) {
    problems.push("Enter the facilitator's email address.");
  } else if (!isPlausibleEmail(email)) {
    problems.push("That does not look like an email address.");
  }

  const role = raw.role ?? "instructor";
  const allowed = rolesInvitableBy(raw.actorRole ?? "admin") as string[];
  if (!allowed.includes(role)) {
    problems.push(
      role === "superadmin"
        ? "A super admin is appointed in the People list, never by an emailed link."
        : isRole(role)
          ? "Only a super admin can invite an admin. Ask them, or invite this person as a facilitator."
          : "Choose a role for the invitation.",
    );
  }

  const sessionIds = Array.from(new Set((raw.sessionIds ?? []).filter((n) => Number.isInteger(n) && n > 0)));
  if (sessionIds.length > MAX_SESSIONS_PER_INVITE) {
    problems.push(`One invitation can cover at most ${MAX_SESSIONS_PER_INVITE} classes.`);
  }

  if (problems.length > 0) return { invite: null, problems };
  return { invite: { email, role: role as Role, sessionIds: sessionIds.slice(0, MAX_SESSIONS_PER_INVITE) }, problems };
}

/**
 * What actually happened when an invited facilitator arrived.
 *
 * A class that already had a facilitator is not silently taken over — the person
 * standing in front of that cohort is a decision someone made, and an invitation
 * accepted three weeks later should not quietly undo it. It is reported instead.
 */
export type AssignmentOutcome = {
  assigned: number[];
  alreadyTaken: number[];
  missing: number[];
};

export function planAssignments(
  wanted: number[],
  sessions: { id: number; instructorId: number | null }[],
): AssignmentOutcome {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const outcome: AssignmentOutcome = { assigned: [], alreadyTaken: [], missing: [] };

  for (const id of wanted) {
    const session = byId.get(id);
    if (!session) outcome.missing.push(id);
    else if (session.instructorId !== null) outcome.alreadyTaken.push(id);
    else outcome.assigned.push(id);
  }
  return outcome;
}

/** One line for the admin's list of who has been invited and not yet arrived. */
export function describeInvite(invite: {
  email: string;
  role: string;
  sessionCount: number;
  createdAt: Date | string;
  /** The cohort a learner was invited onto, where there is one. */
  programmeTitle?: string | null;
}): string {
  const when = inviteDate(invite.createdAt);

  // A learner is invited to a cohort, not to a set of classes. Telling an admin
  // that somebody was "invited as learner with no classes yet" describes the
  // facilitator machinery rather than the thing that happened.
  if (invite.role === "learner") {
    const where = invite.programmeTitle?.trim();
    return `Invited${where ? ` to ${where}` : ""}${when ? ` on ${when}` : ""}.`;
  }

  const what = invite.role === "instructor" ? "facilitator" : invite.role;
  const classes = invite.sessionCount === 0
    ? "no classes yet"
    : `${invite.sessionCount} class${invite.sessionCount === 1 ? "" : "es"}`;
  return `Invited as ${what} with ${classes}${when ? ` on ${when}` : ""}.`;
}

function inviteDate(value: Date | string): string {
  const at = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

/** Whole days between when an invitation was sent and now. */
export function daysWaiting(createdAt: Date | string, now: number = Date.now()): number | null {
  const at = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(at.getTime())) return null;
  const days = Math.floor((now - at.getTime()) / 86_400_000);
  return days < 0 ? 0 : days;
}

/**
 * When an unanswered invitation has been waiting long enough to chase.
 *
 * A week. Sooner than that and the admin is nagging somebody who has simply not
 * opened their inbox since Friday; much later and the link has gone stale in a
 * folder nobody looks at.
 */
export const CHASE_AFTER_DAYS = 7;

export function inviteWorthChasing(
  invite: { acceptedAt?: Date | string | null; createdAt: Date | string },
  now: number = Date.now(),
): boolean {
  if (invite.acceptedAt) return false;
  const days = daysWaiting(invite.createdAt, now);
  return days !== null && days >= CHASE_AFTER_DAYS;
}

/**
 * May this invitation be sent again?
 *
 * The reason to resend is mundane and common: the first one went to spam, or
 * was read on a phone in a queue and forgotten. The reason not to is that an
 * invitation already taken up is a record of something that happened, and
 * re-issuing it would withdraw a live account's route in and replace it with a
 * link the person does not need.
 */
export function mayResendInvitation(invite: {
  acceptedAt?: Date | string | null;
}): { allowed: boolean; reason: string | null } {
  if (invite.acceptedAt) {
    return {
      allowed: false,
      reason: "They have already accepted. There is nothing left to send.",
    };
  }
  return { allowed: true, reason: null };
}
