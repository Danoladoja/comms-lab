import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { programsTable } from "./programs";
import { usersTable } from "./users";

// One live module of a program. meetUrl is pasted by the admin (Google Meet link);
// recordingUrl is the unlisted YouTube link added after the session.
export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  programId: integer("program_id").notNull().references(() => programsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  durationMins: integer("duration_mins").notNull().default(60),
  meetUrl: text("meet_url"),
  recordingUrl: text("recording_url"),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;
