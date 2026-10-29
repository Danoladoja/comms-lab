import { describe, expect, it } from "vitest";
import { MAX_LEARNER_NAME, certificateName, learnerNameProblem } from "./learnerName";

describe("certificateName", () => {
  it("prints a real name", () => {
    expect(certificateName({ name: "Adaeze Mbanefo", email: "adaeze@example.com" }))
      .toBe("Adaeze Mbanefo");
  });

  it("trims, because a name with a trailing space is still that name", () => {
    expect(certificateName({ name: "  Kwame Mensah  ", email: "k@example.com" }))
      .toBe("Kwame Mensah");
  });

  it("refuses the email fallback sitting in the name column", () => {
    // The live fault: Clerk had no first or last name, so sign-in wrote the
    // address here, and the sheet printed it.
    expect(certificateName({ name: "amina@example.com", email: "amina@example.com" })).toBeNull();
  });

  it("refuses any address, even one that is not this person's", () => {
    expect(certificateName({ name: "someone.else@example.com", email: "amina@example.com" }))
      .toBeNull();
  });

  it("refuses the address regardless of case", () => {
    expect(certificateName({ name: "Amina@Example.com", email: "amina@example.com" })).toBeNull();
  });

  it("refuses a blank, a space and a single character", () => {
    for (const name of ["", "   ", "A"]) {
      expect(certificateName({ name, email: "a@example.com" })).toBeNull();
    }
  });

  it("refuses a string with no letter in it", () => {
    expect(certificateName({ name: "....", email: "a@example.com" })).toBeNull();
    expect(certificateName({ name: "1234", email: "a@example.com" })).toBeNull();
  });

  it("accepts a name written in a non-Latin script", () => {
    expect(certificateName({ name: "أمينة ديالو", email: "a@example.com" })).toBe("أمينة ديالو");
  });

  it("copes with nothing at all stored", () => {
    expect(certificateName({})).toBeNull();
    expect(certificateName({ name: null, email: null })).toBeNull();
  });
});

describe("learnerNameProblem", () => {
  it("accepts a name", () => {
    expect(learnerNameProblem("Rosemary Akpo-Ga Emmanuel")).toBeNull();
  });

  it("asks for something when nothing was typed", () => {
    expect(learnerNameProblem("   ")).toMatch(/certificate/i);
  });

  it("says so when an address was pasted in", () => {
    expect(learnerNameProblem("amina@example.com")).toMatch(/email address/i);
  });

  it("refuses one too long to fit the sheet", () => {
    expect(learnerNameProblem("a".repeat(MAX_LEARNER_NAME + 1))).toMatch(/at most/i);
    expect(learnerNameProblem("a".repeat(MAX_LEARNER_NAME))).toBeNull();
  });

  it("refuses punctuation on its own", () => {
    expect(learnerNameProblem("---")).toMatch(/letter/i);
  });

  it("agrees with certificateName: anything it accepts is printable", () => {
    // The two have to agree, or a learner types a name the server takes and
    // the certificate still withholds itself with nothing to show them.
    for (const name of ["Adaeze Mbanefo", "O. Salako", "أمينة ديالو", "Jo"]) {
      expect(learnerNameProblem(name)).toBeNull();
      expect(certificateName({ name, email: "someone@example.com" })).toBe(name);
    }
  });
});
