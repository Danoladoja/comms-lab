import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Roles: learner (default) | instructor | admin
// Bootstrap rule: the first user ever provisioned becomes admin.
export const usersTable = pgTable(
  "users",
  {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull().default(""),
  name: text("name").notNull().default(""),
  role: text("role").notNull().default("learner"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  // Accounts are looked up by address case-insensitively — once per row of a
  // roster upload, which is capped at five hundred. Without a matching
  // functional index each of those was a full scan of the users table.
  (t) => [index("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
