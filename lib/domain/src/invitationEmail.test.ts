import { describe, expect, it } from "vitest";
import {
  INVITATION_CONTACT_EMAIL,
  invitationGreeting,
  invitationLetter,
  invitationParagraphs,
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
    // Wording changed with the warmer draft: it now welcomes rather than
    // announcing an invitation, which is the same promise in friendlier words.
    expect(invitationSubject({ ...learner, programmeTitle: null })).toMatch(/welcome/i);
  });

  it("speaks to a facilitator as a facilitator", () => {
    expect(invitationSubject({ ...learner, role: "instructor" })).toMatch(/facilitate/i);
  });

  it("speaks to an admin as an admin", () => {
    expect(invitationSubject({ ...learner, role: "admin" })).toMatch(/run/i);
  });
});

describe("invitationParagraphs", () => {
  it("opens by telling a learner what they have and when it starts", () => {
    const [first] = invitationParagraphs(learner);
    expect(first).toContain("Energy Reporting");
    expect(first).toContain("Nov 2026");
  });

  it("copes with a programme whose start is not set", () => {
    const [first] = invitationParagraphs({ ...learner, programmeStart: null });
    expect(first).toContain("Energy Reporting");
    expect(first).not.toMatch(/starting\s*[.,]/);
  });

  it("does not promise a place to a facilitator", () => {
    expect(invitationParagraphs({ ...learner, role: "instructor" }).join(" ")).not.toMatch(/place on/i);
  });

  it("thanks a facilitator rather than congratulating them", () => {
    // They are giving their time. Being congratulated on winning a place would
    // read as though we had not noticed which way the favour runs.
    const text = invitationParagraphs({ ...learner, role: "instructor" }).join(" ");
    expect(text).toMatch(/thank you/i);
    expect(text).not.toMatch(/congratulations/i);
  });

  it("says what the Lab is, not only what the button does", () => {
    const text = invitationParagraphs(learner).join(" ");
    expect(text).toMatch(/energy communicators/i);
    expect(text).toMatch(/practical/i);
  });

  it("tells a learner what they will find, and gives them somewhere to write", () => {
    const text = invitationParagraphs(learner).join(" ");
    expect(text).toMatch(/recordings/i);
    expect(text).toContain(INVITATION_CONTACT_EMAIL);
  });

  it("promises no password, because that is the point of an invitation", () => {
    for (const role of ["learner", "instructor", "admin"] as const) {
      expect(invitationParagraphs({ ...learner, role }).join(" ")).toMatch(/no password/i);
    }
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

  it("carries the logo when there is one, with the name in type as well", () => {
    // Most clients block images until the reader allows them, so the logo can
    // never be the only thing saying who this is from.
    const { html } = invitationLetter({ ...learner, logoUrl: "https://energycommslab.africa/logo-white.png" });
    expect(html).toContain('src="https://energycommslab.africa/logo-white.png"');
    expect(html).toContain('alt="Ananse Comms Lab"');
    expect(html).toMatch(/energy communicators/i);
  });

  it("falls back to the name set in type when no logo address is configured", () => {
    const { html } = invitationLetter({ ...learner, logoUrl: null });
    expect(html).not.toContain("<img");
    expect(html).toContain("Ananse Comms Lab");
  });

  it("escapes a logo address rather than trusting it into an attribute", () => {
    const { html } = invitationLetter({ ...learner, logoUrl: 'https://x/y.png" onerror="alert(1)' });
    expect(html).not.toContain('onerror="alert(1)"');
  });

  it("uses no dashes as punctuation anywhere the reader sees", () => {
    // A house style decision: sentences, commas and colons rather than dashes.
    // Hyphenated words like practitioner-led are words, not punctuation, and stay.
    for (const role of ["learner", "instructor", "admin"] as const) {
      const letter = invitationLetter({ ...learner, role });
      for (const part of [letter.subject, letter.text, letter.html]) {
        expect(part).not.toMatch(/[—–]/);
        expect(part).not.toMatch(/\s-\s/);
      }
    }
  });

  it("is written in British English", () => {
    const letter = invitationLetter(learner);
    const words = `${letter.subject} ${letter.text}`;
    expect(words).toMatch(/programme/);
    expect(words).not.toMatch(/\bprogram\b/);
    expect(words).not.toMatch(/\benroll(ed|ment)\b/);
    expect(words).not.toMatch(/\borganiz|\brecogniz|\bcolor\b/);
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
