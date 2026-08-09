import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { sessionsTable } from "./sessions";

// One row per reminder email actually sent, so the scheduler never emails a
// learner twice for the same session/kind ("24h" or "1h").
export const sessionRemindersTable = pgTable(
  "session_reminders",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("reminder_user_session_kind_unique").on(t.userId, t.sessionId, t.kind)],
);

export type SessionReminder = typeof sessionRemindersTable.$inferSelect;
