import { describe, expect, it } from "vitest";
import { findPeople, describeAppointment, MIN_SEARCH, MAX_MATCHES } from "./findPeople";

const PEOPLE = [
  { id: 1, name: "Amina Bello", email: "amina@example.org", role: "learner" },
  { id: 2, name: "Kwame Mensah", email: "kwame@example.org", role: "learner" },
  { id: 3, name: "Ngozi Amina", email: "ngozi@example.org", role: "instructor" },
  { id: 4, name: "Thabo Nkosi", email: "thabo@aminacorp.com", role: "learner" },
  { id: 5, name: null, email: "quiet@example.org", role: "learner" },
  { id: 6, name: "Sipho Dlamini", email: null, role: "admin" },
];

describe("findPeople", () => {
  it("finds a learner by name, which is the whole point of it", () => {
    // The case that sent us here: an enrolled learner who must become an admin,
    // and who by design does not appear in the staff list.
    const found = findPeople("bello", PEOPLE);
    expect(found.map((p) => p.id)).toEqual([1]);
  });

  it("finds them by email too, and ignores case in both", () => {
    expect(findPeople("KWAME@EXAMPLE.ORG", PEOPLE).map((p) => p.id)).toEqual([2]);
    expect(findPeople("Thabo", PEOPLE).map((p) => p.id)).toEqual([4]);
  });

  it("puts a pasted whole address first, ahead of anything it merely resembles", () => {
    // "amina@example.org" also appears inside nothing else, but "amina" matches
    // three people; the exact address must not be third in its own search.
    const found = findPeople("amina@example.org", PEOPLE);
    expect(found[0].id).toBe(1);
  });

  it("ranks the beginning of a field above the middle of one", () => {
    const found = findPeople("amina", PEOPLE).map((p) => p.id);
    // 1 starts the email, 3 starts no field but starts no name either — "Ngozi
    // Amina" matches mid-name, and 4 matches mid-domain.
    expect(found[0]).toBe(1);
    expect(found).toContain(3);
    expect(found).toContain(4);
  });

  it("refuses to answer a query too short to mean anything", () => {
    expect(findPeople("a", PEOPLE)).toEqual([]);
    expect(findPeople("", PEOPLE)).toEqual([]);
    expect(findPeople("   ", PEOPLE)).toEqual([]);
    expect(MIN_SEARCH).toBe(2);
  });

  it("survives a missing name or a missing email", () => {
    expect(findPeople("quiet", PEOPLE).map((p) => p.id)).toEqual([5]);
    expect(findPeople("sipho", PEOPLE).map((p) => p.id)).toEqual([6]);
  });

  it("leaves out anybody the caller has already accounted for", () => {
    expect(findPeople("amina", PEOPLE, { exclude: [1] }).map((p) => p.id)).not.toContain(1);
  });

  it("keeps the shortlist short", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: 100 + i, name: `Person ${i}`, email: `person${i}@example.org`, role: "learner",
    }));
    expect(findPeople("person", many)).toHaveLength(MAX_MATCHES);
    expect(findPeople("person", many, { limit: 3 })).toHaveLength(3);
  });

  it("returns the same order for the same search", () => {
    const once = findPeople("example.org", PEOPLE).map((p) => p.id);
    const twice = findPeople("example.org", PEOPLE).map((p) => p.id);
    expect(once).toEqual(twice);
  });
});

describe("describeAppointment", () => {
  it("promises a learner keeps their place on the programme", () => {
    const line = describeAppointment(PEOPLE[0], "admin");
    expect(line).toContain("an admin");
    expect(line).toMatch(/keep their place/i);
  });

  it("says plainly when there is nothing to do", () => {
    expect(describeAppointment({ id: 9, name: "X", email: "x@y.org", role: "admin" }, "admin"))
      .toBe("Already an admin.");
    expect(describeAppointment({ id: 9, name: "X", email: "x@y.org", role: "instructor" }, "instructor"))
      .toBe("Already a facilitator.");
  });

  it("says what standing down costs, and what it does not", () => {
    const line = describeAppointment({ id: 9, name: "X", email: "x@y.org", role: "admin" }, "learner");
    expect(line).toMatch(/console/i);
    expect(line).toMatch(/account and their work stay/i);
  });
});
