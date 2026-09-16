import { pgTable, text, serial, integer, timestamp, unique, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { programsTable } from "./programs";
import { usersTable } from "./users";

// Status: enrolled | waitlisted | cancelled | completed
export const enrollmentsTable = pgTable(
  "enrollments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    programId: integer("program_id").notNull().references(() => programsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("enrolled"),
    /**
     * Random, opaque certificate code (AECL-XXXX-XXXX-XXXX), issued at
     * enrollment. The old scheme derived the code from programId + userId, so
     * anyone could walk it upward and harvest every graduate's name — and read
     * off the cohort sizes on the way. Verification now looks this column up
     * instead of parsing ids back out of the string.
     */
    certificateCode: text("certificate_code").notNull().unique(),
    /** Opt-in: show the learner's actual work on the public verification page. */
    portfolioPublic: boolean("portfolio_public").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When this learner actually joined the programme, as opposed to when the
     * row was first written.
     *
     * The two differ for anybody promoted off the waitlist: their row was
     * created when they signed up, sometimes weeks earlier. Progress used
     * `createdAt`, so a learner let in during week four was measured as though
     * they had been there since week one — and locked behind a class they were
     * never allowed to attend, with no recording guaranteed and a closed
     * deadline. Empty on every row written before this existed, which then
     * falls back to `createdAt` and behaves exactly as before.
     */
    startedAt: timestamp("started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [unique("enrollments_user_program_unique").on(t.userId, t.programId)],
);

export const insertEnrollmentSchema = createInsertSchema(enrollmentsTable).omit({
  id: true,
  certificateCode: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEnrollment = z.infer<typeof insertEnrollmentSchema>;
export type Enrollment = typeof enrollmentsTable.$inferSelect;
