import { clerkClient } from "@clerk/express";
import type { Role } from "@workspace/domain";
import { logger } from "./logger";

/**
 * Talking to Clerk about invitations.
 *
 * Kept in one file so the rest of the server never has to think about Clerk's
 * shapes, and so the one security-critical decision — what goes into public
 * metadata — is in a single place someone can read in full.
 *
 * The role is written to `publicMetadata`, which only a backend can set. It
 * arrives on the person's account when they accept, and is read back on their
 * first request. It deliberately does not go in `unsafeMetadata`, which the
 * account holder can edit from their own browser.
 */

export type SentInvitation = {
  id: string;
  email: string;
  url: string | null;
};

/** Where a facilitator lands after clicking the link in their email. */
function acceptUrl(): string | undefined {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}/sign-up` : undefined;
}

export function invitesConfigured(): boolean {
  return !!process.env.CLERK_SECRET_KEY;
}

export async function sendInvitation(args: {
  email: string;
  role: Role;
}): Promise<{ ok: true; invitation: SentInvitation } | { ok: false; error: string }> {
  try {
    const invitation = await clerkClient.invitations.createInvitation({
      emailAddress: args.email,
      // Backend-only metadata. This is what makes the person a facilitator the
      // moment they arrive, with no promotion step and no window in which they
      // are looking at a learner's dashboard wondering where their class is.
      publicMetadata: { role: args.role },
      redirectUrl: acceptUrl(),
      // Re-inviting someone who ignored the first email should just work.
      ignoreExisting: true,
    });

    return {
      ok: true,
      invitation: {
        id: invitation.id,
        email: args.email,
        url: (invitation as { url?: string }).url ?? null,
      },
    };
  } catch (err) {
    const message = clerkMessage(err);
    logger.error({ err, email: args.email }, "Could not send an invitation");
    return { ok: false, error: message };
  }
}

/**
 * Why a revoke did not happen, when it did not.
 *
 * The distinction matters. "Already accepted" means the link has been spent and
 * the person now carries the role on their account — withdrawing the local row
 * would hide that from the admin while leaving the grant live. "Failed" means
 * Clerk was unreachable and the link is still out there. Neither may be treated
 * as success.
 */
export type RevokeResult = "revoked" | "already-accepted" | "failed";

export async function revokeInvitation(clerkInvitationId: string): Promise<RevokeResult> {
  if (!clerkInvitationId) return "revoked";
  try {
    await clerkClient.invitations.revokeInvitation(clerkInvitationId);
    return "revoked";
  } catch (err) {
    const errors = (err as { errors?: { code?: string; message?: string }[] })?.errors;
    const code = errors?.[0]?.code ?? "";
    const text = `${code} ${errors?.[0]?.message ?? ""}`.toLowerCase();

    // Already revoked is the outcome the admin wanted, so it counts as done.
    if (text.includes("revoked")) return "revoked";
    if (text.includes("accepted")) {
      logger.warn({ clerkInvitationId }, "Invitation was already accepted; cannot revoke");
      return "already-accepted";
    }
    logger.error({ err, clerkInvitationId }, "Could not revoke an invitation at Clerk");
    return "failed";
  }
}

/**
 * Turn a Clerk error into something an admin can act on.
 *
 * The common one by far is inviting somebody who already has an account, which
 * is not really an error — it just means the admin wanted the People list.
 */
function clerkMessage(err: unknown): string {
  const errors = (err as { errors?: { code?: string; message?: string; longMessage?: string }[] })?.errors;
  const first = errors?.[0];
  const code = first?.code ?? "";

  if (code === "duplicate_record" || code === "identifier_already_signed_up") {
    return "That person already has an account. Change their role in the list below instead.";
  }
  if (code === "form_param_format_invalid") {
    return "Clerk would not accept that email address.";
  }
  if (code === "authentication_invalid" || code === "unauthorized") {
    return "Clerk rejected the server's key. Check CLERK_SECRET_KEY.";
  }
  return first?.longMessage ?? first?.message ?? "Clerk would not send that invitation. Try again shortly.";
}
