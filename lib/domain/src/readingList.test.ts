import { describe, expect, it } from "vitest";
import {
  normaliseUrl,
  displayHost,
  validateReadings,
  MAX_READINGS_PER_MODULE,
  MAX_READING_TITLE,
} from "./readingList";

describe("normaliseUrl", () => {
  it("keeps a well-formed link as it is", () => {
    expect(normaliseUrl("https://www.iea.org/reports/africa-energy-outlook"))
      .toBe("https://www.iea.org/reports/africa-energy-outlook");
  });

  it("assumes https when the scheme was left off", () => {
    // The common paste. Without this the link renders as relative and 404s
    // inside the platform.
    expect(normaliseUrl("www.irena.org/publications")).toBe("https://www.irena.org/publications");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseUrl("  https://example.org/a  ")).toBe("https://example.org/a");
  });

  it("accepts http as well as https", () => {
    expect(normaliseUrl("http://example.org")).toBe("http://example.org");
  });

  it("keeps query strings and fragments", () => {
    expect(normaliseUrl("https://example.org/a?b=c#d")).toBe("https://example.org/a?b=c#d");
  });

  it("accepts a port", () => {
    expect(normaliseUrl("https://example.org:8443/report")).toBe("https://example.org:8443/report");
  });

  it("refuses javascript: links", () => {
    expect(normaliseUrl("javascript:alert(1)")).toBeNull();
  });

  it("refuses data: links", () => {
    expect(normaliseUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("refuses other schemes", () => {
    expect(normaliseUrl("ftp://files.example.org/a")).toBeNull();
    expect(normaliseUrl("mailto:someone@example.org")).toBeNull();
  });

  it("refuses text that is not a link", () => {
    expect(normaliseUrl("see the handout")).toBeNull();
    expect(normaliseUrl("iea")).toBeNull();
    expect(normaliseUrl("")).toBeNull();
  });
});

describe("displayHost", () => {
  it("returns the site without the www", () => {
    expect(displayHost("https://www.iea.org/reports/x")).toBe("iea.org");
  });

  it("keeps a meaningful subdomain", () => {
    expect(displayHost("https://data.worldbank.org/indicator")).toBe("data.worldbank.org");
  });

  it("returns nothing for an unparseable value", () => {
    expect(displayHost("not a url")).toBe("");
  });
});

describe("validateReadings", () => {
  const good = { title: "Africa Energy Outlook", url: "https://iea.org/reports/aeo", note: "Chapter 3 only" };

  it("keeps a well-formed list", () => {
    const { items, problems } = validateReadings([good]);
    expect(problems).toEqual([]);
    expect(items[0].title).toBe("Africa Energy Outlook");
    expect(items[0].note).toBe("Chapter 3 only");
  });

  it("normalises links as it goes", () => {
    const { items } = validateReadings([{ title: "T", url: "example.org/a" }]);
    expect(items[0].url).toBe("https://example.org/a");
  });

  it("silently drops an untouched blank row", () => {
    const { items, problems } = validateReadings([good, { title: "", url: "", note: "" }]);
    expect(items).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  it("reports which row had a bad link", () => {
    const { items, problems } = validateReadings([good, { title: "Broken", url: "not a link" }]);
    expect(items).toHaveLength(1);
    expect(problems[0].index).toBe(1);
    expect(problems[0].message).toMatch(/web address/);
  });

  it("insists on a title so learners know what they are clicking", () => {
    const { items, problems } = validateReadings([{ title: "  ", url: "https://example.org" }]);
    expect(items).toHaveLength(0);
    expect(problems[0].message).toMatch(/title/);
  });

  it("rejects the same link twice", () => {
    const { items, problems } = validateReadings([good, { ...good, title: "Same thing again" }]);
    expect(items).toHaveLength(1);
    expect(problems[0].message).toMatch(/Already on the list/);
  });

  it("treats links differing only by scheme prefix as the same after normalising", () => {
    const { items } = validateReadings([
      { title: "A", url: "https://example.org/a" },
      { title: "B", url: "example.org/a" },
    ]);
    expect(items).toHaveLength(1);
  });

  it("trims an over-long title rather than refusing it", () => {
    const { items } = validateReadings([{ title: "x".repeat(500), url: "https://example.org" }]);
    expect(items[0].title).toHaveLength(MAX_READING_TITLE);
  });

  it("caps the list and says so", () => {
    const many = Array.from({ length: MAX_READINGS_PER_MODULE + 5 }, (_, i) => ({
      title: `Item ${i}`,
      url: `https://example.org/${i}`,
    }));
    const { items, problems } = validateReadings(many);
    expect(items).toHaveLength(MAX_READINGS_PER_MODULE);
    expect(problems.some(p => /Only the first/.test(p.message))).toBe(true);
  });

  it("copes with missing fields entirely", () => {
    const { items, problems } = validateReadings([{}]);
    expect(items).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("allows a link with no note", () => {
    const { items } = validateReadings([{ title: "T", url: "https://example.org" }]);
    expect(items[0].note).toBe("");
  });
});
