import { countWords } from "./wordMinimums";

/**
 * The opening assessment and the closing survey.
 *
 * Two jobs, one engine. Before a programme the Lab wants to know where people
 * are starting from and what they came for; after it, what changed and how it
 * went. Those are the same machinery pointed at different moments, and
 * building them as two features would have guaranteed that the questions could
 * not be compared — which is the one thing that makes either of them worth
 * collecting.
 *
 * Three rules are doing real work here, and all three are about honesty rather
 * than validation.
 *
 * A compulsory form must be answerable. If somebody cannot file it, their
 * certificate is withheld for a fault that is ours, so every refusal here has
 * to name the question and say exactly what it wants — never "please complete
 * all required fields", which tells a person to go and hunt.
 *
 * A word limit is a limit, not a wall. The floor on written coursework exists
 * because a two-line answer to a week's task is not an answer. The limits here
 * exist for the opposite reason: to keep a survey finishable, and to stop one
 * person writing three thousand words that nobody will read. So the ceiling is
 * enforced and the floor is gentle, and both are counted in words because
 * "280 characters" means nothing to somebody writing a sentence.
 *
 * And nothing here can be failed. There are no right answers, no score and no
 * pass mark. A learner who says the programme was poor must be at no
 * disadvantage whatsoever for saying so, and the cleanest way to guarantee
 * that is for this file to contain no concept that could express it.
 */

export type FormStage = "before" | "after";

export type QuestionKind = "slider" | "choice" | "multi" | "short" | "long";

export type QuestionConfig = {
  options?: string[];
  pickAtLeast?: number;
  pickAtMost?: number;
  min?: number;
  max?: number;
  step?: number;
  minLabel?: string;
  maxLabel?: string;
  wordsAtLeast?: number;
  wordsAtMost?: number;
};

export type FormQuestion = {
  id: number;
  kind: QuestionKind;
  prompt: string;
  help: string;
  required: boolean;
  config: QuestionConfig;
  pairKey: string;
  sortOrder: number;
};

/** What a learner has put against one question. */
export type GivenAnswer = {
  questionId: number;
  number?: number | null;
  text?: string;
  choices?: string[];
};

export const MAX_PROMPT = 300;
export const MAX_OPTIONS = 12;
/** Nobody reads past this, and asking for it is a way of getting nothing. */
export const MAX_WORDS_CEILING = 500;

/* ------------------------------------------------------------------ *
 * Building a form
 * ------------------------------------------------------------------ */

/**
 * Why this question cannot be saved, in the words an admin needs, or null.
 *
 * Checked when the form is built rather than when a learner meets it. A
 * slider whose maximum is below its minimum is a mistake somebody made on a
 * Tuesday afternoon; finding it on the evening forty-five people are trying to
 * file their closing survey is the worst possible time.
 */
export function questionProblem(q: {
  kind: string;
  prompt: string;
  config: QuestionConfig;
}): string | null {
  const prompt = q.prompt.trim();
  if (prompt.length === 0) return "Every question needs something to ask.";
  if (prompt.length > MAX_PROMPT) {
    return `That question is ${prompt.length} characters. Keep it under ${MAX_PROMPT} — a question `
      + "nobody can hold in their head gets answered at random.";
  }

  const c = q.config;

  if (q.kind === "choice" || q.kind === "multi") {
    const options = (c.options ?? []).map((o) => o.trim()).filter((o) => o.length > 0);
    if (options.length < 2) return "Give them at least two things to choose between.";
    if (options.length > MAX_OPTIONS) {
      return `That is ${options.length} options. Keep it to ${MAX_OPTIONS} — past that people pick `
        + "from the first few and the rest collect nothing.";
    }
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      return "Two of those options are the same. Every answer has to mean one thing.";
    }
    if (q.kind === "multi") {
      const least = c.pickAtLeast ?? 0;
      const most = c.pickAtMost ?? options.length;
      if (least > most) return "They cannot be asked to pick more than they are allowed to pick.";
      if (most > options.length) return "They cannot pick more options than there are.";
    }
    return null;
  }

  if (q.kind === "slider") {
    const min = c.min ?? 0;
    const max = c.max ?? 10;
    const step = c.step ?? 1;
    if (max <= min) return "The far end of the line has to be past the near end.";
    if (step <= 0) return "The steps along the line have to be bigger than nothing.";
    if ((max - min) / step > 100) {
      return "That line has too many stops on it to drag accurately. Use bigger steps.";
    }
    // Not required, but a line with nothing written at either end measures
    // nothing: 7 out of 10 of what, in which direction?
    if (!(c.minLabel ?? "").trim() || !(c.maxLabel ?? "").trim()) {
      return "Say what each end of the line means. A number with nothing at either end cannot be "
        + "read back later.";
    }
    return null;
  }

  if (q.kind === "short" || q.kind === "long") {
    const least = c.wordsAtLeast ?? 0;
    const most = c.wordsAtMost ?? (q.kind === "short" ? 60 : 300);
    if (most > MAX_WORDS_CEILING) {
      return `A ${most}-word limit is past what anybody will read. Keep it to ${MAX_WORDS_CEILING}.`;
    }
    if (least > most) return "The smallest answer you will accept is longer than the longest you allow.";
    if (least < 0 || most <= 0) return "Word limits have to be positive numbers.";
    return null;
  }

  return "That is not a kind of question this form knows how to ask.";
}

