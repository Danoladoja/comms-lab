import { pgTable, text, serial, integer, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/**
 * Material a facilitator types or pastes in, alongside the slide deck.
 *
 * Most often a transcript copied out of the class recording, which is where the
 * teaching actually is — a deck is headings and a chart, but the explanation of
 * why the tariff reform stalled only exists in what someone said aloud.
 *
 * Kept separate from `session_slides` rather than added as a column, because a
 * facilitator who never made a deck must still be able to paste a transcript,
 * and the slides row cannot exist without a file.
 */
export const sessionNotesTable = pgTable(
  "session_notes",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    /** What this is: "Transcript", "Speaker notes", and so on. Shown in the record of where a draft came from. */
    label: text("label").notNull().default("Transcript"),
    body: text("body").notNull().default(""),
    updatedByUserId: integer("updated_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("session_notes_session_unique").on(t.sessionId)],
);

/**
 * A record of every drafting run: what it read, how much of it, which model, who
 * clicked, and what came back.
 *
 * Kept because in six months someone will ask why a particular question is on a
 * quiz, and the honest answer needs to distinguish "the model wrote it from a
 * transcript of the class and Amina approved it" from "the model wrote it from a
 * deck of section headings and nobody looked".
 *
 * The payload is the draft as it was returned, before the facilitator touched
 * anything — so a draft that was closed by accident can be recovered, and so a
 * bad question can be traced to the material that produced it.
 */
export const courseworkDraftsTable = pgTable(
  "coursework_drafts",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    createdByUserId: integer("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    /** "draft" for a full run, "replace" for one question redone, "expand" for more questions. */
    kind: text("kind").notNull().default("draft"),
    model: text("model").notNull(),
    /** Which material was read: some of "slides", "notes". */
    sourceKinds: jsonb("source_kinds").$type<string[]>().notNull().default([]),
    sourceLabel: text("source_label").notNull().default(""),
    sourceChars: integer("source_chars").notNull().default(0),
    questionCount: integer("question_count").notNull().default(0),
    payload: jsonb("payload").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("coursework_drafts_session_idx").on(t.sessionId, t.createdAt)],
);

export type SessionNotes = typeof sessionNotesTable.$inferSelect;
export type CourseworkDraftRun = typeof courseworkDraftsTable.$inferSelect;
