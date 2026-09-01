import type { Role } from "@workspace/domain";
import { invitationLetter } from "@workspace/domain";
import { emailConfigured, sendEmail } from "./email";
import { invitesConfigured, revokeInvitation, sendInvitation } from "./clerkInvites";
import { logger } from "./logger";

/**
 * Getting an invitation into somebody's inbox.
 *
 * One place, because the two callers — inviting a whole cohort, and inviting a
 * single facilitator or admin — must behave identically. An invitation that
 * works differently depending on which button an admin pressed is a bug waiting
 * for a cohort to find.
 *
 * The shape of it: Clerk mints the link, because only Clerk can. We send the
 * letter around it, from our own domain, in the Lab's words. Clerk's own email
 * stays as the fallback for a deployment with no mail provider configured —
 * an invitation from an unfamiliar sender still beats none at all.
 *
 * The rule that governs the failure paths: **never report an invitation as
 * sent when nothing left the building.** If we cannot deliver the letter, the
 * link is withdrawn before we answer, so the address is clean for a retry and
 * no live invitation is left in the wild with nothing recording it.
 */

export type InvitationDelivery =
  | { ok: true; invitationId: string; sentBy: "us" | "clerk" }
  | { ok: false; error: string };

export async function deliverInvitation(args: {
  email: string;
  /** What Clerk's metadata carries. Never `admin`; see routes/admin.ts. */
  role: Role;
  /**
   * What the letter says they are being invited as, when that differs.
   *
   * An invited admin is carried to Clerk as a facilitator on purpose — link
   * metadata must not be able to grant admin — but they should still be told
   * plainly what they are being invited to do.
   */
  describeAs?: Role;
  name?: string | null;
  programmeTitle?: string | null;
  programmeStart?: string | null;
}): Promise<InvitationDelivery> {
  if (!invitesConfigured()) {
    return { ok: false, error: "Clerk is not configured on the server, so invitations cannot be sent." };
  }

  // Without a mail provider we have no letter to send, so Clerk sends its own.
  const weSend = emailConfigured();

  const created = await sendInvitation({ email: args.email, role: args.role, notify: !weSend });
  if (!created.ok) return { ok: false, error: created.error };

  if (!weSend) {
    logger.warn(
      { email: args.email },
      "BREVO_API_KEY is not set, so Clerk sent the invitation from its own domain",
    );
    return { ok: true, invitationId: created.invitation.id, sentBy: "clerk" };
  }

  // Clerk returns the link only when it is not sending the email itself. If it
  // is missing we have an invitation nobody can reach, which is worse than no
  // invitation: withdraw it and say so plainly.
  const url = created.invitation.url;
  if (!url) {
    await revokeInvitation(created.invitation.id);
    logger.error({ email: args.email }, "Clerk returned no invitation link; the invitation was withdrawn");
    return { ok: false, error: "The invitation link could not be created. Try again." };
  }

  const letter = invitationLetter({
    role: args.describeAs ?? args.role,
    name: args.name,
    programmeTitle: args.programmeTitle,
    programmeStart: args.programmeStart,
    url,
  });

  try {
    await sendEmail({
      to: { email: args.email, name: (args.name ?? "").trim() || args.email },
      subject: letter.subject,
      html: letter.html,
      text: letter.text,
    });
  } catch (err) {
    // The link exists but nobody has it. Take it back so the next attempt is a
    // clean one rather than a second live ticket to the same inbox.
    await revokeInvitation(created.invitation.id);
    logger.error({ err, email: args.email }, "Could not send an invitation email; the invitation was withdrawn");
    return { ok: false, error: "The invitation email could not be sent, so it was withdrawn. Try again." };
  }

  logger.info({ email: args.email, role: args.role }, "Invitation delivered");
  return { ok: true, invitationId: created.invitation.id, sentBy: "us" };
}
