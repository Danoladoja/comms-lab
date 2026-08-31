import { describe, expect, it } from "vitest";
import {
  roleFromPublicMetadata,
  invitableRoleFromPublicMetadata,
  isRole,
  isInvitableRole,
  normaliseEmail,
  isPlausibleEmail,
  validateInvite,
  planAssignments,
  describeInvite,
  INVITABLE_ROLES,
  MAX_SESSIONS_PER_INVITE,
} from "./invitations";

describe("roleFromPublicMetadata", () => {
  it("reads a role an admin set when inviting", () => {
    expect(roleFromPublicMetadata({ role: "instructor" })).toBe("instructor");
    expect(roleFromPublicMetadata({ role: "learner" })).toBe("learner");
    expect(roleFromPublicMetadata({ role: "admin" })).toBe("admin");
  });

  it("returns nothing when there is no role", () => {
    expect(roleFromPublicMetadata({})).toBeNull();
    expect(roleFromPublicMetadata({ other: "instructor" })).toBeNull();
  });

  it("refuses anything that is not a known role", () => {
    // A typo must not become a role. It falls back to the caller's default.
    expect(roleFromPublicMetadata({ role: "Instructor" })).toBeNull();
    expect(roleFromPublicMetadata({ role: "superadmin" })).toBeNull();
    expect(roleFromPublicMetadata({ role: "" })).toBeNull();
  });

  it("refuses a role that is not a string", () => {
    expect(roleFromPublicMetadata({ role: 1 })).toBeNull();
    expect(roleFromPublicMetadata({ role: true })).toBeNull();
    expect(roleFromPublicMetadata({ role: ["admin"] })).toBeNull();
    expect(roleFromPublicMetadata({ role: { valueOf: () => "admin" } })).toBeNull();
  });

  it("copes with metadata that is not an object at all", () => {
    expect(roleFromPublicMetadata(null)).toBeNull();
    expect(roleFromPublicMetadata(undefined)).toBeNull();
    expect(roleFromPublicMetadata("admin")).toBeNull();
    expect(roleFromPublicMetadata(42)).toBeNull();
  });
});

describe("invitableRoleFromPublicMetadata", () => {
  it("grants the roles an invitation is allowed to grant", () => {
    expect(invitableRoleFromPublicMetadata({ role: "instructor" })).toBe("instructor");
    expect(invitableRoleFromPublicMetadata({ role: "learner" })).toBe("learner");
  });

  it("refuses admin even though it is a real role", () => {
    // The invariant has to hold when reading, not only when sending. Anyone
    // with Clerk dashboard access — a different privilege from being an admin
    // here — can set whatever metadata they like using Clerk's own invite
    // button, bypassing validateInvite entirely.
    expect(roleFromPublicMetadata({ role: "admin" })).toBe("admin");
    expect(invitableRoleFromPublicMetadata({ role: "admin" })).toBeNull();
  });

  it("refuses nonsense, as the wider reader does", () => {
    expect(invitableRoleFromPublicMetadata({ role: "owner" })).toBeNull();
    expect(invitableRoleFromPublicMetadata(null)).toBeNull();
  });
});

describe("isRole / isInvitableRole", () => {
  it("knows the three roles", () => {
    expect(isRole("learner")).toBe(true);
    expect(isRole("instructor")).toBe(true);
    expect(isRole("admin")).toBe(true);
    expect(isRole("facilitator")).toBe(false);
  });

  it("will not let an emailed link grant admin", () => {
    // An invitation is a link in an inbox: forwardable, mistypeable, and
    // sometimes read by someone else. A wrong facilitator can be fixed; a
    // wrong admin can delete the programme.
    expect(isInvitableRole("admin")).toBe(false);
    expect(INVITABLE_ROLES).not.toContain("admin");
  });

  it("allows the two roles that are safe to grant by email", () => {
    expect(isInvitableRole("instructor")).toBe(true);
    expect(isInvitableRole("learner")).toBe(true);
  });
});

describe("email handling", () => {
  it("lowercases and trims", () => {
    expect(normaliseEmail("  Ada.Lovelace@Example.ORG ")).toBe("ada.lovelace@example.org");
  });

  it("accepts ordinary addresses", () => {
    expect(isPlausibleEmail("ada@example.org")).toBe(true);
    expect(isPlausibleEmail("ada.lovelace+lab@sub.example.co.uk")).toBe(true);
  });

  it("rejects obvious mistakes", () => {
    expect(isPlausibleEmail("ada")).toBe(false);
    expect(isPlausibleEmail("ada@example")).toBe(false);
    expect(isPlausibleEmail("ada@@example.org")).toBe(false);
    expect(isPlausibleEmail("ada lovelace@example.org")).toBe(false);
    expect(isPlausibleEmail("")).toBe(false);
  });

  it("rejects an address long enough to be an attack rather than a typo", () => {
    expect(isPlausibleEmail(`${"a".repeat(400)}@example.org`)).toBe(false);
  });
});

