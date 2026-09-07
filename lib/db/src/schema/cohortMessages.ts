import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { programsTable } from "./programs";
import { usersTable } from "./users";

/**
 * What was said to a cohort, and when.
 *
 * Sending fifty emails is not undoable. Without a record an admin has no way to
 * answer the two questions that follow every send — did it go, and what did it
 * say — except by asking a learner to forward it back.
 *
 * The body is kept as the admin typed it rather than as rendered HTML. It is
 * what they would want to read again, it is what a second message would be
 * drafted from, and storing markup would mean storing the template as it was on
 * the day, which nobody wants.
 *
 * The programme is `set null` on delete rather than cascade: deleting a
 * programme should not quietly erase the record that its cohort was written to.
 */
export const cohortMessagesTable = pgTable("cohort_messages", {
  id: serial("id").primaryKey(),
  programId: integer("program_id").references(() => programsTable.id, { onDelete: "set null" }),
  /** Kept alongside the id, so the record still reads if the programme goes. */
  programTitle: text("programme_title").notNull().default(""),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  /** active | everyone — who it went to, in the words the console used. */
  audience: text("audience").notNull().default("active"),
  actionLabel: text("action_label").notNull().default(""),
  actionUrl: text("action_url").notNull().default(""),
  sentByUserId: integer("sent_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  /** How many it reached, and how many it did not. */
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CohortMessage = typeof cohortMessagesTable.$inferSelect;
