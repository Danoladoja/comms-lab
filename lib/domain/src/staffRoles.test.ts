import { describe, expect, it } from "vitest";
import {
  ROLE_LABELS,
  canAppointStaff,
  canInviteRole,
  checkRoleChange,
  effectiveRole,
  groupStaff,
  isModuleStaff,
  isStaffRole,
  rolesInvitableBy,
  satisfiesRole,
} from "./staffRoles";

describe("satisfiesRole", () => {
  it("a super admin passes an admin check", () => {
    expect(satisfiesRole("superadmin", ["admin"])).toBe(true);
  });

  it("an admin does not pass a super admin check", () => {
    // The whole point of the tier: it must not be reachable from below.
    expect(satisfiesRole("admin", ["superadmin"])).toBe(false);
  });

  it("an admin is not an instructor", () => {
    // An instructor check guards one person's classroom, not a rank.
    expect(satisfiesRole("admin", ["instructor"])).toBe(false);
  });

  it.each([null, undefined, "", "learner"])("refuses %s", (role) => {
    expect(satisfiesRole(role as string, ["admin"])).toBe(false);
  });
});

describe("rolesInvitableBy", () => {
  it("a super admin may invite an admin", () => {
    expect(rolesInvitableBy("superadmin")).toContain("admin");
  });

  it("nobody may invite a super admin", () => {
    for (const actor of ["superadmin", "admin", "instructor", "learner", null]) {
      expect(rolesInvitableBy(actor)).not.toContain("superadmin");
    }
  });

  it("an admin may invite facilitators and learners only", () => {
    expect(rolesInvitableBy("admin")).toEqual(["instructor", "learner"]);
  });

  it.each(["instructor", "learner", null, undefined])("%s may invite nobody", (actor) => {
    expect(rolesInvitableBy(actor as string)).toEqual([]);
  });

  it("canInviteRole agrees with the list", () => {
    expect(canInviteRole("superadmin", "admin")).toBe(true);
    expect(canInviteRole("admin", "admin")).toBe(false);
    expect(canInviteRole("superadmin", "superadmin")).toBe(false);
    expect(canInviteRole("superadmin", "nonsense")).toBe(false);
  });
});

