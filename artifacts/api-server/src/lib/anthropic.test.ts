import { describe, expect, it } from "vitest";
import { modelConcern } from "./anthropic";

/**
 * The model name is a setting with an expiry date on it, and nothing in the Lab
 * knew that.
 *
 * `claude-sonnet-4-5` was the default in this file. Anthropic deprecated it on
 * 30 September 2026 and stops serving it on 30 November 2026, after which every
 * call returns a 404 — which means no scenario, no debrief, no draft help on a
 * learner's task, and a Studio that looks broken rather than out of date. One
 * line, a date nobody had written down, and a cohort in the room.
 *
 * These tests pin the two sentences worth having: one before the date, which is
 * a warning somebody can act on, and one after it, which explains an outage
 * that has already started.
 */

const BEFORE = Date.UTC(2026, 9, 3);  // 3 October 2026
const AFTER = Date.UTC(2026, 11, 1);  // 1 December 2026

describe("what is worth saying about the model", () => {
  it("says nothing about a model that is current", () => {
    expect(modelConcern("claude-sonnet-5-5", BEFORE)).toBeNull();
    expect(modelConcern("claude-opus-5-5", BEFORE)).toBeNull();
    expect(modelConcern("claude-haiku-4-5-20251001", BEFORE)).toBeNull();
  });

  it("warns, with the date, while a deprecated model still works", () => {
    const said = modelConcern("claude-sonnet-4-5", BEFORE);
    expect(said).toContain("30 November 2026");
    expect(said).toContain("ANTHROPIC_MODEL");
    expect(said).toContain("claude-sonnet-5-5");
    // Future tense: it has not happened yet, and a warning that reads as an
    // outage sends somebody looking for a fault that is not there.
    expect(said).toContain("stops being served");
  });

  it("explains the outage once the date has passed", () => {
    const said = modelConcern("claude-sonnet-4-5", AFTER);
    expect(said).toContain("stopped being served");
    expect(said).toContain("will fail");
  });

  it("recognises a dated model name as well as its alias", () => {
    expect(modelConcern("claude-sonnet-4-5-20250929", BEFORE)).not.toBeNull();
  });

  it("knows the models that are already gone", () => {
    for (const gone of [
      "claude-3-5-sonnet-20241022",
      "claude-3-7-sonnet-20250219",
      "claude-sonnet-4-20250514",
      "claude-opus-4-1-20250805",
      "claude-3-opus-20240229",
    ]) {
      expect(modelConcern(gone, BEFORE), `${gone} is retired and should be named`)
        .toContain("stopped being served");
    }
  });

  it("does not mistake one Sonnet for another", () => {
    // claude-sonnet-4-5 and claude-sonnet-4-20250514 retire on different dates,
    // and a prefix match that caught the wrong one would print the wrong date.
    expect(modelConcern("claude-sonnet-4-5", BEFORE)).toContain("30 November 2026");
    expect(modelConcern("claude-sonnet-4-20250514", BEFORE)).toContain("stopped being served");
  });
});
