import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";

/**
 * Further reading for a module.
 *
 * Ungraded on purpose: nothing here is read by `computeProgress`, and adding a
 * link never changes whether a learner can finish. It is a shelf the
 * facilitator points at, not another hurdle.
 *
 * Stored as rows rather than a JSON blob on the session so the order can be
 * changed and individual links edited without rewriting the set.
 */
export const sessionReadingsTable = pgTable(
  "session_readings",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    /** One line on why it is worth reading. Often empty. */
    note: text("note").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_readings_session_idx").on(t.sessionId, t.sortOrder)],
);

export type SessionReading = typeof sessionReadingsTable.$inferSelect;
