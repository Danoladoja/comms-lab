/**
 * Partnership enquiries.
 *
 * The one form on this site that anybody at all can submit. Everything else is
 * behind Clerk; this is open to the entire internet, which makes it the single
 * most likely thing to be abused. So the rules that decide whether a submission
 * is worth acting on live here, where they can be tested without a network and
 * without a mail provider.
 *
 * The enquiry is delivered by email and nowhere else — that was a deliberate
 * choice — which means a rejected submission is simply gone. So validation
 * refuses only what is genuinely unusable, and every refusal comes back as a
 * sentence a person can act on rather than a field name.
 */

export const MAX_PARTNER_NAME = 120;
export const MAX_PARTNER_ORG = 160;
export const MAX_PARTNER_EMAIL = 320;
export const MAX_PARTNER_MESSAGE = 4000;
export const MIN_PARTNER_MESSAGE = 20;

/**
 * What the enquirer wants from us. Kept short and concrete: a partnership
 * conversation goes very differently depending on which of these it is, and
 * asking up front saves a round of email finding out.
 */
export const PARTNERSHIP_INTERESTS = [
  "teach",
  "host",
  "fund",
  "media",
  "other",
] as const;

export type PartnershipInterest = (typeof PARTNERSHIP_INTERESTS)[number];

export const PARTNERSHIP_INTEREST_LABELS: Record<PartnershipInterest, string> = {
  teach: "Facilitate a class",
  host: "Host or co-run a programme",
  fund: "Fund or sponsor a cohort",
  media: "Media or content partnership",
  other: "Something else",
};

export function isPartnershipInterest(value: unknown): value is PartnershipInterest {
  return typeof value === "string" && (PARTNERSHIP_INTERESTS as readonly string[]).includes(value);
}

export type PartnershipEnquiry = {
  name: string;
  organisation: string;
  email: string;
  interest: PartnershipInterest;
  message: string;
};

/** Tidy an address for sending and comparing. */
export function normaliseEnquiryEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Good enough to catch a typo before an enquiry is sent into the void, without
 * trying to out-guess what a valid address is. This is the only chance to catch
 * it: nothing is stored, so a bad address means the reply never lands and
 * neither of us ever knows why.
 */
export function isPlausibleEnquiryEmail(input: string): boolean {
  const email = normaliseEnquiryEmail(input);
  if (email.length < 6 || email.length > MAX_PARTNER_EMAIL) return false;
  if (/\s/.test(email)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email);
}

/**
 * Collapse whitespace and strip control characters.
 *
 * A single-line field has no business carrying a newline, and a newline is
 * exactly what an attempt to forge extra lines in the notification email would
 * use. Turning the whole control range into spaces closes that off at the point
 * the value is accepted, rather than at each of the places it is later used.
 */
function stripControl(input: string, keepNewline: boolean): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (keepNewline && ch === "\n") {
      out += ch;
      continue;
    }
    // C0 controls, DEL, and the C1 range. Turned into spaces rather than
    // dropped, so words either side of one do not silently fuse together.
    const isControl = code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    out += isControl ? " " : ch;
  }
  return out;
}

function clean(input: string): string {
  return stripControl(input, false).replace(/\s+/g, " ").trim();
}

