import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { programsTable } from "./programs";
import { usersTable } from "./users";

/**
 * People waiting for a place.
 *
 * The public way into the Lab. Anybody can add themselves here; nobody gets an
 * account until an admin invites them, which is the whole point — an account
 * attached to no programme was how strangers ended up in the People list.
 *
 * The address is unique, so somebody who signs up twice updates their entry
 * rather than appearing twice on a list an admin has to work through by hand.
 * A programme is optional: "any future cohort" is a real and common answer.
 */
export const waitlistTable = pgTable(
  "waitlist_entries",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    /** Null means they will take whatever runs next. */
    programId: integer("program_id").references(() => programsTable.id, { onDelete: "set null" }),
    note: text("note").notNull().default(""),
    /** waiting | invited | declined */
    status: text("status").notNull().default("waiting"),
    /** Who dealt with them, so a shared inbox does not repeat itself. */
    handledByUserId: integer("handled_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [uniqueIndex("waitlist_email_idx").on(table.email)],
);

export const insertWaitlistSchema = createInsertSchema(waitlistTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWaitlistEntry = z.infer<typeof insertWaitlistSchema>;
export type WaitlistEntry = typeof waitlistTable.$inferSelect;
