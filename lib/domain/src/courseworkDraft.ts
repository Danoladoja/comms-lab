import { DEFAULT_RUBRIC, DEFAULT_REVIEWS_REQUIRED, type RubricCriterion } from "./reviews";
import { QUIZ_PASS_MARK } from "./progress";
import { describeSource, type MaterialKind } from "./courseworkSource";

/**
 * Drafting a module's coursework from the facilitator's material.
 *
 * The model writes a first draft; a facilitator edits and approves it. Nothing
 * generated here is ever published on its own — a quiz question with a wrong
 * "correct" answer would quietly fail learners, and a brief nobody read would
 * waste a cohort's week.
 *
 * What lives in this file is the part that must be right regardless of what the
 * model returns: the instruction it is given, and the checking of what comes
 * back. A model that invents six options for a four-option question, marks two
 * answers correct, or writes a brief that could be answered without attending
 * the class, is caught here rather than in front of a learner.
 */

export const MAX_DRAFT_QUESTIONS = 8;
export const MIN_DRAFT_QUESTIONS = 3;
export const MAX_OPTIONS_PER_QUESTION = 4;
export const MIN_OPTIONS_PER_QUESTION = 3;

/**
 * The ceiling on a quiz once a facilitator has asked for more questions a few
 * times. Past this, the quiz stops being a check on attention and starts being
 * an exam, which is not what it is for.
 */
export const MAX_QUIZ_QUESTIONS = 12;

/** The most questions one "add more" click may ask for. */
export const MAX_EXPAND_AT_ONCE = 4;

export type DraftQuestion = {
  prompt: string;
  options: string[];
  correctIndex: number;
  /** Why that answer is right — shown to the facilitator while reviewing, not to learners. */
  rationale: string;
};

export type DraftAssignment = {
  title: string;
  instructions: string;
  rubric: RubricCriterion[];
  reviewsRequired: number;
};

export type CourseworkDraft = {
  questions: DraftQuestion[];
  assignment: DraftAssignment;
  /** Anything the drafter wants the facilitator to look at twice. */
  notes: string[];
};

/* ------------------------------------------------------------------ *
 * The brief
 * ------------------------------------------------------------------ */

/**
 * The quiz rules, shared by the full draft and by the two narrower calls that
 * redo one question or add a few more. Keeping one copy means a rule tightened
 * for the first draft is not quietly missing when a facilitator asks for a
 * replacement.
 */
function quizRules(): string[] {
  return [
    `- Each has between ${MIN_OPTIONS_PER_QUESTION} and ${MAX_OPTIONS_PER_QUESTION} options, exactly one correct.`,
    "- Every answer must be settled by the material you were given. Never require outside knowledge.",
    "- Wrong options must be plausible to someone who half-listened. No joke answers,",
    "  no options that are obviously longer or more detailed than the rest.",
    "- Test understanding, not recall of a number that happened to be on a slide.",
    "- Be exact about energy terms. Capacity is not generation, megawatts are not",
    "  megawatt-hours, a tariff is not a subsidy. If the material is loose about this,",
    "  say so in your notes rather than repeating the looseness.",
  ];
}

function houseVoice(): string[] {
  return [
    "Write in clear British English. Address the learner directly as 'you'.",
    "No exclamation marks, no encouragement, no filler.",
  ];
}

const WHO_YOU_ARE = [
  "You write coursework for AfriEnergy Comms Lab, a programme training journalists,",
  "communicators and advocates who report on Africa's energy sector.",
];

/**
 * The brief the model works to for a full draft.
 *
 * Written as house instructions rather than a generic "make a quiz" prompt,
 * because the subject has failure modes a general model walks straight into:
 * confusing capacity with generation, treating a company press release as a
 * neutral source, or setting a task that could be answered from a search engine
 * without attending the class.
 */
export function draftSystemPrompt(): string {
  return [
    ...WHO_YOU_ARE,
    "",
    "You are given the material from one class — the slides, a transcript of what",
    "was actually said, or both. You draft two things: a short multiple-choice quiz,",
    "and one written task. A human facilitator edits and approves everything you",
    "write, so flag your own uncertainty rather than smoothing over it.",
    "",
    "Where a transcript is provided, prefer it. Slides are headings; the transcript",
    "is the class. A question about something explained aloud and never written on a",
    "slide is a better question, not a worse one.",
    "",
    "The quiz checks whether someone was paying attention. Rules:",
    `- Between ${MIN_DRAFT_QUESTIONS} and ${MAX_DRAFT_QUESTIONS} questions.`,
    ...quizRules(),
    "",
    "The task is where the real learning happens. It asks the learner to MAKE",
    "something — a lede, a script, a rebuttal, a set of interview questions, a",
    "caption for a chart. Rules:",
    "- It must be doable in under an hour and produce something a peer can critique.",
    "- It must be specific to this class. A brief that could be set for any module",
    "  in the programme is a failed brief.",
    "- Give the learner a concrete scenario, an audience and a length.",
    "- It must be impossible to complete well without having attended or watched",
    "  the class.",
    "- Never ask for something that cannot be submitted as written text.",
    "",
    ...houseVoice(),
  ].join("\n");
}

