import { DEFAULT_RUBRIC, DEFAULT_REVIEWS_REQUIRED, type RubricCriterion } from "./reviews";
import { QUIZ_PASS_MARK } from "./progress";

/**
 * Drafting a module's coursework from the facilitator's slides.
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

/**
 * The brief the model works to.
 *
 * Written as house instructions rather than a generic "make a quiz" prompt,
 * because the subject has failure modes a general model walks straight into:
 * confusing capacity with generation, treating a company press release as a
 * neutral source, or setting a task that could be answered from a search engine
 * without attending the class.
 */
export function draftSystemPrompt(): string {
  return [
    "You write coursework for AfriEnergy Comms Lab, a programme training journalists,",
    "communicators and advocates who report on Africa's energy sector.",
    "",
    "You are given the text of one class's slides. You draft two things: a short",
    "multiple-choice quiz, and one written task. A human facilitator edits and",
    "approves everything you write, so flag your own uncertainty rather than",
    "smoothing over it.",
    "",
    "The quiz checks whether someone was paying attention. Rules:",
    `- Between ${MIN_DRAFT_QUESTIONS} and ${MAX_DRAFT_QUESTIONS} questions.`,
    `- Each has between ${MIN_OPTIONS_PER_QUESTION} and ${MAX_OPTIONS_PER_QUESTION} options, exactly one correct.`,
    "- Every answer must be settled by the slides. Never require outside knowledge.",
    "- Wrong options must be plausible to someone who half-listened. No joke answers,",
    "  no options that are obviously longer or more detailed than the rest.",
    "- Test understanding, not recall of a number that happened to be on a slide.",
    "- Be exact about energy terms. Capacity is not generation, megawatts are not",
    "  megawatt-hours, a tariff is not a subsidy. If the slides are loose about this,",
    "  say so in your notes rather than repeating the looseness.",
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
    "Write in clear British English. Address the learner directly as 'you'.",
    "No exclamation marks, no encouragement, no filler.",
  ].join("\n");
}

/** The JSON shape the model must return. */
export function draftResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    required: ["questions", "assignment", "notes"],
    properties: {
      questions: {
        type: "array",
        minItems: MIN_DRAFT_QUESTIONS,
        maxItems: MAX_DRAFT_QUESTIONS,
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
      },
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

export function draftUserPrompt(args: {
  programTitle: string;
  sessionTitle: string;
  sessionDescription: string;
  slideText: string;
}): string {
  return [
    `Programme: ${args.programTitle}`,
    `Class: ${args.sessionTitle}`,
    args.sessionDescription ? `What the facilitator says this class covers: ${args.sessionDescription}` : "",
    "",
    "Slides:",
    "",
    args.slideText,
  ]
    .filter(Boolean)
    .join("\n");
}

export type DraftProblem = string;

/**
 * Check what came back before showing it to anyone.
 *
 * Returns the usable draft plus a list of what had to be dropped or corrected,
 * so the facilitator sees the repairs rather than trusting silence.
 */
export function validateDraft(raw: unknown): { draft: CourseworkDraft | null; problems: DraftProblem[] } {
  const problems: DraftProblem[] = [];
  if (!raw || typeof raw !== "object") {
    return { draft: null, problems: ["The drafter did not return anything usable."] };
  }

  const data = raw as Record<string, unknown>;
  const rawQuestions = Array.isArray(data.questions) ? data.questions : [];
  const questions: DraftQuestion[] = [];

  for (const [i, entry] of rawQuestions.entries()) {
    const q = entry as Record<string, unknown>;
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

    questions.push({
      prompt,
      options: options.slice(0, MAX_OPTIONS_PER_QUESTION),
      correctIndex: Math.min(correctIndex, MAX_OPTIONS_PER_QUESTION - 1),
      rationale,
    });
  }

  const rawAssignment = (data.assignment ?? {}) as Record<string, unknown>;
  const title = typeof rawAssignment.title === "string" ? rawAssignment.title.trim() : "";
  const instructions = typeof rawAssignment.instructions === "string" ? rawAssignment.instructions.trim() : "";

  if (!title || !instructions) {
    problems.push("The task came back incomplete, so it has been left blank for you to write.");
  }

  const notes = Array.isArray(data.notes)
    ? data.notes.filter((n): n is string => typeof n === "string").map((n) => n.trim()).filter(Boolean)
    : [];

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

/** Shown above a draft so nobody mistakes it for finished work. */
export function draftDisclaimer(): string {
  return `Drafted from the slides. Check every answer before saving — the pass mark is ${QUIZ_PASS_MARK}% and a wrong key fails learners silently.`;
}
