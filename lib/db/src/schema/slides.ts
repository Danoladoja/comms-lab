import { pgTable, text, serial, integer, boolean, timestamp, customType, uniqueIndex } from "drizzle-orm/pg-core";
import { sessionsTable } from "./sessions";
import { usersTable } from "./users";

/** Postgres bytea, for the deck itself. */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * The facilitator's slide deck for one module.
 *
 * Kept in the database rather than on disk because the app runs on hosting with
 * an ephemeral filesystem — a deck written to disk would vanish on the next
 * restart, taking the learner's revision material with it. A cohort's worth of
 * decks is a few tens of megabytes, which Postgres handles without complaint.
 *
 * `extractedText` is the readable content pulled out at upload time. It is what
 * the coursework drafter reads, and extracting once means a facilitator can
 * regenerate a draft as often as they like without re-parsing the file.
 */
export const sessionSlidesTable = pgTable(
  "session_slides",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull().references(() => sessionsTable.id, { onDelete: "cascade" }),
    uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    /** Empty when the format carried no readable text — an image-only deck, say. */
    extractedText: text("extracted_text").notNull().default(""),
    /** Learners can read the deck alongside the recording. */
    visibleToLearners: boolean("visible_to_learners").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  // One deck per module: a second upload replaces the first, so there is never
  // any question which deck a draft was generated from.
  (t) => [uniqueIndex("session_slides_session_unique").on(t.sessionId)],
);

export type SessionSlides = typeof sessionSlidesTable.$inferSelect;