/**
 * The brief for the two narrower calls. Same standards, no written task, and an
 * explicit instruction not to repeat what the quiz already asks — the failure
 * mode of "give me more questions" is four rephrasings of question two.
 */
export function questionsSystemPrompt(): string {
  return [
    ...WHO_YOU_ARE,
    "",
    "You are given the material from one class and the questions a facilitator has",
    "already written. You write replacement or additional quiz questions only. Do",
    "not write a task, and do not comment on the existing questions except in your",
    "notes.",
    "",
    "Where a transcript is provided, prefer it over the slides.",
    "",
    "Rules for every question you write:",
    ...quizRules(),
    "- It must not restate a question already on the quiz. Asking the same thing in",
    "  different words is the failure to avoid here. Cover something the existing",
    "  questions do not touch.",
    "",
    ...houseVoice(),
  ].join("\n");
}

/** The JSON shape the model must return for a full draft. */
export function draftResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["questions", "assignment", "notes"],
    properties: {
      questions: questionsArraySchema(MIN_DRAFT_QUESTIONS, MAX_DRAFT_QUESTIONS),
      assignment: {
        type: "object",
        required: ["title", "instructions"],
        properties: {
          title: { type: "string" },
          instructions: { type: "string" },
        },
      },
      notes: { type: "array", items: { type: "string" } },
    },
  };
}

/** The JSON shape for a redo or an expansion: questions and nothing else. */
export function questionsResponseSchema(minItems: number, maxItems: number): Record<string, unknown> {
  return {
    type: "object",
    required: ["questions", "notes"],
    properties: {
      questions: questionsArraySchema(minItems, maxItems),
      notes: { type: "array", items: { type: "string" } },
    },
  };
}

function questionsArraySchema(minItems: number, maxItems: number): Record<string, unknown> {
  return {
    type: "array",
    minItems,
    maxItems,
    items: {
      type: "object",
      required: ["prompt", "options", "correctIndex", "rationale"],
      properties: {
        prompt: { type: "string" },
        options: {
          type: "array",
          minItems: MIN_OPTIONS_PER_QUESTION,
          maxItems: MAX_OPTIONS_PER_QUESTION,
          items: { type: "string" },
        },
        correctIndex: { type: "integer", minimum: 0 },
        rationale: { type: "string" },
      },
    },
  };
}

/* ------------------------------------------------------------------ *
 * What the model is shown
 * ------------------------------------------------------------------ */

type ClassContext = {
  programTitle: string;
  sessionTitle: string;
  sessionDescription: string;
  sourceText: string;
};

function classHeader(args: ClassContext): string[] {
  return [
    `Programme: ${args.programTitle}`,
    `Class: ${args.sessionTitle}`,
    args.sessionDescription ? `What the facilitator says this class covers: ${args.sessionDescription}` : "",
  ].filter(Boolean);
}

export function draftUserPrompt(args: ClassContext): string {
  return [...classHeader(args), "", "Class material:", "", args.sourceText].join("\n");
}

/** How the existing quiz is shown when asking for a redo or more questions. */
function existingQuestionsBlock(questions: { prompt: string; options: string[] }[]): string {
  const written = questions.filter((q) => q.prompt.trim());
  if (written.length === 0) return "The quiz is currently empty.";
  return [
    "Questions already on this quiz:",
    "",
    // Numbered by position, so "replace question 3" means the same thing here as
    // it does in the facilitator's editor. A row still being typed is shown as
    // blank rather than renumbering everything below it.
    ...questions.map((q, i) =>
      q.prompt.trim()
        ? `${i + 1}. ${q.prompt}${q.options.length ? `\n   Options: ${q.options.join(" / ")}` : ""}`
        : `${i + 1}. (still being written)`,
    ),
  ].join("\n");
}

/**
 * Redo one question.
 *
 * The one being replaced is named rather than removed from the list, because
 * "write something other than this" is a clearer instruction than a gap. Any
 * guidance the facilitator typed goes last, where it carries most weight.
 */
export function replaceQuestionUserPrompt(args: ClassContext & {
  existing: { prompt: string; options: string[] }[];
  replaceIndex: number;
  guidance?: string;
}): string {
  const target = args.existing[args.replaceIndex];
  const guidance = (args.guidance ?? "").trim();
  return [
    ...classHeader(args),
    "",
    existingQuestionsBlock(args.existing),
    "",
    target
      ? `Replace question ${args.replaceIndex + 1} ("${target.prompt}") with one new question.`
      : "Write one new question.",
    "It must not repeat the question it replaces, or any of the others.",
    guidance ? `\nThe facilitator asks specifically: ${guidance}` : "",
    "",
    "Class material:",
    "",
    args.sourceText,
  ].filter(Boolean).join("\n");
}

