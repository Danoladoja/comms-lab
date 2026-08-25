import { pgTable, text, serial, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

// Multiple-choice quiz questions attached to a module (session).
// correctIndex points into options; it is never sent to learners.
export const quizQuestionsTable = pgTable("quiz_questions", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  options: jsonb("options").$type<string[]>().notNull(),
  correctIndex: integer("correct_index").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
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
  },
  (t) => [uniqueIndex("assignment_submissions_user_session_unique").on(t.userId, t.sessionId)],
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
