import { describe, expect, it } from "vitest";
import { studioInviteLetter, studioInviteParagraphs, studioInviteSubject } from "./studioInviteEmail";

const invite = {
  name: "Amina Bello",
  programmeTitle: "Energy Reporting",
  url: "https://energycommslab.africa/studio",
  logoUrl: "https://energycommslab.africa/logo-white.png",
};

describe("studioInviteSubject", () => {
  it("names the programme, so it does not read as a circular", () => {
    expect(studioInviteSubject(invite)).toContain("Energy Reporting");
  });

  it("still says something useful with no programme", () => {
    expect(studioInviteSubject({ ...invite, programmeTitle: null })).toMatch(/practice scenarios/i);
  });
});

describe("studioInviteParagraphs", () => {
  it("says what the Studio is before asking anybody to click", () => {
    const text = studioInviteParagraphs(invite).join(" ");
    expect(text).toMatch(/practise/i);
    expect(text).toMatch(/scenario/i);
  });

  it("promises privacy, because that is what makes people try", () => {
    // Somebody senior will not practise in front of an audience.
    const text = studioInviteParagraphs(invite).join(" ");
    expect(text).toMatch(/nobody else sees it/i);
    expect(text).toMatch(/not graded|nothing you do there is graded/i);
  });

  it("says how long it takes", () => {
    expect(studioInviteParagraphs(invite).join(" ")).toMatch(/half an hour/i);
  });

  it("is shorter than the joining invitation, because they have already joined", () => {
    expect(studioInviteParagraphs(invite).length).toBeLessThanOrEqual(5);
  });
});

describe("studioInviteLetter", () => {
  it("carries the link in the button and in full underneath", () => {
    const { html } = studioInviteLetter(invite);
    expect(html.split(invite.url).length - 1).toBeGreaterThanOrEqual(2);
  });

  it("includes a plain-text version", () => {
    const { text } = studioInviteLetter(invite);
    expect(text).toContain(invite.url);
    expect(text).not.toContain("<");
  });

  it("escapes a name and a programme title", () => {
    const { html } = studioInviteLetter({ ...invite, name: '<script>x</script>', programmeTitle: 'Gas & "Power"' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("addresses somebody with no name", () => {
    expect(studioInviteLetter({ ...invite, name: null }).html).toContain("Hello there,");
  });

  it("uses no dashes as punctuation, and British English", () => {
    const letter = studioInviteLetter(invite);
    for (const part of [letter.subject, letter.text]) {
      expect(part).not.toMatch(/[—–]/);
      expect(part).not.toMatch(/\s-\s/);
      expect(part).not.toMatch(/\bpractice\b(?!\s+scenario)/);
      expect(part).not.toMatch(/\borganiz|\brecogniz|\bcolor\b/);
    }
  });

  it("leads with the name in type when no logo is configured", () => {
    const { html } = studioInviteLetter({ ...invite, logoUrl: null });
    expect(html).not.toContain("<img");
    expect(html).toContain("Ananse Comms Lab");
  });
});