/** Ask for a few more questions covering ground the quiz has not touched. */
export function moreQuestionsUserPrompt(args: ClassContext & {
  existing: { prompt: string; options: string[] }[];
  wanted: number;
  guidance?: string;
}): string {
  const guidance = (args.guidance ?? "").trim();
  const n = clampWanted(args.wanted, args.existing.length);
  return [
    ...classHeader(args),
    "",
    existingQuestionsBlock(args.existing),
    "",
    `Write ${n} further question${n === 1 ? "" : "s"} covering material the questions above do not.`,
    guidance ? `\nThe facilitator asks specifically: ${guidance}` : "",
    "",
    "Class material:",
    "",
    args.sourceText,
  ].filter(Boolean).join("\n");
}

/** How many more questions may actually be asked for, given what is already there. */
export function clampWanted(wanted: number, existingCount: number): number {
  const room = Math.max(0, MAX_QUIZ_QUESTIONS - existingCount);
  return Math.max(1, Math.min(MAX_EXPAND_AT_ONCE, Math.min(wanted, room || 1)));
}

/** Room left on the quiz before it hits the ceiling. */
export function roomForMoreQuestions(existingCount: number): number {
  return Math.max(0, MAX_QUIZ_QUESTIONS - existingCount);
}

/* ------------------------------------------------------------------ *
 * Checking what comes back
 * ------------------------------------------------------------------ */

export type DraftProblem = string;

/** Loose comparison for "is this the same question again?". */
export function normalisePrompt(prompt: string): string {
  return prompt.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Check a batch of questions before anyone sees them.
 *
 * Shared by the full draft and by the redo and expand calls, so a question that
 * would be rejected in a first draft is rejected when it arrives as a
 * replacement too.
 *
 * `existingPrompts` are the questions already on the quiz: a "new" question that
 * restates one of them is dropped, because the model asked for four more
 * questions will happily hand back a rephrasing of question two.
 */
export function validateQuestions(
  raw: unknown,
  opts: { existingPrompts?: string[] } = {},
): { questions: DraftQuestion[]; problems: DraftProblem[] } {
  const problems: DraftProblem[] = [];
  const questions: DraftQuestion[] = [];
  const entries = Array.isArray(raw) ? raw : [];
  const seen = new Set((opts.existingPrompts ?? []).map(normalisePrompt).filter(Boolean));

  for (const [i, entry] of entries.entries()) {
    const q = (entry ?? {}) as Record<string, unknown>;
    const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
    const rationale = typeof q.rationale === "string" ? q.rationale.trim() : "";
    const options = Array.isArray(q.options)
      ? q.options.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean)
      : [];
    const correctIndex = typeof q.correctIndex === "number" ? q.correctIndex : -1;

    if (!prompt) {
      problems.push(`Question ${i + 1} had no text and was dropped.`);
      continue;
    }
    if (options.length < MIN_OPTIONS_PER_QUESTION) {
      problems.push(`"${prompt.slice(0, 60)}" had fewer than ${MIN_OPTIONS_PER_QUESTION} answers and was dropped.`);
      continue;
    }
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      problems.push(`"${prompt.slice(0, 60)}" did not mark a valid correct answer and was dropped.`);
      continue;
    }
    // Duplicated options make a question unanswerable — two identical choices
    // cannot both be wrong.
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      problems.push(`"${prompt.slice(0, 60)}" repeated an answer and was dropped.`);
      continue;
    }
    const key = normalisePrompt(prompt);
    if (seen.has(key)) {
      problems.push(`"${prompt.slice(0, 60)}" asks what the quiz already asks, and was dropped.`);
      continue;
    }

    seen.add(key);
    questions.push({
      prompt,
      options: options.slice(0, MAX_OPTIONS_PER_QUESTION),
      correctIndex: Math.min(correctIndex, MAX_OPTIONS_PER_QUESTION - 1),
      rationale,
    });
  }

  return { questions, problems };
}

/**
 * Check a full draft before it is shown to anyone.
 *
 * Returns the usable draft plus a list of what had to be dropped or corrected,
 * so the facilitator sees the repairs rather than trusting silence.
 */