describe("checkRoleChange", () => {
  const base = { actorRole: "superadmin", actorId: 1, targetId: 2, targetRole: "learner", nextRole: "admin", superadmins: 2 };

  it("lets a super admin appoint an admin", () => {
    expect(checkRoleChange(base)).toEqual({ ok: true });
  });

  it("refuses an admin trying to appoint anyone", () => {
    const result = checkRoleChange({ ...base, actorRole: "admin" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/super admin/i);
  });

  it("refuses somebody editing their own role", () => {
    const result = checkRoleChange({ ...base, targetId: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/your own role/i);
  });

  it("refuses removing the last super admin", () => {
    const result = checkRoleChange({
      ...base, targetId: 2, targetRole: "superadmin", nextRole: "admin", superadmins: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/only super admin/i);
  });

  it("allows demoting a super admin while another remains", () => {
    expect(checkRoleChange({ ...base, targetRole: "superadmin", nextRole: "admin", superadmins: 2 }).ok).toBe(true);
  });

  it("refuses a role that does not exist", () => {
    expect(checkRoleChange({ ...base, nextRole: "owner" }).ok).toBe(false);
  });

  it("a super admin may appoint another super admin", () => {
    expect(checkRoleChange({ ...base, nextRole: "superadmin" }).ok).toBe(true);
  });
});

describe("effectiveRole", () => {
  it("the founder is a super admin whatever their row says", () => {
    expect(effectiveRole({ id: 1, role: "admin" }, { founderId: 1 })).toBe("superadmin");
  });

  it("stays a super admin after appointing somebody else", () => {
    // The trap this rule exists for: the founder promoted a colleague, the
    // stand-in fallback stopped applying, and they could no longer undo it.
    expect(effectiveRole({ id: 1, role: "admin" }, { founderId: 1 })).toBe("superadmin");
  });

  it("lifts nobody else", () => {
    expect(effectiveRole({ id: 7, role: "admin" }, { founderId: 1 })).toBe("admin");
    expect(effectiveRole({ id: 7, role: "learner" }, { founderId: 1 })).toBe("learner");
  });

  it("leaves an appointed super admin alone", () => {
    expect(effectiveRole({ id: 9, role: "superadmin" }, { founderId: 1 })).toBe("superadmin");
  });

  it("copes with a Lab that has no founder to find", () => {
    expect(effectiveRole({ id: 3, role: "learner" }, { founderId: null })).toBe("learner");
  });
});

describe("protecting the founder", () => {
  const base = {
    actorRole: "superadmin", actorId: 9, targetId: 1, targetRole: "admin",
    nextRole: "learner", superadmins: 2, founderId: 1,
  };

  it("an appointed super admin cannot demote the founder", () => {
    const result = checkRoleChange(base);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(/set the Lab up/i);
  });

  it("not even to another staff role", () => {
    expect(checkRoleChange({ ...base, nextRole: "superadmin" }).ok).toBe(false);
  });

  it("everybody else can still be changed", () => {
    expect(checkRoleChange({ ...base, targetId: 5 }).ok).toBe(true);
  });
});

describe("the People page groupings", () => {
  const people = [
    { id: 1, role: "superadmin" },
    { id: 2, role: "admin" },
    { id: 3, role: "instructor" },
    { id: 4, role: "learner" },
  ];

  it("splits staff into administrators and facilitators", () => {
    const { administrators, facilitators } = groupStaff(people);
    expect(administrators.map((p) => p.id)).toEqual([1, 2]);
    expect(facilitators.map((p) => p.id)).toEqual([3]);
  });

  it("leaves learners out of both", () => {
    const { administrators, facilitators } = groupStaff(people);
    expect([...administrators, ...facilitators].map((p) => p.id)).not.toContain(4);
  });

  it("knows who counts as staff", () => {
    expect(isStaffRole("instructor")).toBe(true);
    expect(isStaffRole("superadmin")).toBe(true);
    expect(isStaffRole("learner")).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });

  it("has a plain-word label for every role", () => {
    expect(ROLE_LABELS.instructor).toBe("Facilitator");
    expect(ROLE_LABELS.superadmin).toBe("Super admin");
  });

  it("only a super admin appoints", () => {
    expect(canAppointStaff("superadmin")).toBe(true);
    expect(canAppointStaff("admin")).toBe(false);
  });
});

describe("isModuleStaff", () => {
  it("lets any administrator work on any module", () => {
    expect(isModuleStaff("admin", 7, 3)).toBe(true);
    expect(isModuleStaff("admin", 7, null)).toBe(true);
  });

  it("lets a super admin do the same", () => {
    // The bug this rule exists to kill: every gate compared the stored role
    // against the word "admin", so the Lab's second super admin could not open
    // a module's slides, its coursework or its simulation.
    expect(isModuleStaff("superadmin", 7, 3)).toBe(true);
    expect(isModuleStaff("superadmin", 7, null)).toBe(true);
  });

  it("lets a facilitator work only on their own module", () => {
    expect(isModuleStaff("instructor", 7, 7)).toBe(true);
    expect(isModuleStaff("instructor", 7, 8)).toBe(false);
  });

  it("does not treat an unassigned module as everyone's", () => {
    // instructorId is null on a module nobody is teaching yet. A facilitator
    // must not inherit it, and a null-equals-null slip would give it to them.
    expect(isModuleStaff("instructor", 7, null)).toBe(false);
  });

  it("keeps learners and signed-out visitors out", () => {
    expect(isModuleStaff("learner", 7, 7)).toBe(false);
    expect(isModuleStaff(null, 7, 7)).toBe(false);
    expect(isModuleStaff("", 7, 7)).toBe(false);
  });
});
