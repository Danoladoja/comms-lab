import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * The Google account the platform borrows to move recordings.
 *
 * One row, ever — `singleton` is always the string "primary" and carries a
 * unique index, so a second connection replaces the first rather than quietly
 * competing with it.
 *
 * The refresh token is encrypted before it is stored (see
 * `artifacts/api-server/src/lib/google/secrets.ts`). It is a long-lived key to
 * someone's Drive and YouTube channel, and it never leaves the server: no route
 * returns it, and the admin screen only ever sees the connected email address.
 */
export const googleConnectionTable = pgTable(
  "google_connection",
  {
    id: serial("id").primaryKey(),
    singleton: text("singleton").notNull().default("primary"),
    /** Which admin authorised it, so the team knows whose account is in use. */
    connectedByUserId: integer("connected_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    googleEmail: text("google_email").notNull(),
    /** AES-256-GCM, keyed from GOOGLE_TOKEN_SECRET. Never sent to any client. */
    refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
    scopes: text("scopes").notNull().default(""),
    /** Set when Google rejects the token, so the admin screen can say so. */
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("google_connection_singleton_unique").on(t.singleton)],
);

export type GoogleConnection = typeof googleConnectionTable.$inferSelect;
