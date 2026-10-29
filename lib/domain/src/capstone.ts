/**
 * The rules for the piece of work a programme ends on.
 *
 * Here rather than in the route handlers because every one of them is a
 * sentence somebody reads on a screen at the moment they are stopped, and a
 * refusal that cannot be read in a test is a refusal nobody checks. The server
 * enforces them; the browser shows the same sentences before the button is
 * pressed, from this same file, so the two can never disagree.
 */

import { countWords } from "./wordMinimums";

export const CAPSTONE_STATUSES = ["draft", "submitted", "approved", "returned"] as const;
export type CapstoneStatus = (typeof CAPSTONE_STATUSES)[number];

export function isCapstoneStatus(v: unknown): v is CapstoneStatus {
  return typeof v === "string" && (CAPSTONE_STATUSES as readonly string[]).includes(v);
}

/** The largest document a learner may attach, in bytes. */
export const MAX_CAPSTONE_UPLOAD_BYTES = 8 * 1024 * 1024;

const FORMATS: { ext: string; mimeType: string; label: string }[] = [
  { ext: ".pdf", mimeType: "application/pdf", label: "PDF" },
  { ext: ".docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word" },
  { ext: ".doc", mimeType: "application/msword", label: "Word" },
  { ext: ".odt", mimeType: "application/vnd.oasis.opendocument.text", label: "OpenDocument" },
  { ext: ".rtf", mimeType: "application/rtf", label: "Rich text" },
  { ext: ".txt", mimeType: "text/plain", label: "Plain text" },
  { ext: ".md", mimeType: "text/markdown", label: "Markdown" },
];

export function listCapstoneFormats(): string {
  const seen: string[] = [];
  for (const f of FORMATS) if (!seen.includes(f.label)) seen.push(f.label);
  return seen.slice(0, -1).join(", ") + " or " + seen[seen.length - 1];
}

/**
 * What kind of document this is, by its name first and its declared type
 * second.
 *
 * The name is trusted over the browser's guess because browsers disagree about
 * Word files — the same .docx arrives as four different types depending on the
 * machine — and a learner whose final piece is refused because of what their
 * operating system calls it has been failed by us, not by the rule.
 */
export function capstoneFileType(filename: string, declared?: string | null):
  { mimeType: string; label: string } | null {
  const lower = String(filename || "").toLowerCase();
  const byName = FORMATS.find((f) => lower.endsWith(f.ext));
  if (byName) return { mimeType: byName.mimeType, label: byName.label };
  const d = String(declared || "").split(";")[0].trim().toLowerCase();
  const byType = FORMATS.find((f) => f.mimeType === d);
  return byType ? { mimeType: byType.mimeType, label: byType.label } : null;
}

/* ------------------------------------------------------------------ *
 * Setting one
 * ------------------------------------------------------------------ */

export type CapstoneDraft = {
  title: string;
  brief: string;
  wordsAtLeast: number;
  wordsAtMost: number;
  maxScore: number;
  dueAt: string | null;
};

/**
 * Why this capstone cannot go to the cohort yet, or null when it can.
 *
 * Said on the screen before the button is reached rather than after it is
 * pressed. Publishing one of these starts withholding certificates, so the gate
 * is worth more care than a form usually gets.
 */
