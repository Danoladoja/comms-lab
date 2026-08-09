import { pgTable, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { sessionsTable } from "./sessions";

// First time a learner joins a live session. Progress and replay rights are
// computed from joinedAt relative to the session's start and duration.
export const attendanceTable = pgTable(
  "session_attendance",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("attendance_user_session_unique").on(t.userId, t.sessionId)],
);

export type Attendance = typeof attendanceTable.$inferSelect;
