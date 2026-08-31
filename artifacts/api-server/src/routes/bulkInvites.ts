import express, { Router, type IRouter } from "express";
import {
  db,
  usersTable,
  programsTable,
  enrollmentsTable,
  pendingInvitationsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { generateCertificateCode, isPlausibleEmail, normaliseEmail } from "@workspace/domain";
import { getCurrentUser, requireRole } from "../lib/auth";
import { invitesConfigured, revokeInvitation, sendInvitation } from "../lib/clerkInvites";
import { readSheet } from "../lib/sheet";
import { logger } from "../lib/logger";

/**
 * Inviting a whole cohort at once.
 *
 * Fifty accepted applicants sitting in a spreadsheet, and every one of them a
 * real person expecting to hear from the Lab. That shapes every decision here.
 *
 * Each person is handled alone and reported on alone. A single bad address, or
 * one applicant who signed up last week, must never stop the other forty-nine.
 * The response says what happened to every row, so an admin can act on the
 * three that did not work instead of guessing which of fifty to try again.
 *
 * Re-running the same sheet is safe and expected — an admin will add five names
 * and send the lot again. Somebody already enrolled is reported as such and
 * left alone; nobody is invited twice or gets a second live link.
 *
 * Sending is sequential rather than parallel. Fifty at once would be faster and
 * would also be the fastest way to have Clerk rate-limit the batch halfway
 * through, leaving nobody able to say who was invited and who was not.
 */

const router: IRouter = Router();

/** The most rows one request will attempt, matching the roster reader. */
const MAX_ENTRIES = 500;

type Outcome = {
  row?: number;
  name?: string;
  email: string;
  status: "invited" | "enrolled" | "already-enrolled" | "reinvited" | "failed";
  detail: string;
};

router.post("/admin/invitations/bulk", requireRole("admin"), async (req, res) => {
  if (!invitesConfigured()) {
    res.status(503).json({ message: "Clerk is not configured on the server, so invitations cannot be sent." });
    return;
  }

  const body = (req.body ?? {}) as { programId?: unknown; entries?: unknown };
  const programId = Number(body.programId);
  if (!Number.isInteger(programId)) {
    res.status(400).json({ message: "Choose a programme to invite these learners onto." });
    return;
  }

  const [program] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (!program) {
    res.status(400).json({ message: "That programme no longer exists." });
    return;
  }

  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  if (rawEntries.length === 0) {
    res.status(400).json({ message: "There was nobody in that list." });
    return;
  }

  const me = await getCurrentUser(req);
  const outcomes: Outcome[] = [];
  const seen = new Set<string>();

  for (const raw of rawEntries.slice(0, MAX_ENTRIES)) {
    const entry = (raw ?? {}) as { row?: unknown; name?: unknown; email?: unknown };
    const row = Number.isInteger(entry.row) ? (entry.row as number) : undefined;
    const name = typeof entry.name === "string" ? entry.name.trim().slice(0, 120) : "";
    const email = normaliseEmail(typeof entry.email === "string" ? entry.email : "");

    const record = (status: Outcome["status"], detail: string) =>
      outcomes.push({ row, name, email, status, detail });

    if (!email || !isPlausibleEmail(email)) {
      record("failed", "That does not look like an email address.");
      continue;
    }
    if (seen.has(email)) {
      record("already-enrolled", "This address appeared earlier in the list.");
      continue;
    }
    seen.add(email);

    try {
      // Somebody already here needs enrolling, not inviting. Compared without
      // case because the users table holds whatever Clerk gave it.
      const [existing] = await db
        .select()
        .from(usersTable)
        .where(and(sql`lower(${usersTable.email}) = ${email}`, sql`${usersTable.email} <> ''`));

      if (existing) {
        const [enrolled] = await db
          .insert(enrollmentsTable)
          .values({
            userId: existing.id,
            programId,
            status: "enrolled",
            certificateCode: generateCertificateCode(),
          })
          .onConflictDoNothing({ target: [enrollmentsTable.userId, enrollmentsTable.programId] })
          .returning();

        if (enrolled) record("enrolled", "Already had an account, so enrolled directly.");
        else record("already-enrolled", "Already enrolled on this programme.");
        continue;
      }

      const [prior] = await db
        .select()
        .from(pendingInvitationsTable)
        .where(eq(pendingInvitationsTable.email, email));

      // An accepted invitation is a record of what happened, not something to
      // overwrite. If they accepted but are not in users, something else is
      // wrong and quietly re-inviting would hide it.
      if (prior?.acceptedAt) {
        record("failed", "They have already accepted an invitation. Check the People list.");
        continue;
      }

      // Withdraw any live link before issuing another, or the first stays valid
      // forever with nothing recording it.
      let replacing = false;
      if (prior?.clerkInvitationId) {
        const revoked = await revokeInvitation(prior.clerkInvitationId);
        if (revoked === "failed") {
          record("failed", "Could not withdraw their previous invitation, so a new one was not sent.");
          continue;
        }
        if (revoked === "already-accepted") {
          record("failed", "They have already used an earlier invitation. Check the People list.");
          continue;
        }
        replacing = true;
      }

      const sent = await sendInvitation({ email, role: "learner" });
      if (!sent.ok) {
        record("failed", sent.error);
        continue;
      }

      const values = {
        email,
        role: "learner",
        sessionIds: [],
        programId,
        clerkInvitationId: sent.invitation.id,
        invitedByUserId: me?.id ?? null,
        createdAt: new Date(),
        acceptedAt: null,
        acceptedByUserId: null,
      };

      try {
        await db
          .insert(pendingInvitationsTable)
          .values(values)
          .onConflictDoUpdate({ target: pendingInvitationsTable.email, set: values });
      } catch (err) {
        // The link is already in the post. Take it back rather than leaving a
        // live invitation with nothing recording it.
        await revokeInvitation(sent.invitation.id);
        logger.error({ err, email }, "Could not record a bulk invitation; withdrew it again");
        record("failed", "Could not record that invitation, so it was withdrawn. Try again.");
        continue;
      }

      record(replacing ? "reinvited" : "invited", replacing
        ? "Previous invitation withdrawn and a new one sent."
        : "Invitation sent.");
    } catch (err) {
      // One person's failure is theirs alone; the rest of the sheet continues.
      logger.error({ err, email }, "Bulk invitation failed for one person");
      record("failed", "Something went wrong for this person. Try them again.");
    }
  }

  const count = (s: Outcome["status"]) => outcomes.filter((o) => o.status === s).length;
  const result = {
    outcomes,
    invited: count("invited") + count("reinvited"),
    enrolled: count("enrolled"),
    alreadyEnrolled: count("already-enrolled"),
    failed: count("failed"),
  };

  logger.info({ programId, ...result, outcomes: undefined }, "Bulk learner invitation run");
  res.json(result);
});

/** A spreadsheet is at most a few hundred rows of two short columns. */
const MAX_SHEET_BYTES = 2 * 1024 * 1024;

/**
 * Turn an uploaded .xlsx or .csv into the same tab-separated text a paste
 * produces, and hand it straight back.
 *
 * Nothing is stored and nobody is invited here. The admin sees the rows in the
 * same preview the paste box fills, decides they are right, and only then
 * sends. Reading a file and acting on it are two steps on purpose.
 */
router.post(
  "/admin/roster-file",
  requireRole("admin"),
  express.raw({ type: "*/*", limit: MAX_SHEET_BYTES }),
  async (req, res) => {
    const body = req.body;
    const bytes = Buffer.isBuffer(body) ? new Uint8Array(body) : new Uint8Array();

    const sheet = readSheet(bytes);
    if (!sheet.ok) {
      res.status(400).json({ message: sheet.problem });
      return;
    }

    // Tab-separated, because that is exactly what a spreadsheet puts on the
    // clipboard — so the uploaded rows go through the identical reading rules.
    const text = sheet.rows
      .map((cells) => cells.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t"))
      .join("\n");

    logger.info({ rows: sheet.rows.length, sheetName: sheet.sheetName }, "Roster file read");
    res.json({ text, sheetName: sheet.sheetName });
  },
);

export default router;
