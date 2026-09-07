import { Router, type IRouter } from "express";
import {
  db, cohortMessagesTable, enrollmentsTable, programsTable, usersTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  validateCohortMessage,
  statusesFor,
  messageParagraphs,
  labLetter,
  MAX_RECIPIENTS_AT_ONCE,
  type SendOutcome,
} from "@workspace/domain";
import { getCurrentUser, requireRole } from "../lib/auth";
import { emailConfigured, sendEmail } from "../lib/email";
import { labLogoUrl } from "../lib/enrollmentEmails";
import { logger } from "../lib/logger";

/**
 * Writing to a cohort.
 *
 * Everything else the Lab sends is automatic and triggered by an event. This is
 * the one place a person composes something and it goes out, which makes it the
 * one place where the damage from a mistake is unbounded: fifty emails cannot
 * be recalled, and the Lab's sending reputation is spent on them.
 *
 * So the shape is: say exactly who will receive it before anything is sent,
 * send one at a time, report on every person by name, and keep a record.
 *
 * The learner's own words are never in the HTML. The admin's body is escaped
 * and rendered as paragraphs by the shared letter, the same as every other
 * email the Lab sends — an admin cannot inject markup into fifty inboxes, and
 * cannot accidentally break the template with a stray angle bracket either.
 */

const router: IRouter = Router();

router.use("/admin", requireRole("admin"));

type Recipient = { id: number; email: string; name: string };

async function cohortFor(programId: number, audience: "active" | "everyone"): Promise<Recipient[]> {
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
    })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(enrollmentsTable.userId, usersTable.id))
    .where(and(
      eq(enrollmentsTable.programId, programId),
      inArray(enrollmentsTable.status, statusesFor(audience)),
      sql`${usersTable.email} <> ''`,
    ))
    .orderBy(usersTable.id);

  // One address, one email. A person enrolled twice through some earlier bug
  // should not receive the same notice twice and conclude the Lab is broken.
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.email.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Who would receive this, before anything is sent.
 *
 * The console asks for this as the audience is chosen, so the number on the
 * button is the real number rather than the count of enrolments.
 */
router.get("/admin/programmes/:id/recipients", async (req, res) => {
  const programId = Number(req.params.id);
  if (!Number.isInteger(programId)) { res.status(400).json({ error: "That is not a programme." }); return; }

  // Both audiences at once. The console lets an admin switch between them while
  // composing, and a second request per flick of a radio button would show a
  // stale number at exactly the moment the number matters.
  const [active, everyone] = await Promise.all([
    cohortFor(programId, "active"),
    cohortFor(programId, "everyone"),
  ]);

  const describe = (people: Recipient[]) => ({
    count: people.length,
    sample: people.slice(0, 12).map((p) => ({ name: p.name, email: p.email })),
  });

  res.json({ active: describe(active), everyone: describe(everyone) });
});

router.post("/admin/programmes/:id/messages", async (req, res) => {
  const programId = Number(req.params.id);
  if (!Number.isInteger(programId)) { res.status(400).json({ error: "That is not a programme." }); return; }

  if (!emailConfigured()) {
    res.status(503).json({ error: "No mail provider is configured on the server, so nothing can be sent." });
    return;
  }

  const [programme] = await db
    .select({ id: programsTable.id, title: programsTable.title })
    .from(programsTable)
    .where(eq(programsTable.id, programId));
  if (!programme) { res.status(404).json({ error: "That programme no longer exists." }); return; }

  const { message, problems } = validateCohortMessage((req.body ?? {}) as Record<string, string>);
  if (!message) { res.status(400).json({ error: problems.join(" ") }); return; }

  const people = await cohortFor(programId, message.audience);
  if (people.length === 0) {
    res.status(400).json({ error: "There is nobody on this programme to write to yet." });
    return;
  }
  if (people.length > MAX_RECIPIENTS_AT_ONCE) {
    res.status(400).json({
      error: `That is more than ${MAX_RECIPIENTS_AT_ONCE} people in one message. This is not a mailing list.`,
    });
    return;
  }

  const me = await getCurrentUser(req);
  const paragraphs = messageParagraphs(message.body);
  const action = message.actionLabel && message.actionUrl
    ? { label: message.actionLabel, url: message.actionUrl }
    : undefined;

  const outcomes: SendOutcome[] = [];

  // One after another, not all at once. Fifty simultaneous sends is the
  // quickest way to be rate-limited halfway through with nobody able to say who
  // received it — the same reasoning as inviting a cohort.
  for (const person of people) {
    const { html, text } = labLetter({
      greetingName: person.name,
      paragraphs,
      action,
      logoUrl: labLogoUrl(),
    });
    try {
      await sendEmail({
        to: { email: person.email, name: person.name || person.email },
        subject: message.subject,
        html,
        text,
      });
      outcomes.push({ email: person.email, name: person.name, status: "sent", detail: "Delivered to their inbox." });
    } catch (err) {
      // One person's bad address is theirs alone; the rest of the cohort still
      // hears from the Lab.
      logger.error({ err, to: person.email, programId }, "Cohort message failed for one person");
      outcomes.push({
        email: person.email,
        name: person.name,
        status: "failed",
        detail: "Their address was refused. Check it in the enrolment list.",
      });
    }
  }

  const sent = outcomes.filter((o) => o.status === "sent").length;
  const failed = outcomes.length - sent;

  // Recorded even when every send failed. "I sent that on Tuesday and nobody
  // got it" is exactly the thing worth being able to look up.
  const [saved] = await db
    .insert(cohortMessagesTable)
    .values({
      programId,
      programTitle: programme.title,
      subject: message.subject,
      body: message.body,
      audience: message.audience,
      actionLabel: message.actionLabel ?? "",
      actionUrl: message.actionUrl ?? "",
      sentByUserId: me?.id ?? null,
      sentCount: sent,
      failedCount: failed,
    })
    .returning();

  logger.info({ programId, sent, failed, by: me?.id }, "Cohort message sent");
  res.status(201).json({ id: saved?.id ?? 0, sent, failed, outcomes });
});

/** What has already been said to this cohort, most recent first. */
router.get("/admin/programmes/:id/messages", async (req, res) => {
  const programId = Number(req.params.id);
  if (!Number.isInteger(programId)) { res.status(400).json({ error: "That is not a programme." }); return; }

  const rows = await db
    .select({
      id: cohortMessagesTable.id,
      subject: cohortMessagesTable.subject,
      body: cohortMessagesTable.body,
      audience: cohortMessagesTable.audience,
      sentCount: cohortMessagesTable.sentCount,
      failedCount: cohortMessagesTable.failedCount,
      createdAt: cohortMessagesTable.createdAt,
      sentByName: usersTable.name,
    })
    .from(cohortMessagesTable)
    .leftJoin(usersTable, eq(usersTable.id, cohortMessagesTable.sentByUserId))
    .where(eq(cohortMessagesTable.programId, programId))
    .orderBy(desc(cohortMessagesTable.createdAt))
    .limit(50);

  res.json(rows.map((row) => ({
    ...row,
    sentByName: row.sentByName ?? "",
    createdAt: row.createdAt.toISOString(),
  })));
});

export default router;
