import { pgTable, text, serial, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * A facilitator who has been invited but has not arrived yet.
 *
 * Clerk holds the invitation itself and sends the email. This table holds the
 * part Clerk has nowhere to put: which classes the person should be given once
 * they accept. It is keyed by email because at the moment of inviting there is
 * no user to key it to — that is the whole point of an invitation.
 *
 * The role rides on the Clerk invitation rather than here, because only a
 * backend can write Clerk's public metadata, which makes it tamper-proof in a
 * way a row matched on an email address is not.
 */
export const pendingInvitationsTable = pgTable(
  "pending_invitations",
  {
    id: serial("id").primaryKey(),
    /** Stored lowercased and trimmed, so matching on arrival is exact. */
    email: text("email").notNull(),
    role: text("role").notNull().default("instructor"),
    /** Classes to hand over on arrival, if nobody else is teaching them by then. */
    sessionIds: jsonb("session_ids").$type<number[]>().notNull().default([]),
    /** Clerk's id for the invitation, so it can be revoked there too. */
    clerkInvitationId: text("clerk_invitation_id").notNull().default(""),
    invitedByUserId: integer("invited_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when the person arrived. The row is kept as a record of what happened. */
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedByUserId: integer("accepted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
  },
  // One live invitation per address: re-inviting replaces rather than stacks,
  // so a facilitator invited twice does not get two sets of classes.
  (t) => [uniqueIndex("pending_invitations_email_unique").on(t.email)],
);

export type PendingInvitation = typeof pendingInvitationsTable.$inferSelect;
