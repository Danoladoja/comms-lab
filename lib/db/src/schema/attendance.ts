import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { sessionsTable } from "./sessions";

/**
 * Time in the live room.
 *
 * `joinedAt` is the first time the learner opened the room. `liveSeconds` is
 * how long the classroom page stayed open during the scheduled window,
 * accumulated from heartbeats — the live class runs in Google Meet, outside
 * this application, so this is a proxy for presence rather than a measurement
 * of it. It is stored as raw seconds rather than a verdict, so a stricter
 * source (Meet attendance reports, or an in-platform video provider) can
 * replace the input without changing any rule that reads it.
 *
 * `lastHeartbeatAt` is the anchor the next beat measures its gap from.
 */
export const attendanceTable = pgTable(
  "session_attendance",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    liveSeconds: integer("live_seconds").notNull().default(0),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),

    /**
     * Attendance credited without being measured, and the reason why.
     *
     * A separate field rather than a pile of invented seconds, because the
     * record should say "this could not be measured" instead of claiming a
     * number nobody observed. Two things need it. The weeks when the heartbeat
     * never started, where learners sat through whole classes the app then told
     * them to repeat — their failure was ours. And any later case where a
     * facilitator knows something the app cannot see.
     */
    presenceWaivedAt: timestamp("presence_waived_at", { withTimezone: true }),
    presenceWaivedReason: text("presence_waived_reason").notNull().default(""),
  },
  (t) => [uniqueIndex("attendance_user_session_unique").on(t.userId, t.sessionId)],
);

/**
 * Time watching the recording.
 *
 * `buckets` holds the distinct fifteen-second slices of the recording the
 * learner has actually played. Storing coverage rather than a running total is
 * what makes scrubbing to the end worthless and re-watching the opening minute
 * free: both leave the set unchanged.
 *
 * `durationSeconds` is the recording's true length as reported by the player,
 * and is the denominator for "watched the full replay" — a recording is rarely
 * exactly as long as the class was scheduled to be.
 */
export const replayProgressTable = pgTable(
  "replay_progress",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    buckets: jsonb("buckets").$type<number[]>().notNull().default([]),
    durationSeconds: integer("duration_seconds"),
    firstWatchedAt: timestamp("first_watched_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("replay_progress_user_session_unique").on(t.userId, t.sessionId)],
);

export type Attendance = typeof attendanceTable.$inferSelect;
export type ReplayProgress = typeof replayProgressTable.$inferSelect;
