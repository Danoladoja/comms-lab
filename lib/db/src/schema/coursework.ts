import { pgTable, text, serial, integer, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
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

// One written assignment per module. Submitting counts as done (no grading gate).
export const assignmentsTable = pgTable(
  "assignments",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructions: text("instructions").notNull().default(""),
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

export type QuizQuestion = typeof quizQuestionsTable.$inferSelect;
export type QuizAttempt = typeof quizAttemptsTable.$inferSelect;
export type Assignment = typeof assignmentsTable.$inferSelect;
export type AssignmentSubmission = typeof assignmentSubmissionsTable.$inferSelect;
