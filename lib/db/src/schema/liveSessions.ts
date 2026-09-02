import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

/**
 * A Live Session: one evening, one subject, no programme.
 *
 * These are not the classes inside a programme. A programme's module belongs to
 * a cohort, sits in a sequence, and counts towards a certificate. A Live
 * Session is a standalone masterclass or deep dive on something happening now,
 * open to anyone with an account, finished when it is finished.
 *
 * It is a separate table rather than a session with no programme on purpose.
 * `sessions.program_id` is not null and everything downstream of it — enrolment
 * checks, progress, locking, certificates, the cohort forum — assumes there is
 * a programme to look up. Making that optional would put a hole in each of
 * them. Nothing here touches any of that.
 */
export const liveSessionsTable = pgTable("live_sessions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  /** The one-line pitch, for the listing. */
  summary: text("summary").notNull().default(""),
  description: text("description").notNull().default(""),
  /** The subject area, shown as a label: "Gas", "Grid", "Finance". */
  topic: text("topic").notNull().default(""),

  startsAt: timestamp("starts_at", { withTimezone: true }),
  durationMins: integer("duration_mins").notNull().default(60),

  /** Who is giving it. A name, because most of these are guests. */
  speaker: text("speaker").notNull().default(""),
  speakerTitle: text("speaker_title").notNull().default(""),

  /**
   * The room, and the recording afterwards.
   *
   * Neither is ever put in a listing. Both are handed out one person at a time,
   * to somebody who registered, by the endpoint that checks that.
   */
  meetUrl: text("meet_url"),
  recordingUrl: text("recording_url"),

  /** draft | published | cancelled. Only published ones are listed. */
  status: text("status").notNull().default("draft"),
  /** Zero for no limit, which is the usual case. */
  capacity: integer("capacity").notNull().default(0),

  createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("live_sessions_status_starts_idx").on(t.status, t.startsAt),
]);

/**
 * Somebody who said they are coming.
 *
 * This is what registration buys on both sides: they get the joining link and
 * the recording afterwards, and the Lab gets a list of who to write to. One row
 * per person per session, enforced by the index rather than by hoping.
 */
export const liveSessionRegistrationsTable = pgTable("live_session_registrations", {
  id: serial("id").primaryKey(),
  liveSessionId: integer("live_session_id").notNull().references(() => liveSessionsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set the first time they open the room, so "registered" and "came" are different questions. */
  attendedAt: timestamp("attended_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("live_session_registrations_unique").on(t.liveSessionId, t.userId),
  index("live_session_registrations_user_idx").on(t.userId),
]);

export const insertLiveSessionSchema = createInsertSchema(liveSessionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLiveSession = z.infer<typeof insertLiveSessionSchema>;
export type LiveSession = typeof liveSessionsTable.$inferSelect;
export type LiveSessionRegistration = typeof liveSessionRegistrationsTable.$inferSelect;
