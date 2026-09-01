import { describe, expect, it } from "vitest";
import {
  invitationGreeting,
  invitationLetter,
  invitationPurpose,
  invitationSubject,
} from "./invitationEmail";

const LINK = "https://energycommslab.africa/sign-up?__clerk_ticket=abc123";

const learner = {
  role: "learner" as const,
  name: "Amina Bello",
  programmeTitle: "Energy Reporting",
  programmeStart: "Nov 2026",
  url: LINK,
};

describe("invitationGreeting", () => {
  it("uses a first name", () => {
    expect(invitationGreeting("Amina Bello")).toBe("Amina");
  });

  it.each([null, undefined, "", "   "])("falls back to 'there' for %s", (name) => {
    // A roster row with no name must not produce "Hi ,".
    expect(invitationGreeting(name as string)).toBe("there");
  });
});

describe("invitationSubject", () => {
  it("names the programme for a learner", () => {
    expect(invitationSubject(learner)).toContain("Energy Reporting");
  });

  it("still says something useful with no programme", () => {
    expect(invitationSubject({ ...learner, programmeTitle: null })).toMatch(/invitation/i);
  });

  it("speaks to a facilitator as a facilitator", () => {
    expect(invitationSubject({ ...learner, role: "instructor" })).toMatch(/facilitate/i);
  });

  it("speaks to an admin as an admin", () => {
    expect(invitationSubject({ ...learner, role: "admin" })).toMatch(/run/i);
  });
});

describe("invitationPurpose", () => {
  it("tells a learner what they have and when it starts", () => {
    const purpose = invitationPurpose(learner);
    expect(purpose).toContain("Energy Reporting");
    expect(purpose).toContain("Nov 2026");
  });

  it("copes with a programme whose start is not set", () => {
    const purpose = invitationPurpose({ ...learner, programmeStart: null });
    expect(purpose).toContain("Energy Reporting");
    expect(purpose).not.toMatch(/starting\s*[.,]/);
  });

  it("does not promise a place to a facilitator", () => {
    expect(invitationPurpose({ ...learner, role: "instructor" })).not.toMatch(/place on/i);
  });
});

describe("invitationLetter", () => {
  it("carries the link in the button and in full underneath", () => {
    // Half of this cohort reads mail on a phone. A button that does not render
    // must not be the only way in.
    const { html } = invitationLetter(learner);
    expect(html).toContain(`href="${LINK}"`);
    expect(html.split(LINK).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("includes a plain-text version for clients that strip HTML", () => {
    const { text } = invitationLetter(learner);
    expect(text).toContain(LINK);
    expect(text).toContain("Amina");
    expect(text).not.toContain("<");
  });

  it("escapes a name so a roster cannot inject markup", () => {
    // Names come from a spreadsheet somebody pasted in.
    const { html } = invitationLetter({ ...learner, name: '<script>alert("x")</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes a programme title too", () => {
    const { html, subject } = invitationLetter({ ...learner, programmeTitle: 'Gas & "Power"' });
    expect(html).toContain("Gas &amp;");
    expect(subject).toContain('Gas & "Power"');
  });

  it("says the link is single-use and can be ignored", () => {
    // The two sentences that separate a real invitation from a phishing email.
    const { html } = invitationLetter(learner);
    expect(html).toMatch(/once/i);
    expect(html).toMatch(/ignore/i);
  });

  it("addresses somebody with no name at all", () => {
    const { html } = invitationLetter({ ...learner, name: null });
    expect(html).toContain("Hello there,");
  });
});
