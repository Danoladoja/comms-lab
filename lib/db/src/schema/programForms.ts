import { pgTable, text, serial, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { programsTable } from "./programs";
import { usersTable } from "./users";

/**
 * What the Lab asks a cohort at the start and at the end.
 *
 * Two forms per programme, and the pairing is the whole point. A closing
 * survey on its own collects opinions; the same questions asked before and
 * after collect *change*, which is the only thing an impact report can
 * honestly claim. "Eighty per cent rated the programme highly" is a
 * satisfaction score wearing an outcome's clothes. "Confidence in handling a
 * hostile interview rose from 3.1 to 6.8" is an outcome.
 *
 * So a question can carry a pair key, and a question with the same key in both
 * forms is understood to be the same question asked twice. Nothing enforces
 * that the two are worded identically — a question asked beforehand often
 * cannot be — but what is compared is always a pair somebody deliberately
 * made.
 *
 * Deliberately not a module's quiz. A quiz has right answers, is marked, can
 * be failed and gates a module. This has none of those: there is nothing to
 * get wrong, and a learner who says the programme was poor must be at no
 * disadvantage for saying so. The two share no code for that reason.
 */
export const programFormsTable = pgTable(
  "program_forms",
  {
    id: serial("id").primaryKey(),
    programId: integer("program_id")
      .notNull().references(() => programsTable.id, { onDelete: "cascade" }),

    /**
     * "before" or "after" — the opening assessment or the closing survey.
     *
     * Two rows per programme at most, which is what the unique index below
     * enforces. A third kind would be a different feature with different
     * rules, not another value here.
     */
    stage: text("stage").notNull(),

    title: text("title").notNull().default(""),
    /** Shown above the questions. Why the Lab is asking, and what happens next. */
    intro: text("intro").notNull().default(""),

    /**
     * Saved but not yet put in front of anybody.
     *
     * Default true, which is the opposite of the quiz's default and
     * deliberately so. A half-written quiz that goes live is embarrassing; a
     * half-written closing survey that goes live withholds certificates from a
     * whole cohort until somebody notices. The dangerous direction is
     * different, so the default is too.
     */
    draft: boolean("draft").notNull().default(true),
    /** When it was published to the cohort. Empty while it is a draft. */
    postedAt: timestamp("posted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("program_forms_program_stage_unique").on(t.programId, t.stage)],
);

/**
 * How a question is configured, by kind.
 *
 * One shape rather than a column per kind, because the kinds have almost
 * nothing in common and a table with `min_value`, `max_value`, `options`,
 * `word_min` and `word_max` would be mostly nulls and no clearer for it. The
 * rules that read this live in @workspace/domain and refuse a question whose
 * configuration does not match its kind.
 */
export type FormQuestionConfig = {
  /** choice, multi: what they can pick. */
  options?: string[];
  /** multi: how many they may pick. */
  pickAtLeast?: number;
  pickAtMost?: number;
  /** rating: how many named steps, and what the ends mean. */
  scale?: number;
  lowLabel?: string;
  highLabel?: string;
  /** slider: the line they drag along, and what each end means. */
  min?: number;
  max?: number;
  step?: number;
  minLabel?: string;
  maxLabel?: string;
  /** short, long: the limits, counted in words rather than characters. */
  wordsAtLeast?: number;
  wordsAtMost?: number;
};

export const formQuestionsTable = pgTable(
  "form_questions",
  {
    id: serial("id").primaryKey(),
    formId: integer("form_id")
      .notNull().references(() => programFormsTable.id, { onDelete: "cascade" }),

    /** "slider" | "rating" | "choice" | "multi" | "short" | "long" */
    kind: text("kind").notNull(),
    prompt: text("prompt").notNull(),
    /** Optional sentence under the question. Context, not a second question. */
    help: text("help").notNull().default(""),

    /**
     * Whether it must be answered before the form can be filed.
     *
     * Not every question should be. A compulsory form with twenty compulsory
     * questions is a form people click through to get rid of, and the writing
     * it extracts is worth nothing to anybody.
     */
    required: boolean("required").notNull().default(true),

    config: jsonb("config").$type<FormQuestionConfig>().notNull().default({}),

    /**
     * Ties this question to its twin in the other form.
     *
     * Empty on a question asked only once. Where it is set and the same key
     * appears on the other stage, the two are reported as before and after.
     */
    pairKey: text("pair_key").notNull().default(""),

    /**
     * The part of the form this belongs to.
     *
     * Twenty questions in one unbroken column is a form people abandon halfway
     * and answer carelessly in the second half. Named sections tell somebody
     * where they are and how much is left.
     *
     * A plain string on the question rather than a sections table, because a
     * section has no properties of its own and no existence apart from the
     * questions in it — a table would add a second source of truth about an
     * order that `sort_order` already records.
     *
     * Empty on anything written before sections existed, which then draws as
     * one unnamed run exactly as it did.
     */
    section: text("section").notNull().default(""),

    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("form_questions_form_idx").on(t.formId, t.sortOrder)],
);

/**
 * One learner's filing of one form.
 *
 * Separate from the answers so that "who has done it" — which decides whether
 * a certificate is held — can be asked without reading anybody's answers. That
 * separation is not an optimisation. It is what lets the Lab enforce a
 * compulsory survey and still tell a cohort, truthfully, that the people who
 * taught them cannot see who said what.
 */
export const formResponsesTable = pgTable(
  "form_responses",
  {
    id: serial("id").primaryKey(),
    formId: integer("form_id")
      .notNull().references(() => programFormsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("form_responses_form_user_unique").on(t.formId, t.userId),
    index("form_responses_form_idx").on(t.formId),
  ],
);

/**
 * One answer to one question.
 *
 * A row per answer rather than a blob per response, because every question M&E
 * will ever ask of this data is about one question across a cohort — the mean
 * of a slider, the spread of a choice, the change between two paired
 * questions. Those are one line of SQL against this shape and a full table
 * scan with parsing against the other.
 *
 * The value is stored by kind rather than stringified: a slider's answer is a
 * number and should be summed as one, not parsed back out of text every time
 * somebody asks for an average.
 */
export const formAnswersTable = pgTable(
  "form_answers",
  {
    id: serial("id").primaryKey(),
    responseId: integer("response_id")
      .notNull().references(() => formResponsesTable.id, { onDelete: "cascade" }),
    questionId: integer("question_id")
      .notNull().references(() => formQuestionsTable.id, { onDelete: "cascade" }),

    /** slider: where they left the handle. */
    number: integer("number"),
    /** short, long: what they wrote. choice: what they picked. */
    text: text("text").notNull().default(""),
    /** multi: everything they picked. */
    choices: jsonb("choices").$type<string[]>().notNull().default([]),
  },
  (t) => [
    uniqueIndex("form_answers_response_question_unique").on(t.responseId, t.questionId),
    // Every aggregate is "this question, across everybody".
    index("form_answers_question_idx").on(t.questionId),
  ],
);