/** Why the form as a whole cannot be published, or null. */
export function formProblem(args: {
  questions: readonly FormQuestion[];
  title: string;
}): string | null {
  if (!args.title.trim()) return "Give the form a title — it is the first thing anybody reads.";
  if (args.questions.length === 0) {
    return "There are no questions on this form yet, so there is nothing to publish.";
  }
  if (!args.questions.some((q) => q.required)) {
    return "Nothing on this form has to be answered, so it can be filed empty. Make at least one "
      + "question required, or there is no point asking.";
  }
  for (const q of args.questions) {
    const problem = questionProblem(q);
    if (problem) return `"${q.prompt.slice(0, 40)}…" cannot be asked: ${problem}`;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Answering a form
 * ------------------------------------------------------------------ */

/** Why this one answer is not acceptable, in the learner's words, or null. */
export function answerProblem(q: FormQuestion, given: GivenAnswer | undefined): string | null {
  const c = q.config;
  const text = (given?.text ?? "").trim();
  const choices = given?.choices ?? [];
  const number = given?.number ?? null;

  const empty =
    q.kind === "slider" ? number === null || number === undefined
      : q.kind === "multi" ? choices.length === 0
        : text.length === 0;

  if (empty) {
    // Silence on an optional question is an answer, and a valid one.
    return q.required ? "This one needs an answer." : null;
  }

  if (q.kind === "slider") {
    const min = c.min ?? 0;
    const max = c.max ?? 10;
    if (typeof number !== "number" || Number.isNaN(number)) return "Drag the handle to a number.";
    if (number < min || number > max) return `Pick something between ${min} and ${max}.`;
    return null;
  }

  if (q.kind === "choice") {
    if (!(c.options ?? []).includes(text)) return "That is not one of the answers offered.";
    return null;
  }

  if (q.kind === "multi") {
    const options = c.options ?? [];
    if (choices.some((ch) => !options.includes(ch))) return "That is not one of the answers offered.";
    if (new Set(choices).size !== choices.length) return "The same answer is picked twice.";
    const least = c.pickAtLeast ?? (q.required ? 1 : 0);
    const most = c.pickAtMost ?? options.length;
    if (choices.length < least) {
      return least === 1 ? "Pick at least one." : `Pick at least ${least}.`;
    }
    if (choices.length > most) {
      return most === 1 ? "Pick only one." : `Pick no more than ${most}.`;
    }
    return null;
  }

  // Written answers. Counted in words, and the ceiling is the one that is
  // actually enforced — see the note at the top of this file.
  const words = countWords(text);
  const least = c.wordsAtLeast ?? 0;
  const most = c.wordsAtMost ?? (q.kind === "short" ? 60 : 300);
  if (words > most) {
    const over = words - most;
    return `That is ${over} word${over === 1 ? "" : "s"} over. The limit is ${most}.`;
  }
  if (q.required && words < least) {
    const short = least - words;
    return `${short} more word${short === 1 ? "" : "s"} needed — this one asks for at least ${least}.`;
  }
  return null;
}

export type FormFault = { questionId: number; prompt: string; problem: string };

/**
 * Everything wrong with an attempt to file the form, question by question.
 *
 * All of them rather than the first, because a form returned one complaint at
 * a time is a form somebody abandons on the third round trip.
 */
export function formFaults(
  questions: readonly FormQuestion[],
  given: readonly GivenAnswer[],
): FormFault[] {
  const byId = new Map(given.map((g) => [g.questionId, g]));
  const faults: FormFault[] = [];
  for (const q of questions) {
    const problem = answerProblem(q, byId.get(q.id));
    if (problem) faults.push({ questionId: q.id, prompt: q.prompt, problem });
  }
  return faults;
}

/** One line summarising what is still wrong, for the top of the form. */
export function faultSummary(faults: readonly FormFault[]): string {
  if (faults.length === 0) return "";
  if (faults.length === 1) return "One question still needs attention — it is marked below.";
  return `${faults.length} questions still need attention. They are marked below.`;
}

/** How far through they are, for a progress line on a long form. */
export function answeredCount(
  questions: readonly FormQuestion[],
  given: readonly GivenAnswer[],
): { answered: number; required: number } {
  const byId = new Map(given.map((g) => [g.questionId, g]));
  const required = questions.filter((q) => q.required);
  const answered = required.filter((q) => answerProblem(q, byId.get(q.id)) === null).length;
  return { answered, required: required.length };
}

/* ------------------------------------------------------------------ *
 * What it holds up
 * ------------------------------------------------------------------ */

/**
 * Whether a certificate is being held back, and what to say about it.
 *
 * The closing survey is compulsory and this is what makes it so. The choice of
 * lever matters: it withholds the certificate rather than marking a module
 * incomplete, so nobody's learning record is altered by an administrative
 * requirement, and the survey cannot quietly re-lock the modules behind it.
 *
 * It is said on the dashboard from the moment the form is published, not
 * discovered at the end. A requirement nobody mentioned until the moment it
 * bites is the thing this codebase has had to apologise for more than once.
 */
export function certificateHold(args: {
  /** A closing form is published for this programme. */
  formPublished: boolean;
  /** They have filed it. */
  filed: boolean;
  /** Everything else about the programme is finished. */
  workComplete: boolean;
  formTitle?: string;
}): { held: boolean; note: string } {
  if (!args.formPublished || args.filed) return { held: false, note: "" };

  const name = (args.formTitle ?? "").trim() || "the closing survey";
  if (!args.workComplete) {
    return {
      held: false,
      note: `When you have finished the programme, ${name} is the last step before your `
        + "certificate. It takes a few minutes and it is what tells us whether any of this worked.",
    };
  }
  return {
    held: true,
    note: `You have finished everything. ${name} is the only thing between you and your `
      + "certificate — it takes a few minutes, and your answers are what let us show this "
      + "programme did what it set out to do.",
  };
}

/* ------------------------------------------------------------------ *
 * Reading it back
 * ------------------------------------------------------------------ */

/** A slider's answers across a cohort, as a number M&E can put in a report. */
export function sliderSummary(values: readonly number[]): {
  count: number;
  mean: number | null;
  lowest: number | null;
  highest: number | null;
} {
  const usable = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (usable.length === 0) return { count: 0, mean: null, lowest: null, highest: null };
  const total = usable.reduce((a, b) => a + b, 0);
  return {
    count: usable.length,
    // One decimal place. Any more is a precision this many answers cannot carry.
    mean: Math.round((total / usable.length) * 10) / 10,
    lowest: Math.min(...usable),
    highest: Math.max(...usable),
  };
}

/**
 * The change between the same question asked before and after.
 *
 * Returns null where either side has nothing, rather than an impressive-looking
 * number computed from four responses. A movement reported without the counts
 * behind it is how a programme ends up claiming an outcome it cannot support.
 */
export function pairedChange(args: {
  before: readonly number[];
  after: readonly number[];
}): { before: number; after: number; change: number; beforeCount: number; afterCount: number } | null {
  const b = sliderSummary(args.before);
  const a = sliderSummary(args.after);
  if (b.mean === null || a.mean === null) return null;
  return {
    before: b.mean,
    after: a.mean,
    change: Math.round((a.mean - b.mean) * 10) / 10,
    beforeCount: b.count,
    afterCount: a.count,
  };
}

/** How a paired movement reads in a sentence. */
export function changeNote(args: {
  prompt: string;
  change: ReturnType<typeof pairedChange>;
}): string {
  if (!args.change) return "Not enough answers on both sides to compare yet.";
  const { before, after, change, beforeCount, afterCount } = args.change;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "unchanged";
  if (direction === "unchanged") {
    return `${before} before, ${after} after — unchanged (${beforeCount} and ${afterCount} answers).`;
  }
  return `${before} before, ${after} after — ${direction} ${Math.abs(change)} `
    + `(${beforeCount} and ${afterCount} answers).`;
}

/** How many of a cohort have filed, for the admin's chase list. */
export function filedTally(args: { enrolled: number; filed: number }): string {
  if (args.enrolled === 0) return "Nobody is enrolled on this programme yet.";
  if (args.filed === args.enrolled) return `All ${args.enrolled} have filed it.`;
  const left = args.enrolled - args.filed;
  return `${args.filed} of ${args.enrolled} have filed it. `
    + `${left === 1 ? "1 is" : `${left} are`} still to come.`;
}

/* ------------------------------------------------------------------ *
 * A starting point
 * ------------------------------------------------------------------ */

/**
 * A question before it has been saved and given an id.
 *
 * Named for what it is rather than "DraftQuestion", which already means
 * something else in this codebase — a quiz question the model wrote and a
 * facilitator has not yet approved. Two different ideas sharing one name in
 * one barrel export is how a later edit lands in the wrong file.
 */
export type UnsavedQuestion = Omit<FormQuestion, "id">;

/**
 * The Lab's standard pair of forms.
 *
 * Offered rather than imposed: every question here is meant to be edited, and
 * several should be, because a programme about hostile interviews and one about
 * writing for policymakers do not measure the same confidence.
 *
 * What is worth keeping whatever else changes is the shape. Four sliders that
 * appear in both forms with the same pair keys, so there is something to
 * compare at the end; one question about what they came for and one about what
 * they got, so expectation and outcome can be set side by side; and exactly two
 * compulsory written answers, because a form with eight of them is a form
 * people write "good" in eight times.
 *
 * The sliders run 0 to 10 with both ends named. A number with nothing written
 * at either end cannot be read back a year later by somebody writing a funder's
 * report, which is the whole reason this data exists.
 */
export function standardQuestions(stage: FormStage): UnsavedQuestion[] {
  const slider = (pairKey: string, prompt: string, minLabel: string, maxLabel: string): UnsavedQuestion => ({
    kind: "slider",
    prompt,
    help: "",
    required: true,
    config: { min: 0, max: 10, step: 1, minLabel, maxLabel },
    pairKey,
    sortOrder: 0,
  });

  const sliders: UnsavedQuestion[] = [
    slider("confidence-overall",
      "How confident do you feel communicating on energy issues in public?",
      "Not at all confident", "Completely confident"),
    slider("confidence-hostile",
      "How confident do you feel handling a hostile or sceptical audience?",
      "Not at all confident", "Completely confident"),
    slider("confidence-complex",
      "How confident do you feel explaining a technical energy issue to a non-specialist?",
      "Not at all confident", "Completely confident"),
    slider("confidence-crisis",
      "How prepared do you feel to communicate during a crisis?",
      "Not at all prepared", "Completely prepared"),
  ];

  if (stage === "before") {
    return [
      ...sliders,
      {
        kind: "multi",
        prompt: "Which of these matter most to you on this programme?",
        help: "Pick up to three.",
        required: true,
        config: {
          options: [
            "Speaking to the media with confidence",
            "Writing clearly for non-specialists",
            "Handling hostile questions",
            "Communicating in a crisis",
            "Building an audience over time",
            "Working with policymakers",
            "Using data and evidence well",
          ],
          pickAtLeast: 1,
          pickAtMost: 3,
        },
        pairKey: "priorities",
        sortOrder: 0,
      },
      {
        kind: "long",
        prompt: "What do you most want to be able to do by the end of this programme?",
        help: "A few sentences is plenty. We read every one of these before the first class.",
        required: true,
        config: { wordsAtLeast: 20, wordsAtMost: 150 },
        pairKey: "",
        sortOrder: 0,
      },
      {
        kind: "short",
        prompt: "Is there anything that might make it hard for you to take part?",
        help: "Connectivity, time zones, work patterns — anything we should know. Optional.",
        required: false,
        config: { wordsAtMost: 80 },
        pairKey: "",
        sortOrder: 0,
      },
    ].map((qn, i) => ({ ...qn, sortOrder: i })) as UnsavedQuestion[];
  }

  return [
    ...sliders,
    {
      kind: "multi",
      prompt: "Which of these did the programme actually help you with?",
      help: "Pick as many as apply.",
      required: true,
      config: {
        options: [
          "Speaking to the media with confidence",
          "Writing clearly for non-specialists",
          "Handling hostile questions",
          "Communicating in a crisis",
          "Building an audience over time",
          "Working with policymakers",
          "Using data and evidence well",
        ],
        pickAtLeast: 1,
      },
      pairKey: "priorities",
      sortOrder: 0,
    },
    {
      kind: "slider",
      prompt: "How likely are you to recommend this programme to a colleague?",
      help: "",
      required: true,
      config: { min: 0, max: 10, step: 1, minLabel: "Not at all likely", maxLabel: "Extremely likely" },
      pairKey: "",
      sortOrder: 0,
    },
    {
      kind: "long",
      prompt: "What can you do now that you could not do before?",
      help: "Be specific if you can — a concrete example is worth more to us than a compliment.",
      required: true,
      config: { wordsAtLeast: 25, wordsAtMost: 200 },
      pairKey: "",
      sortOrder: 0,
    },
    {
      kind: "long",
      prompt: "What was weakest about the programme, and what would you change?",
      help: "This one is the most useful thing you can give us. Be blunt.",
      required: true,
      config: { wordsAtLeast: 20, wordsAtMost: 200 },
      pairKey: "",
      sortOrder: 0,
    },
    {
      kind: "short",
      prompt: "Anything else you want to tell us?",
      help: "Optional.",
      required: false,
      config: { wordsAtMost: 120 },
      pairKey: "",
      sortOrder: 0,
    },
  ].map((qn, i) => ({ ...qn, sortOrder: i })) as UnsavedQuestion[];
}
