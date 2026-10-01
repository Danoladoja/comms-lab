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

/**
 * The kinds of question a form can ask.
 *
 * `slider` and `rating` are deliberately separate, and the difference is not
 * cosmetic. A slider is a continuous line somebody drags, best for "how much"
 * — confidence, preparedness, likelihood — and its answers average honestly
 * because the scale is a quantity. A rating is a small set of named steps
 * somebody picks between, best for "how good", and its labels are the whole
 * point: "Strongly agree" is a position, not a 5.
 *
 * Collapsing them into one type would have meant either dragging a handle to
 * pick "Strongly agree", or offering ten buttons for a confidence score. Both
 * are worse to answer and worse to read back.
 */
export type QuestionKind = "slider" | "rating" | "choice" | "multi" | "short" | "long";

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
  /** rating: how many steps, and what the ends of the scale mean. */
  scale?: number;
  lowLabel?: string;
  highLabel?: string;
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
  /**
   * The part of the form this belongs to.
   *
   * Twenty questions in one unbroken column is a form people abandon halfway
   * and a form people answer carelessly in the second half. Three named
   * sections tell somebody where they are and how much is left, and they let
   * the questions be grouped by what they are actually about rather than by
   * what type they happen to be.
   *
   * Empty on anything written before sections existed, which then draws as one
   * unnamed run exactly as it did.
   */
  section: string;
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
/** A rating with more steps than this is a slider wearing buttons. */
export const MAX_RATING_SCALE = 7;
export const MIN_RATING_SCALE = 3;

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

  if (q.kind === "rating") {
    const scale = c.scale ?? 5;
    if (!Number.isInteger(scale) || scale < MIN_RATING_SCALE || scale > MAX_RATING_SCALE) {
      return `A rating needs between ${MIN_RATING_SCALE} and ${MAX_RATING_SCALE} steps. `
        + "More than that and people stop choosing and start guessing.";
    }
    if (!(c.lowLabel ?? "").trim() || !(c.highLabel ?? "").trim()) {
      return "Say what the bottom and the top of the rating mean. A 4 out of 5 of what?";
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
    q.kind === "slider" || q.kind === "rating"
      ? number === null || number === undefined
      : q.kind === "multi" ? choices.length === 0
        : text.length === 0;

  if (empty) {
    // Silence on an optional question is an answer, and a valid one.
    return q.required ? "This one needs an answer." : null;
  }

  if (q.kind === "rating") {
    const scale = c.scale ?? 5;
    if (typeof number !== "number" || Number.isNaN(number)) return "Pick a rating.";
    if (!Number.isInteger(number) || number < 1 || number > scale) {
      return `Pick a rating between 1 and ${scale}.`;
    }
    return null;
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

/**
 * The questions grouped into the sections they belong to, in order.
 *
 * Order comes from where each section first appears rather than from an
 * alphabetical sort or a separate table of sections. A form is a sequence
 * somebody reads top to bottom, and the sequence is already recorded in
 * `sortOrder` — giving sections their own ordering would create a second
 * source of truth about the order of a thing that only has one.
 */
export function sectionsOf(questions: readonly FormQuestion[]): {
  name: string;
  questions: FormQuestion[];
}[] {
  const ordered = [...questions].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const out: { name: string; questions: FormQuestion[] }[] = [];
  for (const q of ordered) {
    const name = (q.section ?? "").trim();
    const last = out[out.length - 1];
    // Consecutive questions in the same section stay together; the same name
    // reappearing later starts a new block, because that is what the order
    // says happened.
    if (last && last.name === name) last.questions.push(q);
    else out.push({ name, questions: [q] });
  }
  return out;
}

/** How a section reads above its questions: "2 of 3 · What changed". */
export function sectionHeading(index: number, total: number, name: string): string {
  const where = total > 1 ? `${index + 1} of ${total}` : "";
  if (!name.trim()) return where;
  return where ? `${where} · ${name}` : name;
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

export type UnsavedQuestion = Omit<FormQuestion, "id">;

/**
 * The Lab's standard pair of forms.
 *
 * Offered rather than imposed: every question is meant to be edited, and
 * several should be, because a programme about hostile interviews and one about
 * writing for policymakers do not measure the same confidence.
 *
 * Three things about the shape are worth keeping whatever else changes.
 *
 * Three sections, because twenty questions in one unbroken column is a form
 * people abandon halfway and answer carelessly in the second half. The sections
 * are what the questions are *about* — who you are, where you stand, what you
 * think of us — not what type they happen to be.
 *
 * Paired sliders on both sides with the same keys, because that is the only
 * thing that turns a satisfaction score into a measured change.
 *
 * And a deliberate imbalance between how much is asked and how much is
 * compulsory. Twenty questions is a lot to require of somebody whose
 * certificate is waiting on it, so most of them are a tap — a rating, a slider,
 * a choice — and exactly two written answers are required. The rest are
 * offered, and people with something to say will say it. A form with twelve
 * compulsory written answers collects twelve instances of the word "good".
 */

const slider = (
  pairKey: string, section: string, prompt: string, minLabel: string, maxLabel: string,
): UnsavedQuestion => ({
  kind: "slider", prompt, help: "", required: true,
  config: { min: 0, max: 10, step: 1, minLabel, maxLabel },
  pairKey, sortOrder: 0, section,
});

const rating = (
  section: string, prompt: string, help = "", required = true,
): UnsavedQuestion => ({
  kind: "rating", prompt, help, required,
  config: { scale: 5, lowLabel: "Poor", highLabel: "Excellent" },
  pairKey: "", sortOrder: 0, section,
});

const agreement = (section: string, prompt: string): UnsavedQuestion => ({
  kind: "rating", prompt, help: "", required: true,
  config: { scale: 5, lowLabel: "Strongly disagree", highLabel: "Strongly agree" },
  pairKey: "", sortOrder: 0, section,
});

/** The four confidence questions asked identically at both ends. */
function confidenceSliders(section: string): UnsavedQuestion[] {
  return [
    slider("confidence-overall", section,
      "How confident do you feel communicating on energy issues in public?",
      "Not at all confident", "Completely confident"),
    slider("confidence-hostile", section,
      "How confident do you feel handling a hostile or sceptical audience?",
      "Not at all confident", "Completely confident"),
    slider("confidence-complex", section,
      "How confident do you feel explaining a technical energy issue to a non-specialist?",
      "Not at all confident", "Completely confident"),
    slider("confidence-crisis", section,
      "How prepared do you feel to communicate during a crisis?",
      "Not at all prepared", "Completely prepared"),
  ];
}

const FOCUS_OPTIONS = [
  "Speaking to the media with confidence",
  "Writing clearly for non-specialists",
  "Handling hostile questions",
  "Communicating in a crisis",
  "Building an audience over time",
  "Working with policymakers",
  "Using data and evidence well",
];

function openingQuestions(): UnsavedQuestion[] {
  const A = "About you and your work";
  const B = "Where you are starting from";
  const C = "What you came for";

  return [
    /* --- A: who we are teaching, which is what lets any of this be segmented --- */
    {
      kind: "choice", prompt: "Which best describes the organisation you work with?",
      help: "", required: true,
      config: {
        options: [
          "Government or a public body", "A utility or energy company",
          "A civil society organisation or NGO", "Media or journalism",
          "A research institute or university", "Independent or freelance", "Other",
        ],
      },
      pairKey: "", sortOrder: 0, section: A,
    },
    {
      kind: "choice", prompt: "How long have you worked in communications?",
      help: "", required: true,
      config: { options: ["Under a year", "1 to 3 years", "4 to 7 years", "8 to 15 years", "More than 15 years"] },
      pairKey: "", sortOrder: 0, section: A,
    },
    {
      kind: "choice", prompt: "How often do you speak publicly about energy — interviews, panels, briefings?",
      help: "", required: true,
      config: { options: ["Never so far", "Once or twice a year", "Every few months", "Monthly", "Weekly or more"] },
      pairKey: "frequency", sortOrder: 0, section: A,
    },
    agreement(A, "I have enough time set aside each week to take part properly."),
    {
      kind: "short", prompt: "What do you most often have to communicate about?",
      help: "A line is plenty — tariffs, transition policy, a particular project.",
      required: false, config: { wordsAtMost: 40 },
      pairKey: "", sortOrder: 0, section: A,
    },

    /* --- B: the baseline every later claim is measured against --- */
    ...confidenceSliders(B),
    agreement(B, "I know how to tell whether my communication has actually landed."),
    agreement(B, "I have a clear sense of who my audience is before I write or speak."),
    {
      kind: "rating", prompt: "I feel able to push back when I am asked to communicate something "
        + "I believe is misleading.",
      help: "", required: true,
      config: { scale: 5, lowLabel: "Strongly disagree", highLabel: "Strongly agree" },
      pairKey: "agency", sortOrder: 0, section: B,
    },
    {
      kind: "short", prompt: "What is the hardest part of your job as a communicator right now?",
      help: "", required: true, config: { wordsAtLeast: 10, wordsAtMost: 80 },
      pairKey: "", sortOrder: 0, section: B,
    },

    /* --- C: expectation, so it can be set against outcome at the end --- */
    {
      kind: "multi", prompt: "Which of these matter most to you on this programme?",
      help: "Pick up to three.", required: true,
      config: { options: FOCUS_OPTIONS, pickAtLeast: 1, pickAtMost: 3 },
      pairKey: "priorities", sortOrder: 0, section: C,
    },
    {
      kind: "choice", prompt: "Which one of those matters most?",
      help: "", required: true, config: { options: FOCUS_OPTIONS },
      pairKey: "top-priority", sortOrder: 0, section: C,
    },
    {
      kind: "long", prompt: "What do you most want to be able to do by the end of this programme?",
      help: "A few sentences. We read every one of these before the first class.",
      required: true, config: { wordsAtLeast: 20, wordsAtMost: 150 },
      pairKey: "", sortOrder: 0, section: C,
    },
    {
      kind: "slider", prompt: "How much of a priority is this programme against everything else on your plate?",
      help: "", required: true,
      config: { min: 0, max: 10, step: 1, minLabel: "One of many things", maxLabel: "My main focus" },
      pairKey: "", sortOrder: 0, section: C,
    },
    {
      kind: "choice", prompt: "How did you hear about the Lab?",
      help: "", required: false,
      config: {
        options: [
          "A colleague or friend", "Social media", "A newsletter or mailing list",
          "An event or conference", "A partner organisation", "Somewhere else",
        ],
      },
      pairKey: "", sortOrder: 0, section: C,
    },
    {
      kind: "short", prompt: "Is there anything that might make it hard for you to take part?",
      help: "Connectivity, time zones, work patterns — anything we should know. Optional.",
      required: false, config: { wordsAtMost: 80 },
      pairKey: "", sortOrder: 0, section: C,
    },
  ].map((q, i) => ({ ...q, sortOrder: i })) as UnsavedQuestion[];
}

function closingQuestions(): UnsavedQuestion[] {
  const A = "How the programme was run";
  const B = "Where you are now";
  const C = "What it changed, and what we should change";

  return [
    /* --- A: delivery, which is the part the Lab can act on next month --- */
    rating(A, "Overall, how would you rate the programme?"),
    rating(A, "How would you rate the live classes?"),
    rating(A, "How would you rate the written tasks and the critiques?"),
    rating(A, "How would you rate the Simulation Studio exercises?", "", false),
    rating(A, "How would you rate the facilitators?"),
    rating(A, "How would you rate the platform itself — the app you are using now?"),
    agreement(A, "The workload was about right for the time I had."),
    agreement(A, "I knew what was expected of me each week."),
    {
      kind: "choice", prompt: "How much of the programme were you able to take part in?",
      help: "", required: true,
      config: { options: ["Almost all of it", "Most of it", "About half", "Less than half"] },
      pairKey: "", sortOrder: 0, section: A,
    },

    /* --- B: the same four sliders, which is where the impact claim comes from --- */
    ...confidenceSliders(B),
    agreement(B, "I know how to tell whether my communication has actually landed."),
    agreement(B, "I have a clear sense of who my audience is before I write or speak."),
    {
      kind: "rating", prompt: "I feel able to push back when I am asked to communicate something "
        + "I believe is misleading.",
      help: "", required: true,
      config: { scale: 5, lowLabel: "Strongly disagree", highLabel: "Strongly agree" },
      pairKey: "agency", sortOrder: 0, section: B,
    },
    {
      kind: "choice", prompt: "How often do you now expect to speak publicly about energy?",
      help: "", required: true,
      config: { options: ["Never", "Once or twice a year", "Every few months", "Monthly", "Weekly or more"] },
      pairKey: "frequency", sortOrder: 0, section: B,
    },

    /* --- C: outcome against expectation, then the part that improves the Lab --- */
    {
      kind: "multi", prompt: "Which of these did the programme actually help you with?",
      help: "Pick as many as apply.", required: true,
      config: { options: FOCUS_OPTIONS, pickAtLeast: 1 },
      pairKey: "priorities", sortOrder: 0, section: C,
    },
    {
      kind: "long", prompt: "What can you do now that you could not do before?",
      help: "Be specific if you can — one concrete example is worth more to us than a compliment.",
      required: true, config: { wordsAtLeast: 25, wordsAtMost: 200 },
      pairKey: "", sortOrder: 0, section: C,
    },
    {
      kind: "long", prompt: "What was weakest about the programme, and what would you change?",
      help: "This is the single most useful thing you can give us. Be blunt — the people who taught "
        + "you cannot see who wrote this.",
      required: true, config: { wordsAtLeast: 20, wordsAtMost: 200 },
      pairKey: "", sortOrder: 0, section: C,
    },
    {
      kind: "slider", prompt: "How likely are you to recommend this programme to a colleague?",
      help: "", required: true,
      config: { min: 0, max: 10, step: 1, minLabel: "Not at all likely", maxLabel: "Extremely likely" },
      pairKey: "", sortOrder: 0, section: C,
    },
    {
      kind: "multi", prompt: "What would you like the Lab to offer next?",
      help: "Pick as many as apply. Optional.", required: false,
      config: {
        options: [
          "A more advanced version of this programme", "Shorter refresher sessions",
          "One-to-one coaching", "A programme on a different topic",
          "An alumni network", "Written guides I can keep",
        ],
      },
      pairKey: "", sortOrder: 0, section: C,
    },
    {
      kind: "short", prompt: "Anything else you want to tell us?",
      help: "Optional.", required: false, config: { wordsAtMost: 120 },
      pairKey: "", sortOrder: 0, section: C,
    },
  ].map((q, i) => ({ ...q, sortOrder: i })) as UnsavedQuestion[];
}

export function standardQuestions(stage: FormStage): UnsavedQuestion[] {
  return stage === "before" ? openingQuestions() : closingQuestions();
}
