import { pgTable, text, serial, integer, boolean, timestamp, customType, uniqueIndex, index } from "drizzle-orm/pg-core";
import { programsTable } from "./programs";
import { usersTable } from "./users";

/** Postgres bytea, for an attached document. Same reasoning as the slide deck. */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * The one piece of work a programme ends on.
 *
 * Everything else written at the Lab is attached to a module, peer-reviewed and
 * deliberately unmarked — the point of a module task is that classmates read it,
 * not that staff grade it. The capstone is the opposite on every count: one per
 * programme rather than one per module, read by staff rather than by peers,
 * given a score, and able to be sent back.
 *
 * It is a separate table rather than a flag on `assignments` for that reason.
 * An assignment is keyed to a session and carries a peer-review requirement, a
 * late-pass allowance and a rubric classmates score against; a capstone has a
 * programme, a verdict and a mark. Sharing a table would mean every read of
 * either having to ask which kind it was first, and the two sets of rules would
 * drift into each other.
 */
export const capstonesTable = pgTable(
  "capstones",
  {
    id: serial("id").primaryKey(),
    programId: integer("program_id")
      .notNull().references(() => programsTable.id, { onDelete: "cascade" }),

    title: text("title").notNull().default(""),
    /** What they are being asked to produce, and what it will be judged on. */
    brief: text("brief").notNull().default(""),

    /**
     * Length, counted in words rather than characters, as everywhere else in
     * the Lab. Zero means no floor and no ceiling, which is what a programme
     * that does not care about length should be able to say.
     */
    wordsAtLeast: integer("words_at_least").notNull().default(0),
    wordsAtMost: integer("words_at_most").notNull().default(0),

    /** Out of what. The mark is recorded; approval is the thing that gates. */
    maxScore: integer("max_score").notNull().default(100),

    /** When it stops accepting work. Empty means it stays open. */
    dueAt: timestamp("due_at", { withTimezone: true }),

    /**
     * Saved but not put in front of the cohort.
     *
     * Default true, following the closing survey rather than the quiz. A
     * half-written capstone that goes live does not merely embarrass: it
     * withholds every certificate on the programme until somebody notices,
     * because an unapproved capstone holds the certificate by design. The
     * dangerous direction is the same, so the default is the same.
     */
    draft: boolean("draft").notNull().default(true),
    postedAt: timestamp("posted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("capstones_program_unique").on(t.programId)],
);

/**
 * One attempt at the capstone.
 *
 * A row per attempt rather than a row per learner that gets overwritten. When a
 * piece is sent back, the returned version stays exactly as it was and a fresh
 * draft is opened beside it. Six months from now somebody will ask what the
 * learner actually submitted the first time and what they were told about it,
 * and an overwritten row cannot answer that.
 *
 * `status` runs draft → submitted → approved or returned. A returned attempt is
 * final as a record; the next attempt is a new row with a higher number. Exactly
 * one draft exists per learner at a time, which is what the partial unique index
 * below is for.
 */
export const capstoneSubmissionsTable = pgTable(
  "capstone_submissions",
  {
    id: serial("id").primaryKey(),
    capstoneId: integer("capstone_id")
      .notNull().references(() => capstonesTable.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull().references(() => usersTable.id, { onDelete: "cascade" }),

    /** 1 for the first go, 2 for the one after it was sent back, and so on. */
    attempt: integer("attempt").notNull().default(1),

    /** "draft" | "submitted" | "approved" | "returned". */
    status: text("status").notNull().default("draft"),

    /** The piece itself, typed or pasted in. Always present on anything sent. */
    body: text("body").notNull().default(""),

    /**
     * An optional document alongside the text.
     *
     * In the database for the same reason the slide decks are: the app runs on
     * hosting with a filesystem that does not survive a restart, and a learner's
     * final piece vanishing on a redeploy is not a trade worth making.
     *
     * Null on every attempt where nobody attached anything, which is most of
     * them, so the column costs nothing when unused.
     */
    filename: text("filename"),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    data: bytea("data"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }),

    /**
     * Filed after the deadline.
     *
     * Recorded at the moment of filing rather than worked out later from the
     * dates, because an admin who moves the deadline afterwards would otherwise
     * silently rewrite what happened — the same reason the module submissions
     * freeze theirs.
     */
    late: boolean("late").notNull().default(false),

    /* ---- the verdict ---- */
    score: integer("score"),
    /** Why, in the reviewer's words. Required when a piece is sent back. */
    reviewNote: text("review_note").notNull().default(""),
    reviewedByUserId: integer("reviewed_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("capstone_submissions_attempt_unique").on(t.capstoneId, t.userId, t.attempt),
    index("capstone_submissions_capstone_status_idx").on(t.capstoneId, t.status),
    index("capstone_submissions_user_idx").on(t.userId),
  ],
);

export type Capstone = typeof capstonesTable.$inferSelect;
export type CapstoneSubmission = typeof capstoneSubmissionsTable.$inferSelect;
