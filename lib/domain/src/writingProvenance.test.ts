import { describe, expect, it } from "vitest";
import {
  disclosureProblem,
  aiUseLabel,
  isAiUse,
  describeProvenance,
  worthALook,
  thinCritique,
  EMPTY_PROVENANCE,
  MAX_AI_NOTE_CHARS,
  type Provenance,
} from "./writingProvenance";

const wrote = (over: Partial<Provenance> = {}): Provenance => ({
  ...EMPTY_PROVENANCE,
  activeSeconds: 47 * 60,
  sittings: 3,
  finalChars: 4000,
  ...over,
});

describe("the disclosure", () => {
  it("has to be answered", () => {
    // Required is the whole point: the four seconds it costs are the teaching.
    expect(disclosureProblem(undefined, "")).toMatch(/before you submit/i);
    expect(disclosureProblem("", "")).toMatch(/before you submit/i);
    expect(disclosureProblem("maybe-a-bit", "")).toMatch(/before you submit/i);
  });

  it("accepts each of the honest answers", () => {
    for (const use of ["none", "research", "edit", "draft-then-rewrote"]) {
      expect(disclosureProblem(use, "")).toBeNull();
    }
  });

  it("will not take “something else” without the else", () => {
    // Otherwise it is not a disclosure, it is a shrug.
    expect(disclosureProblem("other", "")).toMatch(/say in a line/i);
    expect(disclosureProblem("other", "  ")).toMatch(/say in a line/i);
    expect(disclosureProblem("other", "I used it to translate two quotations.")).toBeNull();
  });

  it("keeps the note short", () => {
    expect(disclosureProblem("none", "x".repeat(MAX_AI_NOTE_CHARS))).toBeNull();
    expect(disclosureProblem("none", "x".repeat(MAX_AI_NOTE_CHARS + 1))).toMatch(/under/i);
  });

  it("says a piece filed before the question existed was not declared", () => {
    // Rather than implying the writer refused to answer.
    expect(aiUseLabel(null)).toBe("Not declared");
    expect(aiUseLabel("")).toBe("Not declared");
    expect(aiUseLabel("edit")).toMatch(/edit and tighten/i);
    expect(isAiUse("edit")).toBe(true);
    expect(isAiUse("nonsense")).toBe(false);
  });
});

describe("what a facilitator reads", () => {
  it("describes a piece somebody actually worked on", () => {
    const line = describeProvenance(wrote({ pasteCount: 2, largestPaste: 180 }));
    expect(line).toContain("3 sittings");
    expect(line).toContain("47 minutes");
    expect(line).toContain("2 pastes");
    expect(line).toContain("largest 180 characters");
    // 180 of 4,000 is a quotation, and saying so is the useful part.
    expect(line).toContain("(5% of the final piece)");
  });

  it("describes a piece that arrived in one go", () => {
    const line = describeProvenance({
      ...EMPTY_PROVENANCE,
      activeSeconds: 120, sittings: 1, pasteCount: 1, pastedChars: 1850,
      largestPaste: 1850, finalChars: 1920,
    });
    expect(line).toContain("1 sitting");
    expect(line).toContain("2 minutes");
    expect(line).toContain("96% of the final piece");
  });

  it("never returns a verdict, only what happened", () => {
    // The one thing this file must never do.
    for (const p of [wrote(), wrote({ pasteCount: 1, largestPaste: 3900 })]) {
      const line = describeProvenance(p);
      expect(line).not.toMatch(/\bAI\b|likely|probably|suspicious|generated/i);
    }
  });

  it("says plainly when there is no record rather than inventing zeroes", () => {
    const line = describeProvenance(null);
    expect(line).toMatch(/no record/i);
    expect(describeProvenance(EMPTY_PROVENANCE)).toBe(line);
  });

  it("says so when nothing was pasted", () => {
    expect(describeProvenance(wrote())).toContain("Nothing was pasted in.");
  });
});

describe("worthALook", () => {
  it("raises an eyebrow at a whole piece pasted in two minutes", () => {
    expect(worthALook({
      ...EMPTY_PROVENANCE,
      activeSeconds: 120, sittings: 1, pasteCount: 1,
      largestPaste: 1850, finalChars: 1920,
    })).toBe(true);
  });

  it("says nothing about a long piece with a pasted quotation", () => {
    expect(worthALook(wrote({ pasteCount: 2, largestPaste: 180 }))).toBe(false);
  });

  it("says nothing about a whole piece pasted after an hour of work", () => {
    // Somebody who drafts in their own editor and pastes at the end has done
    // nothing wrong, and this must not treat them as if they had.
    expect(worthALook({
      ...EMPTY_PROVENANCE,
      activeSeconds: 60 * 60, sittings: 2, pasteCount: 1,
      largestPaste: 1850, finalChars: 1920,
    })).toBe(false);
  });

  it("says nothing at all where there is no record", () => {
    expect(worthALook(null)).toBe(false);
    expect(worthALook(EMPTY_PROVENANCE)).toBe(false);
  });
});

describe("thinCritique", () => {
  const real =
    "The opening buries the finding. You have the tariff rise in the fourth paragraph "
    + "and the minister's denial in the first, which is the wrong way round for a reader "
    + "deciding whether to keep going. I would lead on the number and let the denial answer it.";

  it("leaves a real critique alone", () => {
    expect(thinCritique(real, [])).toBe(false);
  });

  it("catches feedback that scraped over the minimum", () => {
    expect(thinCritique("Good piece, well structured, I enjoyed reading it. Nice work.", [])).toBe(true);
  });

  it("catches the same paragraph filed twice", () => {
    // The exact thing the database was built to let a facilitator find.
    expect(thinCritique(real, [real])).toBe(true);
    expect(thinCritique(real, ["something else entirely that is quite long but different in every way you could measure it"])).toBe(false);
  });

  it("catches a near-copy with a word changed", () => {
    const almost = real.replace("buries", "hides");
    expect(thinCritique(almost, [real])).toBe(true);
  });
});
