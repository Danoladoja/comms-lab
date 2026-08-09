import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Status: draft | published | archived
export const programsTable = pgTable("programs", {
  id: serial("id").primaryKey(),
  tag: text("tag").notNull(),               // focus area label
  title: text("title").notNull(),
  description: text("description").notNull(),
  startDate: text("start_date").notNull(),  // display string, e.g. "Nov 2026"
  format: text("format").notNull(),         // Cohort | Masterclass | Intensive
  duration: text("duration").notNull(),     // e.g. "4 weeks"
  thumbnailUrl: text("thumbnail_url"),
  capacity: integer("capacity").notNull().default(30),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProgramSchema = createInsertSchema(programsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProgram = z.infer<typeof insertProgramSchema>;
export type Program = typeof programsTable.$inferSelect;
