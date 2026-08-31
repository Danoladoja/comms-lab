import { describe, expect, it } from "vitest";
import {
  MAX_PARTNER_MESSAGE,
  PARTNERSHIP_INTEREST_LABELS,
  enquiryHtml,
  enquirySubject,
  escapeHtml,
  isPlausibleEnquiryEmail,
  normaliseEnquiryEmail,
  validateEnquiry,
} from "./partnership";

function good(overrides: Record<string, string> = {}) {
  return {
    name: "Amina Bello",
    organisation: "West Africa Energy Desk",
    email: "amina@example.org",
    interest: "teach",
    message: "I would like to run a session on covering gas flaring for reporters.",
    ...overrides,
  };
}

describe("validateEnquiry", () => {
  it("accepts a complete enquiry", () => {
    const result = validateEnquiry(good());
    expect(result.problems).toBeNull();
    expect(result.spam).toBe(false);
    expect(result.enquiry).toMatchObject({
      name: "Amina Bello",
      organisation: "West Africa Energy Desk",
      email: "amina@example.org",
      interest: "teach",
    });
  });

  it("lowercases and trims the reply address", () => {
    const result = validateEnquiry(good({ email: "  Amina@Example.ORG " }));
    expect(result.enquiry?.email).toBe("amina@example.org");
  });

  it("names every missing field rather than only the first", () => {
    const result = validateEnquiry({});
    expect(result.problems).not.toBeNull();
    expect(Object.keys(result.problems ?? {}).sort()).toEqual([
      "email",
      "interest",
      "message",
      "name",
      "organisation",
    ]);
  });

  it("refuses an interest it does not recognise", () => {
    // Guards against a tampered form posting a value the email template has no
    // label for, which would render "undefined" in the subject line.
    const result = validateEnquiry(good({ interest: "acquisition" }));
    expect(result.problems?.interest).toBeTruthy();
  });

  it("asks for more than a one-word message", () => {
    const result = validateEnquiry(good({ message: "hi" }));
    expect(result.problems?.message).toBeTruthy();
  });

  it("refuses a message too long to send", () => {
    const result = validateEnquiry(good({ message: "a".repeat(MAX_PARTNER_MESSAGE + 1) }));
    expect(result.problems?.message).toBeTruthy();
  });

  it("drops a submission that filled the hidden field, without saying why", () => {
    const result = validateEnquiry(good({ honeypot: "http://spam.example" }));
    expect(result.spam).toBe(true);
    expect(result.enquiry).toBeNull();
    expect(result.problems).toBeNull();
  });

  it("treats an untouched hidden field as a real person", () => {
    const result = validateEnquiry(good({ honeypot: "" }));
    expect(result.spam).toBe(false);
    expect(result.enquiry).not.toBeNull();
  });

  it("strips newlines from single-line fields", () => {
    // A newline in a field that ends up in an email header is the classic
    // injection route. It must not survive validation.
    const result = validateEnquiry(
      good({ name: "Amina\r\nBcc: victim@example.com", organisation: "Desk\nX" }),
    );
    expect(result.enquiry?.name).toBe("Amina Bcc: victim@example.com");
    expect(result.enquiry?.name).not.toContain("\n");
    expect(result.enquiry?.organisation).toBe("Desk X");
  });

  it("keeps paragraph breaks in the message but collapses runs of blank lines", () => {
    const result = validateEnquiry(
      good({ message: "First paragraph here.\n\n\n\nSecond paragraph here." }),
    );
    expect(result.enquiry?.message).toBe("First paragraph here.\n\nSecond paragraph here.");
  });

  it("strips control characters from the message without fusing words", () => {
    const VT = String.fromCharCode(0x0b);
    const NUL = String.fromCharCode(0x00);
    const DEL = String.fromCharCode(0x7f);
    const result = validateEnquiry(
      good({ message: `one${VT}two${NUL}three${DEL}four five six seven eight` }),
    );
    expect(result.enquiry?.message).toBe("one two three four five six seven eight");
    expect(result.enquiry?.message).not.toContain(VT);
    expect(result.enquiry?.message).not.toContain(NUL);
    expect(result.enquiry?.message).not.toContain(DEL);
  });
});

describe("isPlausibleEnquiryEmail", () => {
  it.each([
    ["amina@example.org", true],
    ["a.b+tag@sub.example.co.uk", true],
    ["no-at-sign.example.org", false],
    ["two@@example.org", false],
    ["missing@tld", false],
    ["has space@example.org", false],
    ["", false],
  ])("%s -> %s", (input, expected) => {
    expect(isPlausibleEnquiryEmail(input)).toBe(expected);
  });
});

describe("normaliseEnquiryEmail", () => {
  it("is idempotent", () => {
    const once = normaliseEnquiryEmail("  Amina@Example.ORG ");
    expect(normaliseEnquiryEmail(once)).toBe(once);
  });
});

describe("the notification email", () => {
  const enquiry = validateEnquiry(good()).enquiry!;

  it("names the organisation and the interest in the subject", () => {
    const subject = enquirySubject(enquiry);
    expect(subject).toContain("West Africa Energy Desk");
    expect(subject).toContain(PARTNERSHIP_INTEREST_LABELS.teach);
  });

  it("carries the reply address in the body", () => {
    const html = enquiryHtml(enquiry, new Date("2026-08-31T10:00:00Z"));
    expect(html).toContain("amina@example.org");
    expect(html).toContain("2026-08-31T10:00:00.000Z");
  });

  it("escapes markup that came from the form", () => {
    // The enquiry is attacker-controlled and lands in Daniel's mail client.
    const hostile = validateEnquiry(
      good({
        organisation: "<script>alert(1)</script>",
        message: "Please see <img src=x onerror=alert(1)> for details of our work.",
      }),
    ).enquiry!;

    const html = enquiryHtml(hostile, new Date());
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders message paragraphs as line breaks", () => {
    const multi = validateEnquiry(good({ message: "First line here.\n\nSecond line here." })).enquiry!;
    expect(enquiryHtml(multi, new Date())).toContain("<br>");
  });
});

describe("escapeHtml", () => {
  it("escapes quotes as well as angle brackets", () => {
    expect(escapeHtml(`<a href="x">'&</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&lt;/a&gt;",
    );
  });
});
