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

export type Role = "learner" | "instructor" | "admin";

export const ROLES: Role[] = ["learner", "instructor", "admin"];

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
}): { invite: InviteRequest | null; problems: InviteProblem[] } {
  const problems: InviteProblem[] = [];
  const email = normaliseEmail(raw.email ?? "");

  if (!email) {
    problems.push("Enter the facilitator's email address.");
  } else if (!isPlausibleEmail(email)) {
    problems.push("That does not look like an email address.");
  }

  const role = raw.role ?? "instructor";
  if (!isInvitableRole(role)) {
    problems.push(
      isRole(role)
        ? "An invitation cannot grant admin. Invite them, then change the role in the People list."
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
}): string {
  const at = typeof invite.createdAt === "string" ? new Date(invite.createdAt) : invite.createdAt;
  const when = Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  const what = invite.role === "instructor" ? "facilitator" : invite.role;
  const classes = invite.sessionCount === 0
    ? "no classes yet"
    : `${invite.sessionCount} class${invite.sessionCount === 1 ? "" : "es"}`;
  return `Invited as ${what} with ${classes}${when ? ` on ${when}` : ""}.`;
}
