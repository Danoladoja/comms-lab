import { describe, expect, it } from "vitest";
import {
  validateCohortMessage,
  statusesFor,
  describeAudience,
  describeSendResult,
  isSafeLinkUrl,
  messageParagraphs,
  MAX_MESSAGE_CHARS,
  MAX_SUBJECT_CHARS,
} from "./cohortMessage";

const GOOD = {
  subject: "Thursday's class has moved to 4pm",
  body: "The grid resilience class has moved from 2pm to 4pm this Thursday, to let Adaeze join us from Abuja.\n\nEverything else is unchanged. The reading is still the two regulator notices.",
  audience: "active",
};

describe("validateCohortMessage", () => {
  it("accepts an ordinary notice to a cohort", () => {
    const { message, problems } = validateCohortMessage(GOOD);
    expect(problems).toEqual([]);
    expect(message).toMatchObject({ audience: "active", subject: "Thursday's class has moved to 4pm" });
  });

  it("insists on a subject, because it is the only thing most people read", () => {
    expect(validateCohortMessage({ ...GOOD, subject: "  " }).problems[0]).toMatch(/subject/i);
  });

  it("refuses a message too short to be one", () => {
    // Somebody testing the box with "hi" has not written to their cohort, they
    // have spent fifty people's attention.
    const { message, problems } = validateCohortMessage({ ...GOOD, body: "hi" });
    expect(message).toBeNull();
    expect(problems[0]).toMatch(/too short/i);
  });

  it("refuses a newsletter", () => {
    const long = "x".repeat(MAX_MESSAGE_CHARS + 1);
    expect(validateCohortMessage({ ...GOOD, body: long }).problems[0]).toMatch(/longer than an email/i);
    expect(validateCohortMessage({ ...GOOD, subject: "s".repeat(MAX_SUBJECT_CHARS + 1) }).problems[0])
      .toMatch(/subject is too long/i);
  });

  it("refuses half a button", () => {
    // A label with no link renders as dead orange; a link with no label renders
    // as nothing at all.
    expect(validateCohortMessage({ ...GOOD, actionLabel: "Open the reading" }).problems[0]).toMatch(/no link/i);
    expect(validateCohortMessage({ ...GOOD, actionUrl: "https://x.org" }).problems[0]).toMatch(/no label/i);
  });

  it("takes a whole button", () => {
    const { message, problems } = validateCohortMessage({
      ...GOOD, actionLabel: "Open the reading", actionUrl: "https://energycommslab.africa/dashboard",
    });
    expect(problems).toEqual([]);
    expect(message?.actionLabel).toBe("Open the reading");
  });

  it("refuses a button link that is not an ordinary secure web address", () => {
    for (const url of ["javascript:alert(1)", "http://energycommslab.africa", "data:text/html,x", "not a url"]) {
      expect(validateCohortMessage({ ...GOOD, actionLabel: "Go", actionUrl: url }).problems.join(" "))
        .toMatch(/https:\/\//);
    }
  });

  it("defaults to the narrower audience when none is given", () => {
    expect(validateCohortMessage({ ...GOOD, audience: undefined }).message?.audience).toBe("active");
    expect(validateCohortMessage({ ...GOOD, audience: "nonsense" }).message?.audience).toBe("active");
  });
});

describe("isSafeLinkUrl", () => {
  it("allows an ordinary https address", () => {
    expect(isSafeLinkUrl("https://energycommslab.africa/dashboard")).toBe(true);
  });

  it("refuses everything else", () => {
    expect(isSafeLinkUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeLinkUrl("http://energycommslab.africa")).toBe(false);
    expect(isSafeLinkUrl("mailto:a@b.org")).toBe(false);
    expect(isSafeLinkUrl("")).toBe(false);
    expect(isSafeLinkUrl("https://x.org /spaced")).toBe(false);
  });
});

describe("statusesFor", () => {
  it("never includes a cancelled enrolment", () => {
    // Somebody removed from a cohort should not keep receiving its post, and
    // somebody removed for cause certainly should not.
    expect(statusesFor("active")).not.toContain("cancelled");
    expect(statusesFor("everyone")).not.toContain("cancelled");
    expect(statusesFor("active")).not.toContain("waitlisted");
  });

  it("adds those who finished only when asked", () => {
    expect(statusesFor("active")).toEqual(["enrolled"]);
    expect(statusesFor("everyone")).toEqual(["enrolled", "completed"]);
  });
});

describe("describeAudience", () => {
  it("says who is included and who is not", () => {
    expect(describeAudience("active", 12)).toContain("12 people");
    expect(describeAudience("active", 12)).toMatch(/finished it are not included/i);
    expect(describeAudience("everyone", 1)).toContain("1 person");
    expect(describeAudience("everyone", 20)).toMatch(/including those who have finished/i);
  });
});

describe("messageParagraphs", () => {
  it("treats a blank line as a new paragraph, which is how people write", () => {
    expect(messageParagraphs("One.\n\nTwo.")).toEqual(["One.", "Two."]);
  });

  it("joins a wrapped line rather than breaking it", () => {
    expect(messageParagraphs("A sentence that\nwrapped in the box.")).toEqual(["A sentence that wrapped in the box."]);
  });

  it("survives Windows line endings and trailing blank lines", () => {
    expect(messageParagraphs("One.\r\n\r\nTwo.\r\n\r\n\r\n")).toEqual(["One.", "Two."]);
  });
});

describe("describeSendResult", () => {
  const sent = (email: string) => ({ email, name: "", status: "sent" as const, detail: "" });
  const failed = (email: string) => ({ email, name: "", status: "failed" as const, detail: "no" });

  it("reports a clean run plainly", () => {
    expect(describeSendResult([sent("a@x.org"), sent("b@x.org")])).toBe("Sent to 2 people.");
    expect(describeSendResult([sent("a@x.org")])).toBe("Sent to 1 person.");
  });

  it("points at the failures rather than only counting them", () => {
    const line = describeSendResult([sent("a@x.org"), failed("b@x.org")]);
    expect(line).toContain("Sent to 1");
    expect(line).toMatch(/listed below/);
  });

  it("says plainly when nothing reached anybody", () => {
    expect(describeSendResult([failed("a@x.org"), failed("b@x.org")])).toMatch(/Nothing reached anybody/);
  });

  it("does not claim to have sent to an empty cohort", () => {
    expect(describeSendResult([])).toMatch(/nobody to send it to/i);
  });
});
