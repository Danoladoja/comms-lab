import { pgTable, text, serial, integer, timestamp, customType, uniqueIndex } from "drizzle-orm/pg-core";
import { programsTable } from "./programs";
import { usersTable } from "./users";

/** Postgres bytea, for the image itself. */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * The picture shown on a programme's card in the catalogue.
 *
 * In the database rather than on disk for the same reason as the slide decks:
 * the app runs on hosting with an ephemeral filesystem, so an image written to
 * disk disappears at the next restart and the catalogue quietly fills with
 * broken pictures.
 *
 * In its own table rather than a column on `programs` for a different reason.
 * The catalogue lists every programme at once, and a query that selects all
 * columns would drag several megabytes of image bytes across the wire to
 * render a page that only needs titles. Keeping the bytes here means the
 * listing stays cheap and the image is fetched only by the browser that is
 * actually about to draw it.
 *
 * `mimeType` is what the file's own leading bytes said it was, never what the
 * uploader claimed — see checkThumbnail in @workspace/domain. It is what the
 * image is served back with, so getting it from the file rather than the
 * uploader is what stops somebody serving a script from our own origin.
 */
export const programThumbnailsTable = pgTable(
  "program_thumbnails",
  {
    id: serial("id").primaryKey(),
    programId: integer("program_id").notNull().references(() => programsTable.id, { onDelete: "cascade" }),
    uploadedByUserId: integer("uploaded_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  // One image per programme: uploading again replaces it, so there is never a
  // question about which picture the catalogue is showing.
  (t) => [uniqueIndex("program_thumbnails_program_unique").on(t.programId)],
);

export type ProgramThumbnail = typeof programThumbnailsTable.$inferSelect;
