import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { satisfiesRole, isStaffRole } from "@workspace/domain";

/**
 * `satisfiesRole` is not a hierarchy, and writing it as though it were locks
 * admins out of their own console.
 *
 * It answers one question: does somebody holding this role pass a check asking
 * for one of these roles? A super admin satisfies an admin check and nothing
 * else is implied — deliberately, because an instructor check guards one
 * person's own classroom rather than a level of seniority.
 *
 * So `satisfiesRole(role, ["instructor"])` reads like "instructors and above"
 * and means very nearly the opposite: it admits instructors and refuses every
 * admin and super admin in the Lab. It cost a whole admin screen, which drew
 * its heading and its dropdown and then nothing, for a reason no part of the
 * page could report.
 *
 * The two tests below are different on purpose. The first pins the semantics so
 * nobody changes them by accident. The second reads the route files, because
 * pinning the semantics does nothing to stop the next route being written on a
 * wrong assumption about them — which is exactly what happened.
 */

describe("what satisfiesRole actually means", () => {
  it("lets a super admin pass an admin check", () => {
    expect(satisfiesRole("superadmin", ["admin"])).toBe(true);
  });

  it("does NOT let an admin pass an instructor check", () => {
    // The trap, pinned. This is correct behaviour and reads as a bug, which is
    // why it needs saying out loud in a test rather than only in a comment.
    expect(satisfiesRole("admin", ["instructor"])).toBe(false);
    expect(satisfiesRole("superadmin", ["instructor"])).toBe(false);
  });

  it("admits all three staff roles when asked for instructor or admin", () => {
    for (const role of ["instructor", "admin", "superadmin"]) {
      expect(satisfiesRole(role, ["instructor", "admin"])).toBe(true);
    }
  });

  it("is what isStaffRole is for", () => {
    for (const role of ["instructor", "admin", "superadmin"]) {
      expect(isStaffRole(role)).toBe(true);
    }
    expect(isStaffRole("learner")).toBe(false);
    expect(isStaffRole(null)).toBe(false);
  });
});

describe("no route asks for instructor alone", () => {
  it("because that refuses every admin in the Lab", () => {
    const dir = path.join(__dirname);
    const offenders: string[] = [];

    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const source = readFileSync(path.join(dir, file), "utf8");
      for (const [i, line] of source.split("\n").entries()) {
        // Comments explaining the trap are not the trap.
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*")) continue;
        if (/satisfiesRole\([^,]+,\s*\[\s*["']instructor["']\s*\]\s*\)/.test(line)) {
          offenders.push(`${file}:${i + 1}`);
        }
      }
    }

    expect(
      offenders,
      `These ask for instructor alone, which refuses every admin and super admin. `
      + `Use isStaffRole(role) for "anybody on staff", or isModuleStaff(...) where the check `
      + `is really about this module's own instructor: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
