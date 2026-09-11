import { pgTable, text, serial, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

// Multiple-choice quiz questions attached to a module (session).
// correctIndex points into options; it is never sent to learners.
//
// `origin` records how the question came to exist: "manual" (a person typed it),
// "drafted" (the model wrote it and it was saved untouched), or "edited"
// (drafted, then changed before saving). It never reaches learners and never
// affects marking. It exists so "why is this question here?" has an answer, and
// so a facilitator can see how much of a quiz went out unreviewed.
export const quizQuestionsTable = pgTable("quiz_questions", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  options: jsonb("options").$type<string[]>().notNull(),
  correctIndex: integer("correct_index").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  origin: text("origin").notNull().default("manual"),
});

// Every quiz attempt is kept; the best score counts. Pass mark is 70%.
export const quizAttemptsTable = pgTable("quiz_attempts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  scorePct: integer("score_pct").notNull(),
  passed: boolean("passed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One "make" per module — the artifact the learner produces. This, not
 * attendance, is what completes a module.
 *
 * `rubric` lists the criteria peers score against; `reviewsRequired` is how many
 * critiques each learner owes before their own feedback unlocks. Set
 * reviewsRequired to 0 for a make that is not peer-reviewed.
 */
export const assignmentsTable = pgTable(
  "assignments",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
    rubric: jsonb("rubric")
      .$type<{ id: string; label: string; description: string; maxScore: number }[]>()
      .notNull()
      .default([]),
    reviewsRequired: integer("reviews_required").notNull().default(2),
    /**
     * When this task stops accepting submissions. Empty means never, which is
     * how every assignment behaved before deadlines existed.
     */
    dueAt: timestamp("due_at", { withTimezone: true }),
    /**
     * Saved but not yet posted to the cohort. Default false for the same reason
     * as the quiz: every task that already exists is already live.
     */
    draft: boolean("draft").notNull().default(false),
    /** When the cohort was told. Empty on tasks that predate posting. */
    postedAt: timestamp("posted_at", { withTimezone: true }),
    /** As on quiz questions: "manual", "drafted" or "edited". */
    origin: text("origin").notNull().default("manual"),
  },
  (t) => [uniqueIndex("assignments_session_unique").on(t.sessionId)],
);

export const assignmentSubmissionsTable = pgTable(
  "assignment_submissions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),

    /**
     * How the writer says they used AI on this piece, and a line about it.
     *
     * Required at submission from now on. Empty on everything filed before the
     * question existed, which is why the app words that as "not declared"
     * rather than implying anybody refused to answer.
     */
    aiUse: text("ai_use").notNull().default(""),
    aiNote: text("ai_note").notNull().default(""),

    /**
     * How the draft came to exist. Counts and timings only — never keystrokes,
     * never content. The Lab has to be able to say that out loud to a cohort.
     *
     * This is deliberately not a detector: no score is stored here and none is
     * computed anywhere, because detectors flag second-language writers more
     * often than fluent ones and this cohort writes in its second language.
     */
    activeSeconds: integer("active_seconds").notNull().default(0),
    sittings: integer("sittings").notNull().default(0),
    pasteCount: integer("paste_count").notNull().default(0),
    pastedChars: integer("pasted_chars").notNull().default(0),
    largestPaste: integer("largest_paste").notNull().default(0),

    /**
     * Taken out of the cohort discussion by a member of staff.
     *
     * Everyone is in by default and there is no learner opt-out, so this is the
     * remedy when a piece turns out to be too personal to sit in front of
     * twenty-four people. It hides the piece from the discussion only: the work
     * still counts, and staff still see it.
     */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: integer("withdrawn_by").references(() => usersTable.id, { onDelete: "set null" }),
  },
  (t) => [uniqueIndex("assignment_submissions_user_session_unique").on(t.userId, t.sessionId)],
);

/**
 * The cohort's conversation about one piece of work.
 *
 * Opens to a learner only once they have filed their own piece and written
 * their required critiques — the same "give to receive" gate that already
 * unseals their own feedback, so there is one rule to explain rather than two.
 */
export const submissionCommentsTable = pgTable(
  "submission_comments",
  {
    id: serial("id").primaryKey(),
    submissionId: integer("submission_id").notNull().references(() => assignmentSubmissionsTable.id, { onDelete: "cascade" }),
    /** Denormalised from the submission so a module's whole discussion is one indexed read. */
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("submission_comments_session_idx").on(t.sessionId, t.createdAt)],
);

/**
 * A peer critique of one submission.
 *
 * Reviews are attributed in the database — a facilitator needs to see who wrote
 * five identical reviews — but are shown to the author anonymously, because
 * people write braver feedback when their name is not on it.
 *
 * sessionId is denormalised from the submission so "how many reviews has this
 * learner written for this module" is one indexed lookup rather than a join.
 */
export const submissionReviewsTable = pgTable(
  "submission_reviews",
  {
    id: serial("id").primaryKey(),
    submissionId: integer("submission_id").notNull().references(() => assignmentSubmissionsTable.id, { onDelete: "cascade" }),
    reviewerId: integer("reviewer_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    scores: jsonb("scores").$type<Record<string, number>>().notNull(),
    comment: text("comment").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("submission_reviews_submission_reviewer_unique").on(t.submissionId, t.reviewerId),
    index("submission_reviews_session_reviewer_idx").on(t.sessionId, t.reviewerId),
  ],
);

export type QuizQuestion = typeof quizQuestionsTable.$inferSelect;
export type QuizAttempt = typeof quizAttemptsTable.$inferSelect;
export type Assignment = typeof assignmentsTable.$inferSelect;
export type AssignmentSubmission = typeof assignmentSubmissionsTable.$inferSelect;
export type SubmissionReview = typeof submissionReviewsTable.$inferSelect;
export type SubmissionComment = typeof submissionCommentsTable.$inferSelect;
