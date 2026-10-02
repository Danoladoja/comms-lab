import { describe, expect, it } from "vitest";
import {
  labLetterHtml, labLetterText, labGreeting, paragraphsFrom,
  LAB_COLOURS, LAB_TAGLINE, LAB_CONTACT_EMAIL,
} from "./labLetter";

/**
 * Every email the Lab sends goes through this, and until now none of it was
 * tested.
 *
 * That was tolerable while nothing else used it. It stopped being tolerable the
 * moment the survey started drawing from the same palette: a change made for
 * the benefit of a web page can now quietly alter forty-five inboxes, and the
 * failure would show up as an email that looks wrong to somebody who never
 * tells us.
 *
 * So these tests pin the two things that matter and nothing else. The letter's
 * structure, because a learner who meets four of these in a fortnight must not
 * see four different-looking things. And the escaping, because this text is
 * typed by an admin and sent to fifty people.
 */

const letter = {
  greetingName: "Pauline Ungaji",
  paragraphs: ["The first thing.", "The second thing."],
  action: { label: "Open the Lab", url: "https://energycommslab.africa/dashboard", showUrl: true },
  footnote: "You can ignore this if it was not meant for you.",
  logoUrl: "https://energycommslab.africa/logo-white.png",
};

describe("the Lab's letter", () => {
  it("uses the first name only, and never leaves a hole where one should be", () => {
    expect(labGreeting("Pauline Ungaji")).toBe("Pauline");
    expect(labGreeting("")).toBe("there");
    expect(labGreeting(null)).toBe("there");
    expect(labLetterHtml(letter)).toContain("Hello Pauline,");
  });

  it("carries the masthead, the tagline and the Lab's contact", () => {
    const html = labLetterHtml(letter);
    expect(html).toContain(LAB_COLOURS.ink);
    expect(html).toContain(LAB_TAGLINE);
    expect(html).toContain(LAB_CONTACT_EMAIL);
  });

  it("sets the Lab's name in type when the logo cannot load", () => {
    // Most clients block images until the reader allows them. An email whose
    // only identification is a blocked image is an email from nobody.
    expect(labLetterHtml({ ...letter, logoUrl: null })).toContain("Ananse Comms Lab");
  });

  it("prints the address under a button that asks it to", () => {
    expect(labLetterHtml(letter)).toContain("copy this address into your browser");
    expect(labLetterHtml({ ...letter, action: { label: "Go", url: "https://x.test" } }))
      .not.toContain("copy this address");
  });

  it("escapes what an admin typed", () => {
    // This text reaches fifty inboxes. A stray angle bracket should arrive as
    // a stray angle bracket, not as a broken letter.
    const html = labLetterHtml({
      ...letter,
      paragraphs: ['A <script>alert("x")</script> and an & ampersand.'],
    });
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
  });

  it("uses the one accent colour, not a second orange", () => {
    // The survey draws from these same constants. Two near-identical oranges
    // across an email and a web page read as two organisations.
    expect(labLetterHtml(letter)).toContain(LAB_COLOURS.accent);
  });

  it("always has a plain-text version carrying the same link", () => {
    const text = labLetterText(letter);
    expect(text).toContain("Hello Pauline,");
    expect(text).toContain("The first thing.");
    expect(text).toContain(letter.action.url);
  });

  it("turns what somebody typed into paragraphs the way they wrote it", () => {
    expect(paragraphsFrom("One line.\n\nTwo lines.\nStill two.")).toEqual([
      "One line.",
      "Two lines. Still two.",
    ]);
    expect(paragraphsFrom("   ")).toEqual([]);
  });
});
