import { pgTable, text, serial, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { programsTable } from "./programs";
import { usersTable } from "./users";

// One live module of a program. meetUrl is pasted by the admin (Google Meet link);
// recordingUrl is the unlisted YouTube link added after the session.
export const sessionsTable = pgTable(
  "sessions",
  {
  id: serial("id").primaryKey(),
  programId: integer("program_id").notNull().references(() => programsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  durationMins: integer("duration_mins").notNull().default(60),
  meetUrl: text("meet_url"),
  /**
   * The calendar event the Lab made for this class, when it made one.
   *
   * Kept so the event can be moved when the class moves, rather than a second
   * one being created. That is the whole point of the app owning the meeting:
   * a link in the Lab and a link in a calendar invite, maintained separately,
   * drifted apart and cost this cohort three weeks of attendance. Remembering
   * the event is what stops there being two things again.
   *
   * Empty on every module whose link was pasted in by hand, which keeps working
   * exactly as before.
   */
  calendarEventId: text("calendar_event_id"),
  recordingUrl: text("recording_url"),
  /**
   * How long the recording runs, settled once for the whole cohort.
   *
   * It used to arrive from each learner's own browser in the same request that
   * reported what they had watched — so "this is one second long and I watched
   * one second" was a completed module and a certificate. The length belongs to
   * the recording, not to the person watching it, so it lives here: the first
   * plausible report from any player sets it and every later one is ignored.
   *
   * Cleared whenever the recording is replaced, so a new video is measured
   * against its own length rather than the old one's.
   */
  recordingDurationSeconds: integer("recording_duration_seconds"),
  /**
   * Where the automatic Meet-to-YouTube copy has got to for this class:
   * pending | searching | uploading | ready | failed | manual.
   * "manual" means a human pasted a link and the pipeline must not touch it.
   */
  recordingStatus: text("recording_status").notNull().default("pending"),
  /** The last thing that went wrong, shown to admins so they can act. */
  recordingError: text("recording_error"),
  recordingAttempts: integer("recording_attempts").notNull().default(0),
  recordingCheckedAt: timestamp("recording_checked_at", { withTimezone: true }),
  /** The Drive file already dealt with, so a retry never uploads twice. */
  recordingDriveFileId: text("recording_drive_file_id"),
  instructorId: integer("instructor_id").references(() => usersTable.id, { onDelete: "set null" }),
  /**
   * A facilitator with no account — a guest speaker, a visiting editor. Shown
   * to learners and nothing else: it grants no access to the room, the
   * attendance list or anybody's submissions. Set only when instructorId is
   * empty, so a class never carries two answers to who is running it.
   */
  guestFacilitator: text("guest_facilitator"),
  /**
   * When the module's quiz stops accepting answers. Empty means it never does,
   * which is how every module behaved before deadlines existed and how most
   * will go on behaving.
   *
   * It sits on the module rather than with the questions because the questions
   * are replaced wholesale on every save — a deadline kept alongside them would
   * be thrown away each time somebody reworded a question.
   */
  quizDueAt: timestamp("quiz_due_at", { withTimezone: true }),
  /**
   * A quiz that has been saved but not yet posted to the cohort.
   *
   * The default is deliberately "not a draft". Adding this column marks every
   * quiz that already exists as live, which is exactly what they are — the
   * alternative would take a term's worth of published coursework off every
   * learner's dashboard the moment this shipped. A genuinely new quiz is marked
   * as a draft by the code that first saves it, not by this default.
   */
  quizDraft: boolean("quiz_draft").notNull().default(false),
  /** When the cohort was told. Empty on quizzes that predate posting. */
  quizPostedAt: timestamp("quiz_posted_at", { withTimezone: true }),
  /**
   * A reading list saved but not yet posted.
   *
   * Default false for the same reason as the quiz: every reading list that
   * already exists is already on learners' screens, and adding this column must
   * not take a term's worth of links away from them. The first save of a *new*
   * list is what marks it private.
   */
  readingsDraft: boolean("readings_draft").notNull().default(false),
  readingsPostedAt: timestamp("readings_posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  // Postgres does not index the columns a foreign key points *from*, so every
  // one of these was a full scan of the table. Between them they carry the
  // dashboard, every heartbeat, the facilitator's own list, and the reminder
  // job's twice-every-five-minutes sweep for classes about to start.
  (t) => [
    index("sessions_program_idx").on(t.programId, t.startsAt),
    index("sessions_instructor_idx").on(t.instructorId),
    index("sessions_starts_at_idx").on(t.startsAt),
  ],
);

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