export function validateDraft(raw: unknown): { draft: CourseworkDraft | null; problems: DraftProblem[] } {
  if (!raw || typeof raw !== "object") {
    return { draft: null, problems: ["The drafter did not return anything usable."] };
  }

  const data = raw as Record<string, unknown>;
  const { questions, problems } = validateQuestions(data.questions);

  const rawAssignment = (data.assignment ?? {}) as Record<string, unknown>;
  const title = typeof rawAssignment.title === "string" ? rawAssignment.title.trim() : "";
  const instructions = typeof rawAssignment.instructions === "string" ? rawAssignment.instructions.trim() : "";

  if (!title || !instructions) {
    problems.push("The task came back incomplete, so it has been left blank for you to write.");
  }

  const notes = readNotes(data.notes);

  if (questions.length === 0 && !title) {
    return { draft: null, problems: [...problems, "Nothing usable came back. Try again, or write it by hand."] };
  }
  if (questions.length > 0 && questions.length < MIN_DRAFT_QUESTIONS) {
    problems.push(`Only ${questions.length} question${questions.length === 1 ? "" : "s"} survived checking — add more before saving.`);
  }

  return {
    draft: {
      questions,
      assignment: {
        title,
        instructions,
        // The rubric is the house standard, not the model's invention: it is
        // what every peer critique in the programme scores against.
        rubric: DEFAULT_RUBRIC,
        reviewsRequired: DEFAULT_REVIEWS_REQUIRED,
      },
      notes,
    },
    problems,
  };
}

export function readNotes(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((n): n is string => typeof n === "string").map((n) => n.trim()).filter(Boolean)
    : [];
}

/* ------------------------------------------------------------------ *
 * Where a question came from
 * ------------------------------------------------------------------ */

/**
 * Whether a saved question was written by a person, drafted by the model, or
 * drafted and then changed.
 *
 * Worth storing because in six months someone will ask why a question is on the
 * quiz, and "the model wrote it and nobody touched it" is a different answer
 * from "a facilitator rewrote it".
 */
export type CourseworkOrigin = "manual" | "drafted" | "edited";

export const ORIGIN_LABELS: Record<CourseworkOrigin, string> = {
  manual: "Written by hand",
  drafted: "Drafted, unedited",
  edited: "Drafted, then edited",
};

type ComparableQuestion = { prompt: string; options: string[]; correctIndex: number };

/**
 * Decide the origin of one question at save time by comparing it with the draft
 * it came from. A question with no draft behind it was typed by a person.
 */
export function originFor(current: ComparableQuestion, seed?: ComparableQuestion | null): CourseworkOrigin {
  if (!seed) return "manual";
  const same =
    current.prompt.trim() === seed.prompt.trim() &&
    current.correctIndex === seed.correctIndex &&
    current.options.length === seed.options.length &&
    current.options.every((o, i) => o.trim() === (seed.options[i] ?? "").trim());
  return same ? "drafted" : "edited";
}

/**
 * The origin to record for something being saved.
 *
 * Three pieces of evidence, in order of how much they tell us:
 *
 * - It was drafted in this sitting, so it can be compared with that draft
 *   directly (`againstDraft`, from `originFor`).
 * - It was loaded from the database, which already recorded an origin. If it has
 *   not been touched since, that record still stands.
 * - It was loaded and has been changed. Something that was drafted becomes
 *   `edited`; something a person wrote stays `manual`, because rewording your
 *   own words does not make them the model's.
 *
 * Reading the stored value back matters more than it looks. Without it, every
 * save after a page reload would claim a person wrote what the model wrote —
 * the exact question this field exists to answer, answered wrongly, and in the
 * direction that hides how little was reviewed.
 */
export function resolveOrigin(args: {
  againstDraft?: CourseworkOrigin | null;
  savedOrigin?: CourseworkOrigin | null;
  unchangedSinceSaved?: boolean;
}): CourseworkOrigin {
  if (args.againstDraft) return args.againstDraft;
  if (!args.savedOrigin) return "manual";
  if (args.unchangedSinceSaved) return args.savedOrigin;
  return args.savedOrigin === "manual" ? "manual" : "edited";
}

/** One line of provenance for the facilitator: what a draft was made from, and when. */
export function describeDraftRun(run: {
  kinds: MaterialKind[];
  notesLabel?: string | null;
  questionCount: number;
  byName?: string | null;
  at: Date | string;
}): string {
  const at = typeof run.at === "string" ? new Date(run.at) : run.at;
  const when = Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const who = (run.byName ?? "").trim();
  const n = run.questionCount;
  return [
    `${n} question${n === 1 ? "" : "s"} drafted from ${describeSource(run.kinds, run.notesLabel)}`,
    when ? ` on ${when}` : "",
    who ? ` by ${who}` : "",
    ".",
  ].join("");
}

/** Shown above a draft so nobody mistakes it for finished work. */
export function draftDisclaimer(): string {
  return `Drafted from the class material. Check every answer before saving — the pass mark is ${QUIZ_PASS_MARK}% and a wrong key fails learners silently.`;
}
