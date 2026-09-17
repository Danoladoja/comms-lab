import { describe, expect, it } from "vitest";
import { appPath } from "./appPath";

/**
 * The bug this exists to prevent is not a cosmetic one.
 *
 * `BASE_PATH` is "/" here, and "/" + "/admin" is "//admin" — which a browser
 * reads as a protocol-relative URL and resolves as *the host called admin*. An
 * administrator finishing the Google connection landed on a DNS error, and the
 * page that would have explained the failure was the one they could not reach.
 */
describe("building a link inside the app", () => {
  it("does not produce a protocol-relative URL from a base of /", () => {
    expect(appPath("/", "/admin")).toBe("/admin");
    expect(appPath("/", "/admin?google=error")).toBe("/admin?google=error");
    // The tell-tale: two slashes at the front is a hostname, not a path.
    expect(appPath("/", "/admin").startsWith("//")).toBe(false);
  });

  it("keeps a real sub-path", () => {
    expect(appPath("/lab", "/admin")).toBe("/lab/admin");
    expect(appPath("/lab/", "/admin")).toBe("/lab/admin");
    expect(appPath("/lab///", "/admin")).toBe("/lab/admin");
  });

  it("copes with no base at all", () => {
    for (const none of ["", null, undefined]) {
      expect(appPath(none, "/admin")).toBe("/admin");
    }
  });

  it("copes with a path that forgot its slash", () => {
    expect(appPath("/", "admin")).toBe("/admin");
    expect(appPath("/lab", "admin")).toBe("/lab/admin");
  });
});
