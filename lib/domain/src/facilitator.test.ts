import { describe, expect, it } from "vitest";
import {
  describeFacilitatorChoice,
  facilitatorFields,
  facilitatorInputValue,
  matchFacilitator,
  type FacilitatorPerson,
} from "./facilitator";

const PEOPLE: FacilitatorPerson[] = [
  { id: 1, name: "Amina Bello", email: "amina@example.org" },
  { id: 2, name: "Kwame Mensah", email: "kwame@example.org" },
  { id: 3, name: "", email: "nameless@example.org" },
];

describe("matchFacilitator", () => {
  it("gives the class to somebody typed by name", () => {
    expect(matchFacilitator("Amina Bello", PEOPLE)).toEqual({
      kind: "account", instructorId: 1, name: "Amina Bello",
    });
  });

  it("does not care about case or stray spacing", () => {
    expect(matchFacilitator("  amina   bello ", PEOPLE)).toMatchObject({ kind: "account", instructorId: 1 });
  });

  it("accepts an email address", () => {
    expect(matchFacilitator("KWAME@example.org", PEOPLE)).toMatchObject({ kind: "account", instructorId: 2 });
  });

  it("falls back to the email when the account has no name", () => {
    expect(matchFacilitator("nameless@example.org", PEOPLE)).toEqual({
      kind: "account", instructorId: 3, name: "nameless@example.org",
    });
  });

  it("treats an unknown name as a guest", () => {
    expect(matchFacilitator("Dr Ngozi Okonjo", PEOPLE)).toEqual({ kind: "guest", name: "Dr Ngozi Okonjo" });
  });

  it.each(["", "   ", null, undefined])("treats %s as nobody", (value) => {
    expect(matchFacilitator(value as string, PEOPLE)).toEqual({ kind: "none" });
  });

  it("refuses to choose between two people of the same name", () => {
    // A coin toss here would hand one Amina the other Amina's learners.
    const twins: FacilitatorPerson[] = [
      { id: 1, name: "Amina Bello", email: "amina@example.org" },
      { id: 4, name: "Amina Bello", email: "a.bello@example.org" },
    ];
    const choice = matchFacilitator("Amina Bello", twins);
    expect(choice.kind).toBe("ambiguous");
    expect(describeFacilitatorChoice(choice)).toMatch(/email/i);
  });

  it("an email still decides between two of the same name", () => {
    const twins: FacilitatorPerson[] = [
      { id: 1, name: "Amina Bello", email: "amina@example.org" },
      { id: 4, name: "Amina Bello", email: "a.bello@example.org" },
    ];
    expect(matchFacilitator("a.bello@example.org", twins)).toMatchObject({ kind: "account", instructorId: 4 });
  });

  it("cuts an absurdly long guest name down", () => {
    const choice = matchFacilitator("x".repeat(500), PEOPLE);
    expect(choice.kind).toBe("guest");
    if (choice.kind === "guest") expect(choice.name.length).toBe(120);
  });

  it("works with no accounts at all", () => {
    expect(matchFacilitator("Anyone", [])).toEqual({ kind: "guest", name: "Anyone" });
  });
});

describe("facilitatorFields", () => {
  it("an account clears any name left over from a guest", () => {
    expect(facilitatorFields(matchFacilitator("Amina Bello", PEOPLE))).toEqual({
      instructorId: 1, guestFacilitator: null,
    });
  });

  it("a guest clears the account, so the page has one answer not two", () => {
    expect(facilitatorFields(matchFacilitator("Visiting Editor", PEOPLE))).toEqual({
      instructorId: null, guestFacilitator: "Visiting Editor",
    });
  });

  it("an empty box removes the facilitator", () => {
    expect(facilitatorFields(matchFacilitator("", PEOPLE))).toEqual({
      instructorId: null, guestFacilitator: null,
    });
  });

  it("never sets both at once", () => {
    for (const typed of ["Amina Bello", "Visiting Editor", "", "amina@example.org"]) {
      const { instructorId, guestFacilitator } = facilitatorFields(matchFacilitator(typed, PEOPLE));
      expect(instructorId === null || guestFacilitator === null).toBe(true);
    }
  });
});

describe("facilitatorInputValue", () => {
  it("shows the account holder's name", () => {
    expect(facilitatorInputValue({ instructorName: "Amina Bello", guestFacilitator: null })).toBe("Amina Bello");
  });

  it("shows a guest's name when there is no account", () => {
    expect(facilitatorInputValue({ instructorName: null, guestFacilitator: "Visiting Editor" })).toBe("Visiting Editor");
  });

  it("is empty when nobody is assigned", () => {
    expect(facilitatorInputValue({})).toBe("");
  });

  it("round-trips: what the box shows is what it matched", () => {
    const shown = facilitatorInputValue({ instructorName: "Amina Bello" });
    expect(matchFacilitator(shown, PEOPLE)).toMatchObject({ kind: "account", instructorId: 1 });
  });
});