/** The same, but newlines survive — a message is meant to have paragraphs. */
function cleanMultiline(input: string): string {
  return stripControl(input.replace(/\r\n?/g, "\n"), true)
    // Horizontal whitespace only, so paragraph breaks are preserved.
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type EnquiryProblems = Partial<Record<keyof PartnershipEnquiry, string>>;

export type EnquiryResult =
  | { enquiry: PartnershipEnquiry; problems: null; spam: false }
  /** Silently dropped: a bot filled the hidden field. Answer 200 anyway. */
  | { enquiry: null; problems: null; spam: true }
  | { enquiry: null; problems: EnquiryProblems; spam: false };

/**
 * Check an enquiry before it is sent.
 *
 * `honeypot` is a field the form renders but hides from view. A person never
 * sees it and so never fills it; the crude form-scrapers that will find this
 * page fill every input they can see in the HTML. When it comes back with
 * anything in it we drop the submission and report success, because telling a
 * bot precisely why it failed is how it learns to pass.
 */
export function validateEnquiry(raw: {
  name?: string;
  organisation?: string;
  email?: string;
  interest?: string;
  message?: string;
  honeypot?: string;
}): EnquiryResult {
  if (typeof raw.honeypot === "string" && raw.honeypot.trim() !== "") {
    return { enquiry: null, problems: null, spam: true };
  }

  const problems: EnquiryProblems = {};

  const name = clean(raw.name ?? "");
  if (!name) problems.name = "Tell us your name.";
  else if (name.length > MAX_PARTNER_NAME) problems.name = "That name is too long.";

  const organisation = clean(raw.organisation ?? "");
  if (!organisation) problems.organisation = "Tell us which organisation you are with.";
  else if (organisation.length > MAX_PARTNER_ORG) problems.organisation = "That organisation name is too long.";

  const email = normaliseEnquiryEmail(raw.email ?? "");
  if (!email) problems.email = "We need an email address to reply to.";
  else if (!isPlausibleEnquiryEmail(email)) problems.email = "That does not look like an email address.";

  const interest = raw.interest ?? "";
  if (!isPartnershipInterest(interest)) problems.interest = "Choose what you have in mind.";

  const message = cleanMultiline(raw.message ?? "");
  if (!message) {
    problems.message = "Tell us a little about what you have in mind.";
  } else if (message.length < MIN_PARTNER_MESSAGE) {
    // A one-word message costs a full round of email to make sense of, and the
    // people on the other end are busy. A sentence or two is not a big ask.
    problems.message = "A sentence or two would help us reply properly.";
  } else if (message.length > MAX_PARTNER_MESSAGE) {
    problems.message = "That is longer than this form can send. Email us directly instead.";
  }

  if (Object.keys(problems).length > 0) {
    return { enquiry: null, problems, spam: false };
  }

  return {
    enquiry: {
      name,
      organisation,
      email,
      interest: interest as PartnershipInterest,
      message,
    },
    problems: null,
    spam: false,
  };
}

/** Escape text for safe interpolation into the notification email's HTML. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The notification email's subject line.
 *
 * Named so it is obvious in a crowded inbox what it is and who it is from,
 * because this is the only copy of the enquiry that will ever exist.
 */
export function enquirySubject(enquiry: PartnershipEnquiry): string {
  return `Partnership enquiry: ${enquiry.organisation} (${PARTNERSHIP_INTEREST_LABELS[enquiry.interest]})`;
}

/**
 * The notification email's body.
 *
 * Every value that came from the form is escaped. The address to reply to is
 * spelled out as text rather than only as a link, so it survives forwarding.
 */
export function enquiryHtml(enquiry: PartnershipEnquiry, receivedAt: Date): string {
  const when = receivedAt.toISOString();
  const rows: [string, string][] = [
    ["Name", enquiry.name],
    ["Organisation", enquiry.organisation],
    ["Email", enquiry.email],
    ["Interest", PARTNERSHIP_INTEREST_LABELS[enquiry.interest]],
  ];

  const table = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#5B6470;">${escapeHtml(label)}</td>` +
        `<td style="padding:4px 0;color:#07111E;"><strong>${escapeHtml(value)}</strong></td></tr>`,
    )
    .join("");

  const body = escapeHtml(enquiry.message).replace(/\n/g, "<br>");

  return [
    `<div style="font-family:system-ui,sans-serif;line-height:1.5;">`,
    `<h2 style="color:#07111E;margin:0 0 16px;">New partnership enquiry</h2>`,
    `<table style="border-collapse:collapse;margin-bottom:20px;">${table}</table>`,
    `<div style="color:#07111E;">${body}</div>`,
    `<p style="color:#5B6470;font-size:12px;margin-top:24px;">`,
    `Sent from the partnerships form at energycommslab.africa on ${escapeHtml(when)}.<br>`,
    `Reply to ${escapeHtml(enquiry.email)}.`,
    `</p></div>`,
  ].join("");
}
