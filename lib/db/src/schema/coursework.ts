import { pgTable, text, serial, integer, boolean, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { programsTable } from "./programs";
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
export const quizAttemptsTable = pgTable(
  "quiz_attempts",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    scorePct: integer("score_pct").notNull(),
    passed: boolean("passed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Every attempt is kept forever and nothing prunes them, so this table only
  // grows. It is read on every quiz view, after every attempt, and once per
  // module on every dashboard — all by (learner, module), which had no index
  // at all.
  (t) => [index("quiz_attempts_user_session_idx").on(t.userId, t.sessionId)],
);

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
     * Filed after the deadline, on a late pass.
     *
     * Stored rather than worked out from the dates, because an admin who moves
     * a deadline afterwards would otherwise silently rewrite history — turning
     * a piece that was late into one that was not, or the reverse. It records
     * what happened, and a record does not change when the rules do.
     *
     * It carries no penalty. Written work at the Lab is not marked, so there is
     * nothing to reduce. It exists so a facilitator can see who is struggling to
     * keep up, which is the genuinely useful thing about lateness.
     */
    late: boolean("late").notNull().default(false),

    /**
     * How many critiques this learner was asked for when they filed.
     *
     * Frozen here for the same reason `late` is: the published rules must not
     * be rewritten under somebody who has already met them. Raising an
     * assignment from two critiques to three used to flip everyone who had
     * written two back to incomplete, re-lock the following week and revoke
     * certificates already issued — from an edit that asked nothing new of the
     * people it punished.
     *
     * Null on everything filed before this existed, which then falls back to
     * whatever the assignment currently says, exactly as before.
     */
    reviewsRequiredAtSubmission: integer("reviews_required_at_submission"),

    /**
     * How many critiques this learner was asked for at the moment they
     * satisfied the requirement, or null if they never have.
     *
     * The sibling of the column above, for the other way the same injustice
     * happens. The Lab never asks for more critiques than there are classmates
     * to critique — otherwise a cohort too small to supply reviewers strands
     * everybody in it — but that count is taken fresh on every read, and it
     * rises all week as a cohort files its work.
     *
     * So a learner asked for one critique on Monday, because one classmate had
     * filed, wrote it and was told the module was complete. By Wednesday ten
     * had filed, the Lab wanted two, the module was incomplete again and the
     * module after it had re-locked. They had done nothing. Other people had
     * caught up.
     *
     * Written when a critique is filed, which is a moment the app is already
     * writing. A rule that needs a write to stay true cannot be enforced on a
     * read.
     */
    reviewsClearedRequired: integer("reviews_cleared_required"),

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
  (t) => [
    uniqueIndex("assignment_submissions_user_session_unique").on(t.userId, t.sessionId),
    // Everything that reads a module's work filters by session alone: the
    // review queue, the staff screen, the cohort room, the certificate
    // portfolio. Without this the database reads every row of the table —
    // including the full text of every essay in it — on each of them.
    index("assignment_submissions_session_idx").on(t.sessionId),
  ],
);

/**
 * A late pass, spent.
 *
 * Two per learner per programme, each buying 48 more hours on one module — both
 * its quiz and its written task. A row exists only once a pass has been used, so
 * counting what somebody has left is counting these — there is no balance to
 * keep in step with reality and therefore no balance that can drift out of step
 * with it.
 *
 * One row per (learner, module) is what makes the pass cover both pieces, and
 * it is why extending passes to quizzes needed no change here at all: the row
 * was already about the module. Each piece still shuts at its own time, 48 hours
 * after its own deadline — the pass moves both doors, it does not merge them.
 *
 * The programme is recorded alongside the module because the allowance is per
 * programme: a learner on two programmes has two passes on each, and working
 * that out from the module every time would mean a join on every check.
 *
 * The unique index is the whole safety mechanism. Two taps on a slow connection
 * would otherwise spend two passes for one extension, and the learner would
 * have no way of knowing why they had one left instead of two.
 */
export const latePassesTable = pgTable(
  "late_passes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    programId: integer("program_id")
      .notNull()
      .references(() => programsTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * The deadline it was spent against, kept so the record still reads true if
     * the date later moves. Where a module has two deadlines this is the one the
     * learner was actually looking at when they spent it.
     */
    extendedFrom: timestamp("extended_from", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("late_passes_user_session_unique").on(t.userId, t.sessionId),
    index("late_passes_user_program_idx").on(t.userId, t.programId),
  ],
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
export type LatePass = typeof latePassesTable.$inferSelect;

/**
 * A deadline moved for one learner, on one module, by an admin.
 *
 * The late pass is the learner's own remedy: fixed, countable, spent without
 * asking. This is the other half — the case the pass cannot reach. Somebody
 * added to a cohort three weeks in, somebody whose passes are gone, somebody
 * with a reason that does not fit in a rule. Until now the only answer was
 * "talk to the team", and the team had nothing to act with but the database.
 *
 * One row per learner per module, carrying one date that moves both of that
 * module's doors — its quiz and its written task — because a learner told the
 * writing had reopened while the quiz stayed shut has been helped with one hand
 * and blocked with the other.
 *
 * What it deliberately does NOT move is the rules the module was taught under.
 * The word floors are anchored to a module's original deadline so that a module
 * whose deadline had already passed when they came in keeps the rules its
 * cohort actually worked to. An extension that dragged those floors forward
 * would quietly ask a late learner for five hundred words nobody else on that
 * module was ever asked for.
 */
/**
 * A module a member of staff has opened for one learner.
 *
 * The sibling of a deadline extension, for the other way somebody gets stuck.
 * An extension moves a door's closing time; this opens a door that the rules
 * are holding shut. They are separate because a lock is checked before any
 * deadline is, so extra time cannot reach a locked module — which is exactly
 * the situation that had no remedy until now.
 *
 * It grants access and nothing else. No module is completed by a row here, no
 * quiz is marked, no task is filed and no certificate is earned. What the
 * learner owes, they still owe. That separation is the point: an override that
 * quietly completed work would be a way to issue a qualification by accident,
 * and afterwards nobody could tell which modules were earned and which were
 * waved through.
 *
 * A row exists only where an override has been granted, so taking one back is
 * deleting it and there is no state to keep in step with anything.
 */
export const moduleUnlocksTable = pgTable(
  "module_unlocks",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    /**
     * Why, in the admin's words. Required by the rules in @workspace/domain
     * rather than by the column, so the refusal can be a sentence rather than a
     * constraint violation — but never empty in practice.
     *
     * Kept because six months from now somebody will ask why this learner's
     * module was open when their work says it should not have been, and "no
     * reason recorded" is an answer that makes the Lab look arbitrary to the
     * one person it was trying to help.
     */
    reason: text("reason").notNull().default(""),
    /** Who opened it. Null if that admin's account is later removed. */
    grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One override per learner per module. Granting again rewrites the reason
    // rather than stacking a second row behind the first.
    uniqueIndex("module_unlocks_user_session_unique").on(t.userId, t.sessionId),
    // Read once per learner on every dashboard, and once per cohort on the
    // admin's progress screen — both by session.
    index("module_unlocks_session_idx").on(t.sessionId),
  ],
);

export const deadlineExtensionsTable = pgTable(
  "deadline_extensions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    programId: integer("program_id")
      .notNull()
      .references(() => programsTable.id, { onDelete: "cascade" }),
    /** The new door. Always later than the module's own deadline. */
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    /** Why, in the admin's words. Shown to nobody but staff; kept so a decision has a reason attached. */
    reason: text("reason").notNull().default(""),
    /** Who granted it. Null if that admin's account is later removed. */
    grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    // One extension per learner per module: granting again moves the same date
    // rather than stacking a second row nobody can see behind the first.
    uniqueIndex("deadline_extensions_user_session_unique").on(t.userId, t.sessionId),
    index("deadline_extensions_user_program_idx").on(t.userId, t.programId),
  ],
);

export type DeadlineExtension = typeof deadlineExtensionsTable.$inferSelect;
