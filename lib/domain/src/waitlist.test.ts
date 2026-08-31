import { describe, expect, it } from "vitest";
import {
  ANY_PROGRAMME,
  MAX_WAITLIST_NAME,
  describeWaitlist,
  isPlausibleWaitlistEmail,
  isWaitlistStatus,
  normaliseWaitlistEmail,
  stripControl,
  validateWaitlistSignup,
  waitlistConfirmation,
  waitlistStatusLabel,
} from "./waitlist";

const good = { name: "Amina Bello", email: "amina@example.org", programme: "3" };

describe("validateWaitlistSignup", () => {
  it("accepts a filled-in form", () => {
    const result = validateWaitlistSignup(good);
    expect(result).toEqual({
      ok: true,
      signup: { name: "Amina Bello", email: "amina@example.org", programId: 3, note: "" },
    });
  });

  it("accepts somebody waiting for whatever comes next", () => {
    const result = validateWaitlistSignup({ ...good, programme: ANY_PROGRAMME });
    expect(result.ok && result.signup.programId).toBeNull();
  });

  it("treats a missing programme as any future cohort rather than refusing", () => {
    // Nobody should lose their place because a picker did not load.
    const result = validateWaitlistSignup({ name: "Amina", email: "amina@example.org" });
    expect(result.ok).toBe(true);
  });

  it("lowercases and trims the address, so one person is not listed twice", () => {
    const result = validateWaitlistSignup({ ...good, email: "  Amina@Example.ORG " });
    expect(result.ok && result.signup.email).toBe("amina@example.org");
  });

  it("collapses the spacing in a name", () => {
    const result = validateWaitlistSignup({ ...good, name: "  Amina   Bello  " });
    expect(result.ok && result.signup.name).toBe("Amina Bello");
  });

  it.each([
    ["", /name/i],
    ["A", /name/i],
  ])("refuses the name %s with a sentence, not a field name", (name, expected) => {
    const result = validateWaitlistSignup({ ...good, name });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatch(expected);
  });

  it.each(["", "amina", "amina@", "@example.org", "amina@nodot", "am ina@example.org"])(
    "refuses the address %s",
    (email) => {
      const result = validateWaitlistSignup({ ...good, email });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problem).toMatch(/email/i);
    },
  );

  it("refuses a programme that is not a number", () => {
    const result = validateWaitlistSignup({ ...good, programme: "the one about pipelines" });
    expect(result.ok).toBe(false);
  });

  it("turns away a filled hidden field without explaining why", () => {
    const result = validateWaitlistSignup({ ...good, trap: "http://spam.example" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).not.toMatch(/hidden|bot|trap/i);
  });

  it("cuts an over-long name rather than refusing the person", () => {
    const result = validateWaitlistSignup({ ...good, name: "A".repeat(400) });
    expect(result.ok && result.signup.name.length).toBe(MAX_WAITLIST_NAME);
  });

  it("strips control characters a paste can carry", () => {
    const result = validateWaitlistSignup({ ...good, name: `Amina${String.fromCharCode(0x0b)} Bello` });
    expect(result.ok && result.signup.name).toBe("Amina Bello");
  });

  it("keeps a note when one is given", () => {
    const result = validateWaitlistSignup({ ...good, note: "I cover gas policy for a daily." });
    expect(result.ok && result.signup.note).toMatch(/gas policy/);
  });
});

describe("isPlausibleWaitlistEmail", () => {
  it.each([
    "a.b+cohort@sub.example.co.uk",
    "amina@example.africa",
    "kwame@energy-desk.example.org",
  ])("accepts the real address %s", (email) => {
    expect(isPlausibleWaitlistEmail(email)).toBe(true);
  });

  it.each(["a@b.c.", "a@.b.c", "a@b..c", "a b@c.d"])("refuses %s", (email) => {
    expect(isPlausibleWaitlistEmail(email)).toBe(false);
  });
});

describe("stripControl and normaliseWaitlistEmail", () => {
  it("removes control characters but keeps accents", () => {
    expect(stripControl(`Ngozi${String.fromCharCode(7)} Okónjo`)).toBe("Ngozi Okónjo");
  });

  it("copes with anything that is not text", () => {
    expect(normaliseWaitlistEmail(null)).toBe("");
    expect(normaliseWaitlistEmail(42)).toBe("");
  });
});

describe("wording", () => {
  it("names the programme when there is one", () => {
    expect(waitlistConfirmation("Energy Reporting")).toContain("Energy Reporting");
  });

  it("still says something useful for any future cohort", () => {
    expect(waitlistConfirmation(null)).toMatch(/next cohort/i);
  });

  it("labels the states in plain words", () => {
    expect(waitlistStatusLabel("waiting")).toBe("Waiting");
    expect(waitlistStatusLabel("declined")).toBe("Not this time");
    expect(waitlistStatusLabel("nonsense")).toBe("Waiting");
  });

  it("summarises only what there is to say", () => {
    expect(describeWaitlist({ waiting: 12, invited: 0, declined: 0 })).toBe("12 waiting.");
    expect(describeWaitlist({ waiting: 12, invited: 3, declined: 1 })).toBe(
      "12 waiting, 3 already invited, 1 set aside.",
    );
  });

  it("knows its own states", () => {
    expect(isWaitlistStatus("waiting")).toBe(true);
    expect(isWaitlistStatus("pending")).toBe(false);
  });
});
