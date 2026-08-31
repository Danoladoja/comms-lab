import { Router, type IRouter } from "express";
import { db, waitlistTable, programsTable, usersTable, enrollmentsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  isWaitlistStatus,
  showsInCatalogue,
  validateWaitlistSignup,
  waitlistConfirmation,
} from "@workspace/domain";
import { getCurrentUser, requireRole } from "../lib/auth";
import { emailConfigured, sendEmail } from "../lib/email";
import { createBudget } from "../lib/rateBudget";
import { logger } from "../lib/logger";

/**
 * The waitlist.
 *
 * The public way into the Lab now that sign-up is closed. Anybody on the
 * internet can write here, which makes it one of two endpoints that need
 * guarding on their own — the other is the partnerships form, and this borrows
 * its shape: a hidden field, a small per-address budget, and validation that
 * refuses only what is genuinely unusable.
 *
 * Unlike a partnership enquiry, a waitlist entry is stored. That is the point:
 * the list is a queue an admin works through, and losing somebody from it means
 * a person who asked to be taught and never heard back. So the entry is saved
 * first and the confirmation email is attempted second — a mail provider having
 * a bad afternoon must not cost somebody their place.
 */

const router: IRouter = Router();

/** Modest, in-memory, and not a security boundary — see lib/rateBudget. */
export const waitlistBudget = createBudget({ windowMs: 60 * 60 * 1000, max: 5 });

/* ---------- Joining ---------- */

router.post("/waitlist", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const result = validateWaitlistSignup({
    name: body.name,
    email: body.email,
    programme: body.programme,
    note: body.note,
    trap: body.trap,
  });

  if (!result.ok) {
    res.status(400).json({ message: result.problem });
    return;
  }

  // After validation, so a mistyped address gets its explanation back rather
  // than being spent against the budget.
  if (waitlistBudget.overBudget(req.ip ?? "unknown")) {
    logger.warn({ ip: req.ip }, "Waitlist signups over budget for this address");
    res.status(429).json({
      message: "That is several attempts in a short time. Please try again later, or email us directly.",
    });
    return;
  }

  const { name, email, programId, note } = result.signup;

  // A programme has to exist and be one the public can actually see, or the
  // picker becomes a way of learning what is in the drafts folder.
  let programme: { id: number; title: string } | null = null;
  if (programId !== null) {
    const [row] = await db
      .select({ id: programsTable.id, title: programsTable.title, status: programsTable.status })
      .from(programsTable)
      .where(eq(programsTable.id, programId));
    // Silently treated as "any future cohort" rather than refused: the person
    // has done nothing wrong, and losing them over a stale page would be worse.
    programme = row && showsInCatalogue(row.status) ? { id: row.id, title: row.title } : null;
  }

  const values = {
    name,
    email,
    programId: programme?.id ?? null,
    note,
    status: "waiting" as const,
  };

  try {
    await db
      .insert(waitlistTable)
      .values(values)
      // Signing up again updates the entry instead of making an admin work
      // through the same person twice. Their status is deliberately reset to
      // waiting: somebody asking a second time is asking again.
      .onConflictDoUpdate({ target: waitlistTable.email, set: { ...values, updatedAt: new Date() } });
  } catch (err) {
    logger.error({ err, email }, "Could not record a waitlist signup");
    res.status(503).json({
      message: "We could not add you to the list just now. Please try again shortly, or email us.",
    });
    return;
  }

  // Saved is what matters; the email is a courtesy. A failure here is logged
  // and never shown, because the person is on the list either way.
  if (emailConfigured()) {
    try {
      await sendEmail({
        to: { email, name },
        subject: programme ? `You are on the waitlist for ${programme.title}` : "You are on the Ananse Comms Lab waitlist",
        html:
          `<p>Hello ${escapeText(name)},</p>` +
          `<p>${escapeText(waitlistConfirmation(programme?.title ?? null))}</p>` +
          `<p>We invite people from this list as places open. Nothing is needed from you in the meantime.</p>` +
          `<p>— Ananse Comms Lab</p>`,
      });
    } catch (err) {
      logger.warn({ err, email }, "Waitlist entry saved but the confirmation email did not send");
    }
  }

  logger.info({ email, programId: programme?.id ?? null }, "Waitlist signup");
  res.status(201).json({ message: waitlistConfirmation(programme?.title ?? null) });
});

/** Minimal escaping for the one place this route builds HTML. */
function escapeText(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------- Working through the list ---------- */

router.get("/admin/waitlist", requireRole("admin"), async (_req, res) => {
  const rows = await db
    .select({
      id: waitlistTable.id,
      name: waitlistTable.name,
      email: waitlistTable.email,
      programId: waitlistTable.programId,
      programTitle: programsTable.title,
      note: waitlistTable.note,
      status: waitlistTable.status,
      createdAt: waitlistTable.createdAt,
    })
    .from(waitlistTable)
    .leftJoin(programsTable, eq(waitlistTable.programId, programsTable.id))
    .orderBy(desc(waitlistTable.createdAt));

  res.json(rows);
});

router.patch("/admin/waitlist/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const status = (req.body ?? {}).status;
  if (!Number.isInteger(id) || !isWaitlistStatus(status)) {
    res.status(400).json({ message: "That is not a state a waitlist entry can be in." });
    return;
  }

  const me = await getCurrentUser(req);
  const [updated] = await db
    .update(waitlistTable)
    .set({ status, handledByUserId: me?.id ?? null, handledAt: new Date() })
    .where(eq(waitlistTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ message: "That entry is no longer on the list." });
    return;
  }
  res.json({ id: updated.id, status: updated.status });
});

/**
 * Accounts attached to no programme.
 *
 * The mess this whole change exists to clear up. Everyone who signed up while
 * the door was open, is not staff, and is on nothing — listed so an admin can
 * deal with each one by hand. Nothing here changes anybody: deciding what
 * happens to a real person is not a job for a migration script.
 */
router.get("/admin/unattached-users", requireRole("admin"), async (_req, res) => {
  const enrolledCount = sql<number>`(
    select count(*)::int from ${enrollmentsTable}
    where ${enrollmentsTable.userId} = ${usersTable.id}
      and ${enrollmentsTable.status} <> 'cancelled'
  )`;

  const rows = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(and(eq(usersTable.role, "learner"), sql`${enrolledCount} = 0`))
    .orderBy(desc(usersTable.createdAt));

  res.json(rows);
});

export default router;