describe("validateInvite", () => {
  it("accepts a straightforward facilitator invitation", () => {
    const { invite, problems } = validateInvite({
      email: " Ada@Example.org ",
      role: "instructor",
      sessionIds: [3, 7],
    });
    expect(problems).toEqual([]);
    expect(invite).toEqual({ email: "ada@example.org", role: "instructor", sessionIds: [3, 7] });
  });

  it("defaults to facilitator, since that is what invitations are for", () => {
    const { invite } = validateInvite({ email: "ada@example.org" });
    expect(invite!.role).toBe("instructor");
    expect(invite!.sessionIds).toEqual([]);
  });

  it("refuses an admin invitation sent by an admin, and says who can send one", () => {
    // The rule changed when super admins arrived: inviting an admin is no
    // longer impossible, it is simply not this person's to do.
    const { invite, problems } = validateInvite({ email: "ada@example.org", role: "admin" });
    expect(invite).toBeNull();
    expect(problems[0]).toMatch(/super admin/i);
  });

  it("lets a super admin invite an admin", () => {
    const { invite } = validateInvite({ email: "ada@example.org", role: "admin", actorRole: "superadmin" });
    expect(invite).toMatchObject({ email: "ada@example.org", role: "admin" });
  });

  it("nobody invites a super admin, not even a super admin", () => {
    for (const actorRole of ["superadmin", "admin", undefined]) {
      const { invite, problems } = validateInvite({ email: "ada@example.org", role: "superadmin", actorRole });
      expect(invite).toBeNull();
      expect(problems[0]).toMatch(/People list|Choose a role/i);
    }
  });

  it("a facilitator cannot send invitations at all", () => {
    const { invite } = validateInvite({ email: "ada@example.org", role: "learner", actorRole: "instructor" });
    expect(invite).toBeNull();
  });

  it("rejects a role that is not a role at all", () => {
    const { invite, problems } = validateInvite({ email: "ada@example.org", role: "owner" });
    expect(invite).toBeNull();
    expect(problems.join(" ")).toMatch(/Choose a role/);
  });

  it("asks for an email when there is none", () => {
    expect(validateInvite({}).problems[0]).toMatch(/Enter the facilitator/);
  });

  it("catches a mistyped address before the invitation is spent", () => {
    expect(validateInvite({ email: "ada@example" }).problems[0]).toMatch(/does not look like/);
  });

  it("drops duplicate and nonsense class ids", () => {
    const { invite } = validateInvite({ email: "a@b.org", sessionIds: [3, 3, 0, -1, 7, 1.5] });
    expect(invite!.sessionIds).toEqual([3, 7]);
  });

  it("refuses an invitation covering an implausible number of classes", () => {
    const many = Array.from({ length: MAX_SESSIONS_PER_INVITE + 1 }, (_, i) => i + 1);
    const { invite, problems } = validateInvite({ email: "a@b.org", sessionIds: many });
    expect(invite).toBeNull();
    expect(problems.join(" ")).toMatch(/at most/);
  });
});

describe("planAssignments", () => {
  const sessions = [
    { id: 1, instructorId: null },
    { id: 2, instructorId: 99 },
    { id: 3, instructorId: null },
  ];

  it("assigns the classes that have nobody teaching them", () => {
    const out = planAssignments([1, 3], sessions);
    expect(out.assigned).toEqual([1, 3]);
    expect(out.alreadyTaken).toEqual([]);
  });

  it("never takes a class off whoever is already teaching it", () => {
    // An invitation accepted three weeks late must not quietly replace the
    // person standing in front of that cohort.
    const out = planAssignments([1, 2], sessions);
    expect(out.assigned).toEqual([1]);
    expect(out.alreadyTaken).toEqual([2]);
  });

  it("reports a class that has since been deleted", () => {
    const out = planAssignments([1, 42], sessions);
    expect(out.assigned).toEqual([1]);
    expect(out.missing).toEqual([42]);
  });

  it("does nothing when nothing was asked for", () => {
    expect(planAssignments([], sessions)).toEqual({ assigned: [], alreadyTaken: [], missing: [] });
  });
});

describe("describeInvite", () => {
  it("says what was granted and when, in words an admin reads", () => {
    const line = describeInvite({
      email: "ada@example.org",
      role: "instructor",
      sessionCount: 2,
      createdAt: new Date("2026-08-30T10:00:00Z"),
    });
    expect(line).toBe("Invited as facilitator with 2 classes on 30 August.");
  });

  it("reads correctly for one class", () => {
    expect(describeInvite({ email: "a@b.org", role: "instructor", sessionCount: 1, createdAt: new Date("2026-08-30T10:00:00Z") }))
      .toContain("1 class on");
  });

  it("says so when no classes were attached", () => {
    expect(describeInvite({ email: "a@b.org", role: "instructor", sessionCount: 0, createdAt: new Date("2026-08-30T10:00:00Z") }))
      .toContain("no classes yet");
  });

  it("survives an unreadable date", () => {
    const line = describeInvite({ email: "a@b.org", role: "learner", sessionCount: 0, createdAt: "nonsense" });
    expect(line).not.toMatch(/Invalid/);
  });
});
