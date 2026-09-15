import { describe, expect, it } from "vitest";
import { normaliseMeetUrl, isOpenableMeetUrl, meetUrlProblem } from "./meetLink";

describe("normalising a joining link", () => {
  it("fixes the link that sends learners to a 404 on our own site", () => {
    // The whole reason this file exists. Without a scheme the browser treats
    // it as a path, not an address.
    expect(normaliseMeetUrl("meet.google.com/abc-defg-hij"))
      .toBe("https://meet.google.com/abc-defg-hij");
    expect(normaliseMeetUrl("/meet.google.com/abc-defg-hij"))
      .toBe("https://meet.google.com/abc-defg-hij");
    expect(normaliseMeetUrl("  meet.google.com/abc-defg-hij  "))
      .toBe("https://meet.google.com/abc-defg-hij");
  });

  it("accepts the bare meeting code Google prints in large type", () => {
    expect(normaliseMeetUrl("abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(normaliseMeetUrl("ABC-DEFG-HIJ")).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("leaves a proper address exactly as it is", () => {
    for (const url of [
      "https://meet.google.com/abc-defg-hij",
      "http://meet.google.com/abc-defg-hij",
      "https://us02web.zoom.us/j/1234567890?pwd=x",
    ]) {
      expect(normaliseMeetUrl(url)).toBe(url);
    }
  });

  it("does not insist the class is on Google", () => {
    // The Lab has used Zoom and a university system. Refusing those would be a
    // worse failure than the one this fixes.
    expect(normaliseMeetUrl("us02web.zoom.us/j/123")).toBe("https://us02web.zoom.us/j/123");
  });

  it("refuses anything that is not a place to go", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "just some words",
      "",
      null,
      undefined,
    ]) {
      expect(normaliseMeetUrl(bad)).toBeNull();
    }
  });
});

describe("the last gate before opening a link", () => {
  it("only lets through something plainly somewhere else", () => {
    expect(isOpenableMeetUrl("https://meet.google.com/abc-defg-hij")).toBe(true);
    // An old row written before normalisation existed must not reach a browser.
    expect(isOpenableMeetUrl("meet.google.com/abc-defg-hij")).toBe(false);
    expect(isOpenableMeetUrl("/classroom/4")).toBe(false);
    expect(isOpenableMeetUrl(null)).toBe(false);
  });
});

describe("what the admin is told", () => {
  it("says nothing about a link that is already right", () => {
    expect(meetUrlProblem("https://meet.google.com/abc-defg-hij")).toBeNull();
    expect(meetUrlProblem("")).toBeNull();
  });

  it("shows what it will actually save when it has to repair one", () => {
    expect(meetUrlProblem("meet.google.com/abc-defg-hij"))
      .toContain("https://meet.google.com/abc-defg-hij");
  });

  it("says plainly when there is nothing usable", () => {
    expect(meetUrlProblem("the one from last week")).toMatch(/does not look like/i);
  });
});
