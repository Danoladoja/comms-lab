import type { Role } from "./invitations";

/**
 * Who may do what, and who may appoint whom.
 *
 * Four roles now, and the new one exists because "admin" had become two
 * different jobs. Running the Lab day to day — cohorts, sessions, recordings —
 * is one thing. Deciding who else gets to run the Lab is another, and it is the
 * only decision that cannot be undone by the people it affects.
 *
 *   learner      Takes programmes.
 *   instructor   Teaches their own classes.
 *   admin        Runs everything except appointments.
 *   superadmin   Appoints and removes staff, including other super admins.
 *
 * A super admin is not a bigger admin: an admin who could appoint admins can
 * appoint themselves out of any check, which makes every other guard here
 * decorative.
 */

export const ROLE_LABELS: Record<Role, string> = {
  learner: "Learner",
  instructor: "Facilitator",
  admin: "Admin",
  superadmin: "Super admin",
};

export const ROLE_NOTES: Record<Role, string> = {
  learner: "Takes programmes.",
  instructor: "Teaches their own classes and sees their learners' work.",
  admin: "Runs programmes, sessions, enrolments and invitations.",
  superadmin: "Everything an admin can do, and appoints staff.",
};

/** Everyone who belongs in the People list rather than under a programme. */
export function isStaffRole(role: string | null | undefined): boolean {
  return role === "instructor" || role === "admin" || role === "superadmin";
}

/**
 * Whether somebody holding `role` passes a check that asks for one of `allowed`.
 *
 * A super admin satisfies an admin check. Nothing else is implied: an admin is
 * not an instructor, because an instructor check protects a specific person's
 * classroom rather than a level of seniority.
 */
export function satisfiesRole(role: string | null | undefined, allowed: readonly string[]): boolean {
  if (!role) return false;
  if (allowed.includes(role)) return true;
  return role === "superadmin" && allowed.includes("admin");
}

/** Only a super admin appoints. */
export function canAppointStaff(role: string | null | undefined): boolean {
  return role === "superadmin";
}

/**
 * What an invitation sent by this person may make somebody.
 *
 * A super admin may invite an admin; nobody may invite a super admin. The top
 * of the ladder is only ever climbed in the console, by somebody already there,
 * acting on a person they can see — never by a link sitting in an inbox that
 * can be forwarded, or sent to an address with a typo in it.
 */
export function rolesInvitableBy(role: string | null | undefined): Role[] {
  if (role === "superadmin") return ["admin", "instructor", "learner"];
  if (role === "admin") return ["instructor", "learner"];
  return [];
}

export function canInviteRole(actor: string | null | undefined, target: unknown): target is Role {
  return typeof target === "string" && (rolesInvitableBy(actor) as string[]).includes(target);
}

export type RoleChangeCheck =
  | { ok: true }
  | { ok: false; problem: string };

/**
 * Whether one person may set another person's role.
 *
 * Three refusals, and each one is a door that cannot be reopened from inside:
 * appointing is a super admin's job; nobody edits their own role, because
 * stepping down is something a colleague does for you; and the last super admin
 * cannot be removed, since there would then be nobody able to appoint one.
 */
export function checkRoleChange(input: {
  actorRole: string | null | undefined;
  actorId: number | null | undefined;
  targetId: number;
  targetRole: string;
  nextRole: string;
  /** How many super admins exist right now, counted under a lock. */
  superadmins: number;
}): RoleChangeCheck {
  if (!canAppointStaff(input.actorRole)) {
    return { ok: false, problem: "Only a super admin can change what someone is allowed to do." };
  }
  if (input.actorId != null && input.actorId === input.targetId) {
    return { ok: false, problem: "You cannot change your own role. Ask another super admin to do it." };
  }
  if (!(ROLE_LABELS as Record<string, string>)[input.nextRole]) {
    return { ok: false, problem: "That is not a role." };
  }
  if (input.targetRole === "superadmin" && input.nextRole !== "superadmin" && input.superadmins <= 1) {
    return {
      ok: false,
      problem: "This is the only super admin. Make someone else a super admin first, or nobody can appoint staff.",
    };
  }
  return { ok: true };
}

/**
 * The role somebody actually holds, allowing for a Lab set up before super
 * admins existed.
 *
 * On such a Lab every admin row says "admin" and there is no super admin at
 * all, which would leave nobody able to appoint anyone. So where none exists,
 * the first admin — the account that set the Lab up — is treated as the super
 * admin. Nothing is written: the moment a real super admin is appointed, this
 * fallback stops applying.
 */
export function effectiveRole(
  user: { id: number; role: string },
  context: { superadminExists: boolean; firstAdminId: number | null },
): string {
  if (user.role === "superadmin") return "superadmin";
  // Only an admin is ever lifted. Checking the id alone would hand the tier to
  // whoever happened to be passed in, which a test caught doing exactly that.
  if (
    user.role === "admin" &&
    !context.superadminExists &&
    context.firstAdminId !== null &&
    user.id === context.firstAdminId
  ) {
    return "superadmin";
  }
  return user.role;
}

/** Read the staff list into the two groups the People page shows. */
export function groupStaff<T extends { role: string }>(people: readonly T[]): {
  administrators: T[];
  facilitators: T[];
} {
  return {
    administrators: people.filter((p) => p.role === "superadmin" || p.role === "admin"),
    facilitators: people.filter((p) => p.role === "instructor"),
  };
}
