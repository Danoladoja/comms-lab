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
  /** The first account. Its role is fixed; see effectiveRole. */
  founderId?: number | null;
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
  // The founder's role is not anybody's to change, including a super admin they
  // appointed themselves. It is the one guarantee that the Lab cannot end up
  // with its owner locked out of it.
  if (input.founderId != null && input.targetId === input.founderId) {
    return { ok: false, problem: "This is the account that set the Lab up. Its role cannot be changed." };
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
 * The role somebody actually holds, allowing for who set the Lab up.
 *
 * The founder — the first account, the person who built this — is always a
 * super admin, whatever their row says. That is not a courtesy. Without it the
 * founder appoints a colleague, the fallback that had been standing in for a
 * super admin stops applying, and they are locked out of the one thing only a
 * super admin can do: undoing the appointment. That happened, on the live Lab,
 * within an hour of the tier existing.
 *
 * Nothing is written to the database. The rule is read afresh every time, so it
 * cannot drift out of step with the row it overrides.
 */
export function effectiveRole(
  user: { id: number; role: string },
  context: { founderId: number | null },
): string {
  if (user.role === "superadmin") return "superadmin";
  if (context.founderId !== null && user.id === context.founderId) return "superadmin";
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

/**
 * May this person work on a module as staff?
 *
 * The one rule, in one place, because it decides who may open a module's
 * slides, its coursework and its simulation, and those three had drifted
 * apart. An administrator may work on any module. A facilitator may work only
 * on the modules assigned to them. Nobody else may.
 *
 * The role passed in must be the *effective* one. Comparing a raw row against
 * the word "admin" is what locked a super admin out of the console once
 * already; `satisfiesRole` is here so it cannot happen a third time.
 */
export function isModuleStaff(
  effectiveRole: string | null,
  userId: number,
  instructorId: number | null,
): boolean {
  if (satisfiesRole(effectiveRole, ["admin"])) return true;
  return effectiveRole === "instructor" && instructorId !== null && instructorId === userId;
}
