import { describe, expect, it } from "vitest";
import {
  PROGRAM_STATUSES,
  acceptsEnrolment,
  isProgramStatus,
  programStatusLabel,
  programStatusNote,
  showsInCatalogue,
} from "./programStatus";

describe("showsInCatalogue", () => {
  it("shows a published programme", () => {
    expect(showsInCatalogue("published")).toBe(true);
  });

  it("still shows a closed one", () => {
    // The point of closing rather than archiving: people can read about a
    // cohort that has started, instead of hitting a page that vanished.
    expect(showsInCatalogue("closed")).toBe(true);
  });

  it.each(["draft", "archived", "", null, undefined, "something-else"])("hides %s", (status) => {
    expect(showsInCatalogue(status as string)).toBe(false);
  });
});

describe("acceptsEnrolment", () => {
  it("only a published programme takes sign-ups", () => {
    expect(acceptsEnrolment("published")).toBe(true);
  });

  it.each(["closed", "draft", "archived", null, undefined, "weird"])("refuses %s", (status) => {
    expect(acceptsEnrolment(status as string)).toBe(false);
  });

  it("never accepts a sign-up onto something the catalogue hides", () => {
    // The pairing that matters: anything enrollable must also be visible.
    for (const status of [...PROGRAM_STATUSES, "unknown"]) {
      if (acceptsEnrolment(status)) expect(showsInCatalogue(status)).toBe(true);
    }
  });
});

describe("isProgramStatus", () => {
  it("accepts every state the app uses", () => {
    for (const status of PROGRAM_STATUSES) expect(isProgramStatus(status)).toBe(true);
  });

  it.each([["Published"], [""], [null], [undefined], [7], [{}]])("rejects %s", (value) => {
    expect(isProgramStatus(value)).toBe(false);
  });
});

describe("wording", () => {
  it("labels each state", () => {
    expect(programStatusLabel("closed")).toBe("Closed");
    expect(programStatusLabel("published")).toBe("Published");
  });

  it("falls back to Draft for anything unrecognised, never to a live-sounding word", () => {
    expect(programStatusLabel("nonsense")).toBe("Draft");
    expect(programStatusNote("nonsense")).toMatch(/hidden/i);
  });

  it("says plainly what closed does", () => {
    expect(programStatusNote("closed")).toMatch(/nobody new/i);
  });
});