export function capstonePublishProblem(c: CapstoneDraft, nowMs: number = Date.now()): string | null {
  if (!c.title.trim()) return "Give it a title. The cohort sees this before they see anything else.";
  if (c.brief.trim().length < 40) {
    return "The brief is too thin. Say what they are producing and what it will be judged on — "
      + "this is the last thing they write and the only piece staff mark.";
  }
  if (c.maxScore < 1) return "A capstone is marked out of something. Set the mark it is out of.";
  if (c.wordsAtLeast < 0 || c.wordsAtMost < 0) return "A word count cannot be negative.";
  if (c.wordsAtMost > 0 && c.wordsAtLeast > c.wordsAtMost) {
    return "The shortest it may be is longer than the longest it may be.";
  }
  if (c.dueAt) {
    const due = Date.parse(c.dueAt);
    if (Number.isNaN(due)) return "That deadline is not a date.";
    if (due <= nowMs) return "That deadline has already passed, so nobody could file on time.";
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Sending one in
 * ------------------------------------------------------------------ */

export type SubmitFacts = {
  body: string;
  wordsAtLeast: number;
  wordsAtMost: number;
  dueAt: string | null;
  nowMs: number;
  /** Whether a document is attached. A piece may be either, and must be one. */
  hasFile: boolean;
};

/**
 * Why this cannot be sent, or null when it can.
 *
 * The deadline refuses rather than silently accepting and flagging, which is
 * the opposite of how the module tasks behave. A module task that arrives late
 * still teaches somebody something; a capstone that arrives after the
 * programme has been marked is a conversation with staff, not a submission, and
 * pretending otherwise leaves the learner believing they are done.
 */
export function capstoneSubmitProblem(f: SubmitFacts): string | null {
  const words = countWords(f.body);
  if (words === 0 && !f.hasFile) {
    return "There is nothing here yet. Write the piece, or attach it as a document.";
  }
  if (f.dueAt) {
    const due = Date.parse(f.dueAt);
    if (!Number.isNaN(due) && f.nowMs > due) {
      return "The deadline for this capstone has passed. Your work is saved — "
        + "ask the team to reopen it rather than starting again.";
    }
  }
  // Length is only asked of the typed piece. Somebody who attached a document
  // has written it somewhere the Lab cannot count, and refusing them on a
  // number we cannot see would be refusing them on nothing.
  if (!f.hasFile) {
    if (f.wordsAtLeast > 0 && words < f.wordsAtLeast) {
      return `This is ${words} words. The capstone asks for at least ${f.wordsAtLeast}.`;
    }
    if (f.wordsAtMost > 0 && words > f.wordsAtMost) {
      return `This is ${words} words. The capstone asks for no more than ${f.wordsAtMost}.`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Marking one
 * ------------------------------------------------------------------ */

export type Verdict = "approve" | "return";

export type ReviewFacts = {
  decision: Verdict;
  score: number | null;
  maxScore: number;
  note: string;
  /** What the piece is now. Only something that was sent can be decided. */
  status: string;
};

/**
 * Why this verdict cannot be recorded, or null when it can.
 *
 * Two rules carry the weight. Approval needs a mark, because a capstone that is
 * approved with no score leaves a certificate with a blank where its result
 * should be and nobody later able to say what it was worth. Sending a piece
 * back needs a reason, because the learner is being asked to do it again and
 * "returned" on its own tells them nothing they can act on — it is the single
 * most common way a review process stops being teaching and becomes a wall.
 */
export function capstoneReviewProblem(r: ReviewFacts): string | null {
  if (r.status === "draft") return "This has not been sent yet. There is nothing to decide.";
  if (r.status === "approved") return "This has already been approved.";
  if (r.status === "returned") return "This attempt was already sent back. The learner has a new draft open.";
  if (r.status !== "submitted") return "This is not waiting for a decision.";

  if (r.decision === "approve") {
    if (r.score === null || Number.isNaN(r.score)) return "Give it a mark before you approve it.";
    if (r.score < 0 || r.score > r.maxScore) return `The mark has to be between 0 and ${r.maxScore}.`;
  } else {
    if (r.note.trim().length < 15) {
      return "Say what needs to change. They are being asked to write it again, and a verdict "
        + "with no reason is the thing that makes people give up.";
    }
    if (r.score !== null && (r.score < 0 || r.score > r.maxScore)) {
      return `The mark has to be between 0 and ${r.maxScore}.`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * What the learner is looking at
 * ------------------------------------------------------------------ */

export type Standing = {
  /** One line, in the second person. */
  headline: string;
  /** Whether the box is open for writing. */
  mayEdit: boolean;
  /** Whether there is anything to send. */
  maySubmit: boolean;
};

export function capstoneStanding(latest: { status: string; score: number | null } | null): Standing {
  if (!latest) {
    return { headline: "Not started.", mayEdit: true, maySubmit: true };
  }
  switch (latest.status) {
    case "draft":
      return { headline: "Saved, not sent.", mayEdit: true, maySubmit: true };
    case "submitted":
      return { headline: "Sent. Waiting to be read.", mayEdit: false, maySubmit: false };
    case "approved":
      return {
        headline: latest.score === null ? "Approved." : `Approved, ${latest.score} marks.`,
        mayEdit: false,
        maySubmit: false,
      };
    case "returned":
      return { headline: "Sent back for rework.", mayEdit: true, maySubmit: true };
    default:
      return { headline: "Not started.", mayEdit: true, maySubmit: true };
  }
}

/* ------------------------------------------------------------------ *
 * Why the certificate is not here
 * ------------------------------------------------------------------ */

export type CertificateFacts = {
  /** Every module of the programme is complete. */
  workDone: boolean;
  /** A closing survey is published and has not been filed. */
  surveyOutstanding: boolean;
  /** A capstone is published and has no approved attempt. */
  capstoneOutstanding: boolean;
  /** What the learner's capstone is doing, when one is outstanding. */
  capstoneStatus: string | null;
  /**
   * The Lab does not know the name to print. See `learnerName.ts`: Clerk does
   * not ask for one, so this is common rather than exotic, and it has to be a
   * hold like the others — issuing the sheet anyway is how it came to carry an
   * email address.
   */
  nameMissing?: boolean;
};

/**
 * What this learner is waiting on, in one sentence, or null when nothing.
 *
 * The page this feeds used to show an empty state saying "finish all the
 * modules" to people who had finished all the modules — because the route
 * filtered them out and left the browser nothing to tell them apart from
 * somebody who had just enrolled. Two requirements now sit outside module
 * completion, and a learner stuck behind either of them deserves to be told
 * which, rather than left to conclude the Lab lost their work.
 */
export function certificateHeldBy(f: CertificateFacts): string | null {
  if (!f.workDone) return null;

  const waits: string[] = [];
  if (f.capstoneOutstanding) {
    waits.push(
      f.capstoneStatus === "submitted"
        ? "your capstone, which has been sent and is waiting to be read"
        : f.capstoneStatus === "returned"
          ? "your capstone, which has been sent back for rework"
          : "your capstone, which has not been sent yet",
    );
  }
  if (f.surveyOutstanding) waits.push("the closing survey");
  // Last in the list, because it is the one the learner can clear in ten
  // seconds, and a sentence reads better ending on the easy thing.
  if (f.nameMissing) waits.push("the name you would like printed on it");
  if (waits.length === 0) return null;

  const list = waits.length === 1 ? waits[0] : waits.join(", and ");
  return `You have finished every module. Your certificate is waiting on ${list}.`;
}
