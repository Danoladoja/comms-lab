import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { programsTable } from "./programs";
import { usersTable } from "./users";

// Cohort forum: one board per program, visible to enrolled learners and staff.
export const forumThreadsTable = pgTable(
  "forum_threads",
  {
  id: serial("id").primaryKey(),
  programId: integer("program_id").notNull().references(() => programsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  // Every board view filters threads by programme and then counts their posts.
  (t) => [index("forum_threads_program_idx").on(t.programId, t.createdAt)],
);

export const forumPostsTable = pgTable(
  "forum_posts",
  {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => forumThreadsTable.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Opening one thread reads its posts; opening the board counts them all.
  // Neither had an index, so both scanned the whole table.
  (t) => [index("forum_posts_thread_idx").on(t.threadId, t.createdAt)],
);

export type ForumThread = typeof forumThreadsTable.$inferSelect;
export type ForumPost = typeof forumPostsTable.$inferSelect;
