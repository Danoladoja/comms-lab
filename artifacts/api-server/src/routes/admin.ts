import { Router, type IRouter } from "express";
import {
  db, enrollmentsTable, programsTable, usersTable, pendingInvitationsTable, sessionsTable,
  assignmentsTable, deadlineExtensionsTable,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import {
  UpdateUserRoleBody, UpdateEnrollmentBody, InviteFacilitatorBody, EnrolExistingAccountBody,
  GrantDeadlineExtensionBody, RevokeDeadlineExtensionBody,
} from "@workspace/api-zod";
import {
  checkRoleChange, validateInvite, describeInvite, mayResendInvitation, MAX_RESEND_AT_ONCE,
  cohortStart, startDateFor, modulesMissed, lateEnrolmentNote, lateEnrolmentProblem,
  generateCertificateCode,
  extensionProblem, extensionNote, manyExtensionsNote, describeWhen,
  whyBehind, cohortHeadline,
} from "@workspace/domain";
import { cohortProgressFor } from "../lib/cohortProgress";
import { currentRole, founderId, requireRole, getCurrentUser } from "../lib/auth";
import { syncAttendanceForSession } from "../lib/meetAttendanceSync";
import { revokeInvitation, invitesConfigured } from "../lib/clerkInvites";
import { deliverInvitation } from "../lib/invitationDelivery";
import { sendWaitlistPromotion, sendAdminEnrollment, sendDeadlineExtended } from "../lib/enrollmentEmails";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use("/admin", requireRole("admin"));

/**
 * The staff.
 *
 * People used to list everybody with an account, learners included, which on a
 * cohort of fifty was a wall of names an admin had to read past to find the two
 * facilitators. Learners belong to their programme and are managed there; this
 * is the list of people who run the Lab.
 */
router.get("/admin/staff", async (req, res) => {
  const rows = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
    })
    .from(usersTable)
    .where(inArray(usersTable.role, ["instructor", "admin", "superadmin"]))
    .orderBy(asc(usersTable.id));

  // The classes each facilitator is actually running, so an admin can see who
  // is carrying what without opening every programme in turn.
  const teaching = await db
    .select({
      instructorId: sessionsTable.instructorId,
      programId: programsTable.id,
      programTitle: programsTable.title,
      sessions: sql<number>`count(*)::int`,
    })
    .from(sessionsTable)
    .innerJoin(programsTable, eq(sessionsTable.programId, programsTable.id))
    .where(sql`${sessionsTable.instructorId} is not null`)
    .groupBy(sessionsTable.instructorId, programsTable.id, programsTable.title);

  // The effective role, so the first admin of an older Lab shows as the super
  // admin they are treated as everywhere else.
  const mine = await currentRole(req);
  const me = await getCurrentUser(req);

  res.json({
    you: { id: me?.id ?? null, role: mine ?? "learner" },
    // Marked so the console can show the founder's role as fixed rather than
    // offering a control that will be refused.
    founderId: await founderId(),
    staff: rows.map((r) => ({
      ...r,
      role: r.id === me?.id ? (mine ?? r.role) : r.role,
      programmes: teaching
        .filter((t) => t.instructorId === r.id)
        .map((t) => ({ programId: t.programId, programTitle: t.programTitle, sessions: t.sessions })),
    })),
  });
});

router.get("/admin/users", async (_req, res) => {
  const rows = await db
    .select({
      id: usersTable.id,
      clerkUserId: usersTable.clerkUserId,
      email: usersTable.email,
      name: usersTable.name,
      role: usersTable.role,
    })
    .from(usersTable)
    .orderBy(asc(usersTable.id));
  res.json(rows);
});

router.patch("/admin/users/:id/role", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateUserRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const me = await getCurrentUser(req);
  const myRole = await currentRole(req);
  const founder = await founderId();

  // Counting super admins and then demoting one has to happen under a lock, or
  // two of them demoting each other at the same instant both read "2", both
  // pass, and the Lab is left with nobody able to appoint anyone. It is the
  // same lock the first-user bootstrap takes, because it guards the same thing:
  // there must always be someone who can hand out the roles.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(981431)`);

    const [target] = await tx.select().from(usersTable).where(eq(usersTable.id, id));
    if (!target) return { ok: false as const, status: 404, error: "User not found", row: null };

    const [{ superadmins }] = await tx
      .select({ superadmins: sql<number>`count(*)::int` })
      .from(usersTable)
      .where(eq(usersTable.role, "superadmin"));

    const check = checkRoleChange({
      actorRole: myRole,
      actorId: me?.id ?? null,
      targetId: id,
      targetRole: target.role,
      nextRole: parsed.data.role,
      // An older Lab has no stored super admin and the first admin standing in
      // for one. Counting that person keeps the "last super admin" guard honest
      // rather than letting the only one demote themselves out of existence.
      superadmins: superadmins > 0 ? superadmins : (myRole === "superadmin" ? 1 : 0),
      founderId: founder,
    });
    if (!check.ok) return { ok: false as const, status: 403, error: check.problem, row: null };

    const rows = await tx.update(usersTable).set({ role: parsed.data.role }).where(eq(usersTable.id, id)).returning();
    return { ok: true as const, status: 200, error: "", row: rows[0] };
  });

  if (!outcome.ok || !outcome.row) {
    res.status(outcome.status).json({ error: outcome.error || "User not found" });
    return;
  }
  const u = outcome.row;
  logger.info({ userId: u.id, role: u.role, by: me?.id }, "Role changed");
  res.json({ id: u.id, clerkUserId: u.clerkUserId, email: u.email, name: u.name, role: u.role });
});

/* ------------------------------------------------------------------ *
 * How the cohort is doing
 * ------------------------------------------------------------------ */

/**
 * The whole cohort, module by module and person by person.
 *
 * Built after the extension controls rather than before them, which was the
 * wrong way round and is worth saying so. The Lab gained a way to move a
 * deadline before it had any way of seeing who needed one moved, so an admin
 * could act on a situation the app could not show them.
 *
 * The one thing this endpoint guarantees is that its numbers are not a second
 * opinion: see the note in ../lib/cohortProgress.
 */
router.get("/admin/programs/:id/progress", async (req, res) => {
  const programId = Number(req.params.id);
  if (!Number.isInteger(programId)) { res.status(400).json({ error: "That is not a programme." }); return; }

  const result = await cohortProgressFor(programId);
  if (!result) { res.status(404).json({ error: "That programme no longer exists." }); return; }

  const { snapshot, modules } = result;
  const withReason = (row: typeof snapshot.learners[number]) => ({
    ...row,
    // Said here so the browser never has to assemble the sentence, and so the
    // chase list and a future reminder email cannot word it differently.
    why: row.behind > 0 ? whyBehind(row, modules) : "",
  });

  res.json({
    programme: result.programme,
    headlineText: cohortHeadline(snapshot),
    headline: snapshot.headline,
    modules: snapshot.modules,
    learners: snapshot.learners.map(withReason),
    needsAttention: snapshot.needsAttention.map(withReason),
    undatedModulesThatHaveRun: snapshot.undatedModulesThatHaveRun,
    generatedAt: new Date().toISOString(),
  });
});

/* ------------------------------------------------------------------ *
 * Moving one learner's deadline
 * ------------------------------------------------------------------ */

/**
 * One module, and where every learner on it stands.
 *
 * Module first, because that is how the question arrives. An admin thinks
 * "module two caught people out" far more often than "Kwame specifically", and
 * the learner-first version of this meant opening forty-five people one at a
 * time to find out who was stuck on the same module.
 *
 * Three things travel with each name — the class, the quiz, the written task —
 * because "who still needs more time" cannot be answered by the written task
 * alone. A module needs all three, and somebody who submitted the task and
 * passed the quiz but never attended is not helped by a later deadline at all:
 * they need to watch the recording. Showing only the task made that person look
 * like everybody else on this table, and made extra time look like the remedy
 * when it was not.
 *
 * The three come from the cohort loader rather than from queries written here,
 * so this table and the Progress grid above it are the same numbers rather than
 * two counts that agree today.
 */
router.get("/admin/sessions/:id/extensions", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) { res.status(400).json({ error: "That is not a module." }); return; }

  const [session] = await db
    .select({
      id: sessionsTable.id,
      title: sessionsTable.title,
      programId: sessionsTable.programId,
      programTitle: programsTable.title,
      startsAt: sessionsTable.startsAt,
      quizDueAt: sessionsTable.quizDueAt,
      quizDraft: sessionsTable.quizDraft,
    })
    .from(sessionsTable)
    .innerJoin(programsTable, eq(programsTable.id, sessionsTable.programId))
    .where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "That module no longer exists." }); return; }

  const [assignment] = await db
    .select({ dueAt: assignmentsTable.dueAt, draft: assignmentsTable.draft })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.sessionId, sessionId));

  // A draft piece does not exist as far as a learner is concerned, so its
  // deadline is not one either.
  const quizDue = session.quizDraft ? null : session.quizDueAt?.toISOString() ?? null;
  const taskDue = !assignment || assignment.draft ? null : assignment.dueAt?.toISOString() ?? null;

  // Where everybody on this cohort stands, by the Lab's one definition of it.
  const cohort = await cohortProgressFor(session.programId);
  const entryFor = new Map(
    (cohort?.learners ?? []).map((l) => [l.userId, l.entries.find((e) => e.sessionId === sessionId)]),
  );

  // The extension rows carry a reason, which the progress entries do not.
  const extensions = await db
    .select({
      userId: deadlineExtensionsTable.userId,
      dueAt: deadlineExtensionsTable.dueAt,
      reason: deadlineExtensionsTable.reason,
    })
    .from(deadlineExtensionsTable)
    .where(eq(deadlineExtensionsTable.sessionId, sessionId));
  const extensionFor = new Map(extensions.map((e) => [e.userId, e]));

  const roster = await db
    .select({ userId: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
    .where(and(
      eq(enrollmentsTable.programId, session.programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ))
    .orderBy(asc(usersTable.name));

  const now = Date.now();
  res.json({
    sessionId,
    title: session.title,
    programTitle: session.programTitle,
    startsAt: session.startsAt?.toISOString() ?? null,
    quizDueAt: quizDue,
    assignmentDueAt: taskDue,
    // Shut for the cohort — which is what makes extra time worth giving.
    moduleClosed: [quizDue, taskDue].some((d) => d !== null && new Date(d).getTime() < now),
    // Nothing set means nothing to extend, and the panel says so rather than
    // offering a date box that would be refused.
    hasCoursework: quizDue !== null || taskDue !== null,
    learners: roster.map((l) => {
      const entry = entryFor.get(l.userId);
      const extension = extensionFor.get(l.userId);
      return {
      userId: l.userId,
      name: l.name,
      email: l.email,
      // The class. First, because it is the one extra time cannot fix — the
      // remedy for a missed class is the recording, which is never shut.
      attended: entry?.presence.met ?? false,
      attendedVia: entry?.presence.via ?? "none",
      attendedPct: entry?.presence.bestPct ?? 0,
      submitted: entry?.assignmentSubmitted ?? false,
      quizPassed: entry?.quizPassed ?? false,
      quizBestScore: entry?.quizBestScore ?? null,
      hasQuiz: entry?.hasQuiz ?? false,
      hasAssignment: entry?.hasAssignment ?? false,
      critiquesGiven: entry?.reviewsGiven ?? 0,
      critiquesRequired: entry?.reviewsRequired ?? 0,
      // Whether the module is finished for them, which is the only summary of
      // the three that matters.
      complete: entry?.completed ?? false,
      extendedTo: extension?.dueAt?.toISOString() ?? null,
      extensionReason: extension ? extension.reason : null,
      };
    }),
  });
});

/**
 * Move one learner's deadline on one module.
 *
 * The other half of the late pass. A pass is the learner's own remedy — two per
 * programme, forty-eight hours each, spent without asking — and it deliberately
 * does not stretch to somebody added to a cohort three weeks in, somebody whose
 * passes are gone, or a reason that does not fit in a rule. For all of those the
 * app said "talk to the team", and the team had nothing to act with.
 *
 * It replaces the date the doors read rather than adding an exception to each
 * one, so the quiz gate, the submission gate, the late-pass arithmetic and the
 * dashboard all keep working unchanged, on a different number.
 */
router.put("/admin/sessions/:id/deadline-extension", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) { res.status(400).json({ error: "That is not a module." }); return; }

  const parsed = GrantDeadlineExtensionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [session] = await db
    .select({
      id: sessionsTable.id,
      programId: sessionsTable.programId,
      title: sessionsTable.title,
      quizDueAt: sessionsTable.quizDueAt,
      quizDraft: sessionsTable.quizDraft,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId));
  if (!session) { res.status(404).json({ error: "That module no longer exists." }); return; }

  // Everybody asked for who is actually on this programme. Filtering here rather
  // than refusing the whole request means "give the cohort extra time" survives
  // one stale id in the list — and the number skipped is reported, because an
  // admin who asked for forty-five and got forty-three wants to know.
  const asked = [...new Set(parsed.data.userIds)];
  const learners = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
    .from(enrollmentsTable)
    .innerJoin(usersTable, eq(usersTable.id, enrollmentsTable.userId))
    .where(and(
      eq(enrollmentsTable.programId, session.programId),
      inArray(enrollmentsTable.userId, asked),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));

  if (learners.length === 0) {
    res.status(400).json({
      error: "None of those people are on this programme, so there is no deadline of theirs to move. "
        + "Add them to the cohort first.",
    });
    return;
  }

  const [assignment] = await db
    .select({ dueAt: assignmentsTable.dueAt, draft: assignmentsTable.draft })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.sessionId, sessionId));

  const quizDue = session.quizDraft ? null : session.quizDueAt?.toISOString() ?? null;
  const taskDue = !assignment || assignment.draft ? null : assignment.dueAt?.toISOString() ?? null;

  // Checked against the later of the two, because one date moves both doors and
  // an extension that beat only the quiz would leave the writing shut.
  const latest = [quizDue, taskDue]
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1) ?? null;

  // The generated schema hands back a Date, not the string it arrived as.
  const wanted = new Date(parsed.data.dueAt);
  const problem = extensionProblem({
    newDueAt: Number.isFinite(wanted.getTime()) ? wanted.toISOString() : null,
    moduleDueAt: latest,
    nowMs: Date.now(),
  });
  if (problem) { res.status(400).json({ error: problem }); return; }

  const me = await getCurrentUser(req);
  const dueAt = wanted;
  const reason = (parsed.data.reason ?? "").slice(0, 500);

  // One statement for the whole cohort. Granting again moves the same dates
  // rather than stacking second rows behind the first, where nobody would ever
  // see them.
  await db
    .insert(deadlineExtensionsTable)
    .values(learners.map((l) => ({
      userId: l.id,
      sessionId,
      programId: session.programId,
      dueAt,
      reason,
      grantedByUserId: me?.id ?? null,
    })))
    .onConflictDoUpdate({
      target: [deadlineExtensionsTable.userId, deadlineExtensionsTable.sessionId],
      set: { dueAt, reason, grantedByUserId: me?.id ?? null },
    });

  const when = describeWhen(dueAt.toISOString());
  const notify = parsed.data.notify !== false;
  if (notify) {
    const [program] = await db
      .select({ title: programsTable.title })
      .from(programsTable)
      .where(eq(programsTable.id, session.programId));
    for (const l of learners) {
      sendDeadlineExtended(
        { email: l.email, name: l.name },
        {
          programTitle: program?.title ?? "your programme",
          moduleTitle: session.title,
          when,
          sessionId,
        },
      );
    }
  }

  logger.info(
    { sessionId, granted: learners.length, asked: asked.length, dueAt, by: me?.id, notify },
    "Deadline extended",
  );

  const moduleAlreadyClosed = latest !== null && new Date(latest).getTime() < Date.now();
  res.json({
    sessionId,
    dueAt: dueAt.toISOString(),
    granted: learners.length,
    skipped: asked.length - learners.length,
    emailed: notify ? learners.length : 0,
    note: learners.length === 1
      ? extensionNote({
        learnerName: learners[0].name,
        moduleTitle: session.title,
        extendedTo: dueAt.toISOString(),
        moduleAlreadyClosed,
      })
      : manyExtensionsNote({
        count: learners.length,
        moduleTitle: session.title,
        extendedTo: dueAt.toISOString(),
        moduleAlreadyClosed,
      }),
  });
});

/** Take an extension back. The module's own deadline applies again immediately. */
router.delete("/admin/sessions/:id/deadline-extension", async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) { res.status(400).json({ error: "That is not a module." }); return; }

  const parsed = RevokeDeadlineExtensionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const asked = [...new Set(parsed.data.userIds)];
  await db
    .delete(deadlineExtensionsTable)
    .where(and(
      eq(deadlineExtensionsTable.sessionId, sessionId),
      inArray(deadlineExtensionsTable.userId, asked),
    ));

  // Deliberately not an error when there was nothing there. The admin wanted no
  // extension on this module for these learners, and there is now none.
  logger.info({ userIds: asked.length, sessionId }, "Deadline extension taken back");
  res.json({ error: "Extension taken back" });
});

/**
 * Put somebody who already has an account onto a programme.
 *
 * The gap this fills: a person signs up, never finishes onboarding, and ends up
 * with an account on no programme. Self-enrolment cannot help — a running
 * cohort is closed to it — and the invitation tool refuses anybody who already
 * has an account. The admin console's own "accounts on no programme" panel sent
 * admins to that tool, which is a signpost to a locked door.
 *
 * The real decision is where the app measures them from, and it is consequential
 * in both directions: from today writes off the modules that already ran, and
 * from the start of the cohort can hand somebody a module whose deadline has
 * already shut. So the answer comes back saying which of those just happened,
 * and running this again with the other choice undoes it.
 */
router.post("/admin/programs/:id/enrollments", async (req, res) => {
  const programId = Number(req.params.id);
  if (!Number.isInteger(programId)) { res.status(400).json({ error: "That is not a programme." }); return; }

  const parsed = EnrolExistingAccountBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const email = parsed.data.email.trim().toLowerCase();
  const choice = parsed.data.countsFrom;

  const [program] = await db.select().from(programsTable).where(eq(programsTable.id, programId));
  if (!program) { res.status(404).json({ error: "That programme no longer exists." }); return; }

  // Matched case-insensitively: the users table holds whatever Clerk gave it,
  // unnormalised, and an admin types an address the way a person wrote it.
  const [user] = await db
    .select()
    .from(usersTable)
    .where(and(sql`lower(${usersTable.email}) = ${email}`, sql`${usersTable.email} <> ''`));

  const [existing] = user
    ? await db
      .select()
      .from(enrollmentsTable)
      .where(and(eq(enrollmentsTable.userId, user.id), eq(enrollmentsTable.programId, programId)))
    : [];

  const problem = lateEnrolmentProblem({
    accountExists: !!user,
    email: parsed.data.email.trim(),
    existingStatus: (existing?.status ?? null) as "enrolled" | "waitlisted" | "cancelled" | "completed" | null,
  });
  if (problem) { res.status(400).json({ error: problem }); return; }

  const now = new Date();

  // When this cohort began. `programs.startDate` cannot answer it — it is a
  // display string like "Nov 2026" — so the first dated class is the beginning,
  // and the oldest enrolment stands in where no class has a date yet.
  const [firstClass] = await db
    .select({ startsAt: sessionsTable.startsAt })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.programId, programId), isNotNull(sessionsTable.startsAt)))
    .orderBy(asc(sessionsTable.startsAt))
    .limit(1);
  const [oldestEnrolment] = await db
    .select({ createdAt: enrollmentsTable.createdAt })
    .from(enrollmentsTable)
    .where(eq(enrollmentsTable.programId, programId))
    .orderBy(asc(enrollmentsTable.createdAt))
    .limit(1);

  const startOfCohort = cohortStart(
    firstClass?.startsAt ?? null,
    oldestEnrolment?.createdAt ?? null,
    now,
  );
  const startedAt = startDateFor(choice, startOfCohort, now);

  // What they are walking into. Every dated module comes back and the counting
  // happens in the domain, against *now* — how much of the programme has gone
  // by in real time. Counting against the date being written instead made the
  // warning go quiet for the one case it exists for: somebody held to the whole
  // programme starts before the first class, so nothing has "already run"
  // relative to them, and an admin was told nothing was closed about a learner
  // who could not file a thing.
  const moduleRows = await db
    .select({
      id: sessionsTable.id,
      startsAt: sessionsTable.startsAt,
      durationMins: sessionsTable.durationMins,
      quizDueAt: sessionsTable.quizDueAt,
      taskDueAt: assignmentsTable.dueAt,
    })
    .from(sessionsTable)
    .leftJoin(assignmentsTable, eq(assignmentsTable.sessionId, sessionsTable.id))
    .where(eq(sessionsTable.programId, programId));

  // One row per module, because the join multiplies a module by its tasks and a
  // module with a quiz and an assignment is still one module somebody missed.
  const byModule = new Map<number, { startsAtMs: number | null; durationMins: number; dueAtMs: (number | null)[] }>();
  for (const r of moduleRows) {
    const entry = byModule.get(r.id) ?? {
      startsAtMs: r.startsAt?.getTime() ?? null,
      durationMins: r.durationMins,
      dueAtMs: [r.quizDueAt?.getTime() ?? null],
    };
    if (r.taskDueAt) entry.dueAtMs.push(r.taskDueAt.getTime());
    byModule.set(r.id, entry);
  }
  const { alreadyRun, deadlinesPassed } = modulesMissed([...byModule.values()], now);

  const enrolment = await db.transaction(async (tx) => {
    if (existing) {
      const [updated] = await tx
        .update(enrollmentsTable)
        .set({ status: "enrolled", startedAt })
        .where(eq(enrollmentsTable.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await tx
      .insert(enrollmentsTable)
      .values({
        userId: user!.id,
        programId,
        status: "enrolled",
        startedAt,
        certificateCode: generateCertificateCode(),
      })
      .returning();
    return created;
  });

  // Capacity does not refuse an admin doing this deliberately — they are
  // holding a reason the database cannot see. It is reported rather than
  // enforced, because a cohort silently one over its places is how a room
  // gets double-booked.
  const [{ count: taken }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(enrollmentsTable)
    .where(and(
      eq(enrollmentsTable.programId, programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));

  // Only somebody actually arriving gets the welcome. Moving the start date of
  // a learner already on the programme is not news to them.
  const wasAlreadyOn = !!existing && existing.status !== "cancelled";
  if (!wasAlreadyOn) {
    // `sendAdminEnrollment`, not the self-enrolment confirmation: somebody put
    // on a cohort three weeks in should not be told the programme is about to
    // start and that reminders are coming before each class.
    sendAdminEnrollment({ email: user!.email, name: user!.name }, program);
  }

  logger.info(
    { userId: user!.id, programId, choice, startedAt, deadlinesPassed },
    "Account added to a running programme by an admin",
  );

  res.json({
    enrollmentId: enrolment.id,
    status: enrolment.status,
    name: user!.name,
    countsFrom: startedAt.toISOString(),
    modulesAlreadyRun: alreadyRun,
    deadlinesPassed,
    alreadyOnProgramme: wasAlreadyOn,
    overCapacity: taken > program.capacity,
    note: lateEnrolmentNote({
      name: user!.name,
      choice,
      modulesAlreadyRun: alreadyRun,
      deadlinesPassed,
    }),
  });
});

/**
 * Take somebody off a programme entirely.
 *
 * Cancelling leaves the row, which is right when a learner withdrew and the
 * record matters. This is for the other case: somebody enrolled by mistake, or
 * a member of staff who ended up on the roster while testing, who should not be
 * in the cohort list at all.
 *
 * A completed enrolment is refused. That row is what a certificate is checked
 * against, and deleting it would break a certificate already in somebody's
 * hands. Cancel that one instead.
 */
router.delete("/admin/enrollments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "That is not an enrolment." });
    return;
  }

  const [existing] = await db.select().from(enrollmentsTable).where(eq(enrollmentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "That enrolment no longer exists." });
    return;
  }
  if (existing.status === "completed") {
    res.status(400).json({
      error: "This learner completed the programme, and their certificate is checked against this record. Set them to cancelled instead.",
    });
    return;
  }

  await db.delete(enrollmentsTable).where(eq(enrollmentsTable.id, id));
  logger.info({ enrollmentId: id, userId: existing.userId, programId: existing.programId }, "Enrolment removed");
  res.status(204).end();
});

router.get("/admin/enrollments", async (req, res) => {
  const programId = req.query.programId ? Number(req.query.programId) : undefined;
  const base = db
    .select({
      id: enrollmentsTable.id,
      userId: enrollmentsTable.userId,
      programId: enrollmentsTable.programId,
      status: enrollmentsTable.status,
      programTitle: programsTable.title,
      programStartDate: programsTable.startDate,
      userName: usersTable.name,
      userEmail: usersTable.email,
    })
    .from(enrollmentsTable)
    .innerJoin(programsTable, eq(enrollmentsTable.programId, programsTable.id))
    .innerJoin(usersTable, eq(enrollmentsTable.userId, usersTable.id));
  const rows = programId
    ? await base.where(eq(enrollmentsTable.programId, programId)).orderBy(asc(enrollmentsTable.id))
    : await base.orderBy(asc(enrollmentsTable.id));
  res.json(rows);
});

router.patch("/admin/enrollments/:id", async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateEnrollmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  type PromotedLearner = { email: string; name: string; program: { title: string; startDate: string } };
  let promoted: PromotedLearner | null = null;
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(enrollmentsTable)
      .set({ status: parsed.data.status })
      .where(eq(enrollmentsTable.id, id))
      .returning();
    if (rows.length === 0) return rows;
    // If a place opened up, promote the oldest waitlisted learner (FIFO).
    if (parsed.data.status === "cancelled") {
      const programId = rows[0].programId;
      await tx.execute(sql`select id from ${programsTable} where id = ${programId} for update`);
      const [program] = await tx.select().from(programsTable).where(eq(programsTable.id, programId));
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(enrollmentsTable)
        .where(and(eq(enrollmentsTable.programId, programId), sql`${enrollmentsTable.status} in ('enrolled', 'completed')`));
      if (program && count < program.capacity) {
        const waitlisted = await tx
          .select()
          .from(enrollmentsTable)
          .where(and(eq(enrollmentsTable.programId, programId), eq(enrollmentsTable.status, "waitlisted")))
          .orderBy(asc(enrollmentsTable.createdAt), asc(enrollmentsTable.id))
          .limit(1);
        if (waitlisted.length > 0) {
          // Their programme starts now, not when they joined the queue.
          await tx
            .update(enrollmentsTable)
            .set({ status: "enrolled", startedAt: new Date() })
            .where(eq(enrollmentsTable.id, waitlisted[0].id));
          const [learner] = await tx
            .select({ email: usersTable.email, name: usersTable.name })
            .from(usersTable)
            .where(eq(usersTable.id, waitlisted[0].userId));
          if (learner) {
            promoted = { ...learner, program: { title: program.title, startDate: program.startDate } };
          }
        }
      }
    }
    return rows;
  });
  // Email only after the promotion has committed; failure only logs.
  const p = promoted as PromotedLearner | null;
  if (p) {
    sendWaitlistPromotion({ email: p.email, name: p.name }, p.program);
  }
  if (updated.length === 0) {
    res.status(404).json({ error: "Enrollment not found" });
    return;
  }
  res.json(updated[0]);
});

/* ---------- Inviting facilitators ---------- */

/**
 * The people teaching here are senior practitioners giving their time for
 * nothing. Asking them to invent a password before they can see the class they
 * agreed to teach is a poor way to spend that goodwill.
 *
 * So: the admin invites by email, Clerk sends the link, and the facilitator
 * arrives already a facilitator with their classes waiting. The role travels on
 * Clerk's public metadata, which only a backend can write.
 */
/**
 * Fill in this class's attendance from Google's record of the room.
 *
 * Here rather than in a console command because the console is where a bad
 * afternoon is spent, and this is the tool for getting out of one. It is also
 * run automatically an hour after each class ends — this is for the classes
 * that happened before any of that existed.
 */
router.post("/admin/sessions/:id/attendance/from-google", requireRole("admin", "superadmin"), async (req, res) => {
  const sessionId = Number(req.params.id);
  if (!Number.isInteger(sessionId)) { res.status(400).json({ error: "That is not a module." }); return; }

  // No dry run here, unlike the scripts. This only ever raises a number and
  // repeats harmlessly, so there is nothing for a rehearsal to protect against
  // — and a button with two modes is a button somebody presses the wrong one of.
  const result = await syncAttendanceForSession(sessionId);
  if ("error" in result) {
    // 403 for the two that are about permission, because they need a different
    // action from the admin: reconnect Google, or use an account that can.
    const permission = result.error.includes("administrator") || result.error.includes("Reconnect");
    res.status(permission ? 403 : 400).json({ error: result.error });
    return;
  }
  res.json(result);
});

router.post("/admin/invitations", async (req, res) => {
  if (!invitesConfigured()) {
    res.status(503).json({ error: "Clerk is not configured on the server, so invitations cannot be sent." });
    return;
  }

  const parsed = InviteFacilitatorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Who is asking decides what they may hand out: a super admin can invite an
  // admin, an admin cannot, and nobody invites a super admin by email.
  const myRole = await currentRole(req);
  const { invite, problems } = validateInvite({ ...parsed.data, actorRole: myRole ?? undefined });
  if (!invite) { res.status(403).json({ error: problems.join(" ") }); return; }

  const me = await getCurrentUser(req);

  // Somebody already here does not need an invitation; they need their role
  // changing, which is a different button. Compared case-insensitively because
  // the users table stores whatever Clerk gave it, unnormalised.
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(and(sql`lower(${usersTable.email}) = ${invite.email}`, sql`${usersTable.email} <> ''`));
  if (existing) {
    // Naming the exact place matters here. This used to say "the list below",
    // meaning the staff list — which by design does not contain learners, so an
    // admin promoting an enrolled learner was sent somewhere that could never
    // show them.
    res.status(400).json({
      error: `${existing.name || invite.email} already has an account here, so there is nothing to invite them to. Appoint them instead: People, then “Already has an account?”, and search for them. They keep their place on any programme.`,
    });
    return;
  }

  const [prior] = await db
    .select()
    .from(pendingInvitationsTable)
    .where(eq(pendingInvitationsTable.email, invite.email));

  // An invitation already taken up is a record of what happened, not something
  // to overwrite. The person exists somewhere; the admin wants the People list.
  if (prior?.acceptedAt) {
    res.status(400).json({
      error: "That invitation has already been accepted. Find them in the list below and change their role there.",
    });
    return;
  }

  // Withdraw the previous invitation before issuing another, or the first link
  // stays live forever with nothing recording its id — a second ticket in the
  // same inbox, still granting facilitator, and unrevocable through this app.
  if (prior?.clerkInvitationId) {
    const outcome = await revokeInvitation(prior.clerkInvitationId);
    if (outcome === "failed") {
      res.status(502).json({
        error: "Could not withdraw the previous invitation to this address, so a second was not sent. Try again shortly.",
      });
      return;
    }
    if (outcome === "already-accepted") {
      res.status(400).json({
        error: "They have already used their first invitation. Find them in the list below and change their role there.",
      });
      return;
    }
  }

  // Clerk is told "facilitator" even for an admin invitation. The admin role is
  // applied on arrival from the pending-invitation row below, which only this
  // server writes — so a forwarded link, or Clerk dashboard access, still
  // cannot make somebody an admin here.
  const sent = await deliverInvitation({
    email: invite.email,
    role: invite.role === "admin" ? "instructor" : invite.role,
    // The letter says admin where that is what they were invited as, so nobody
    // is told one thing and handed another — only Clerk's metadata is narrowed.
    describeAs: invite.role,
  });
  if (!sent.ok) { res.status(400).json({ error: sent.error }); return; }

  const values = {
    email: invite.email,
    role: invite.role,
    sessionIds: invite.sessionIds,
    clerkInvitationId: sent.invitationId,
    invitedByUserId: me?.id ?? null,
    // Re-inviting is a fresh invitation, and dates it as one: otherwise it keeps
    // the original date, sorts to the bottom of the admin's list, and reports
    // the wrong day.
    createdAt: new Date(),
    acceptedAt: null,
    acceptedByUserId: null,
  };

  // Re-inviting replaces rather than stacks, so nobody ends up with two sets
  // of classes from two invitations.
  let saved;
  try {
    [saved] = await db
      .insert(pendingInvitationsTable)
      .values(values)
      .onConflictDoUpdate({ target: pendingInvitationsTable.email, set: values })
      .returning();
  } catch (err) {
    // The link is already in the post. Take it back rather than leaving a live
    // invitation with nothing recording it.
    await revokeInvitation(sent.invitationId);
    logger.error({ err, email: invite.email }, "Could not record an invitation; withdrew it again");
    res.status(500).json({ error: "Could not record that invitation, so it has been withdrawn. Try again." });
    return;
  }

  logger.info({ email: invite.email, role: invite.role, classes: invite.sessionIds.length }, "Facilitator invited");
  res.status(201).json(invitePayload(saved));
});

router.get("/admin/invitations", async (_req, res) => {
  // Pending first, always. Accepted rows are kept forever as a record, and with
  // a plain date ordering they would eventually push a still-live invitation
  // off the end of the list — where it could no longer be withdrawn, which is
  // exactly the invitation most likely to need withdrawing.
  //
  // The programme comes along because a learner's invitation belongs to a
  // cohort: without it the console cannot put an invited learner under the
  // programme they were invited to, which is the only place an admin looks.
  const rows = await db
    .select({
      id: pendingInvitationsTable.id,
      email: pendingInvitationsTable.email,
      role: pendingInvitationsTable.role,
      sessionIds: pendingInvitationsTable.sessionIds,
      programId: pendingInvitationsTable.programId,
      programTitle: programsTable.title,
      createdAt: pendingInvitationsTable.createdAt,
      acceptedAt: pendingInvitationsTable.acceptedAt,
    })
    .from(pendingInvitationsTable)
    .leftJoin(programsTable, eq(programsTable.id, pendingInvitationsTable.programId))
    .orderBy(sql`${pendingInvitationsTable.acceptedAt} is not null`, desc(pendingInvitationsTable.createdAt))
    .limit(200);
  res.json(rows.map(invitePayload));
});

/**
 * Send the same invitation again.
 *
 * The commonest reason an invitation goes unanswered is not refusal: it went to
 * spam, or it was read on a phone in a queue and forgotten. Before this the only
 * remedy was to withdraw the invitation and re-invite the person from the
 * roster tool, which meant retyping their details and hoping the admin got the
 * programme right the second time.
 *
 * A resend is a genuinely new link. The old one is withdrawn first, because two
 * live invitations to one inbox is exactly the state this codebase works
 * everywhere else to avoid, and because a spent-but-unrecorded link is the one
 * kind that cannot later be taken back.
 */
type ResendOutcome =
  | { ok: true; invitation: ReturnType<typeof invitePayload> }
  // The address rides along on a failure too. In a batch, "3 could not be sent"
  // without saying which three is a worse answer than not reporting at all.
  | { ok: false; status: number; error: string; email?: string };

/**
 * One resend, all of it.
 *
 * Extracted so that sending to one person and sending to forty are the same
 * code rather than two copies that agree today. The batch path is exactly the
 * place where "withdraw the old link first" or "never let admin ride a link"
 * would quietly get dropped, and a second implementation is how that happens.
 */
async function resendOne(id: number): Promise<ResendOutcome> {
  const [invite] = await db
    .select({
      id: pendingInvitationsTable.id,
      email: pendingInvitationsTable.email,
      role: pendingInvitationsTable.role,
      sessionIds: pendingInvitationsTable.sessionIds,
      programId: pendingInvitationsTable.programId,
      programTitle: programsTable.title,
      programStart: programsTable.startDate,
      clerkInvitationId: pendingInvitationsTable.clerkInvitationId,
      createdAt: pendingInvitationsTable.createdAt,
      acceptedAt: pendingInvitationsTable.acceptedAt,
    })
    .from(pendingInvitationsTable)
    .leftJoin(programsTable, eq(programsTable.id, pendingInvitationsTable.programId))
    .where(eq(pendingInvitationsTable.id, id));
  if (!invite) return { ok: false, status: 404, error: "Invitation not found" };

  const allowed = mayResendInvitation(invite);
  if (!allowed.allowed) return { ok: false, status: 400, error: allowed.reason ?? "That cannot be sent again.", email: invite.email };

  // Take the old link back first. acceptedAt is only written when the person
  // first uses the app, so somebody who finished signing up but has not browsed
  // still looks pending here — Clerk is the authority on whether a link has
  // been spent, and it is asked before anything is sent.
  if (invite.clerkInvitationId) {
    const outcome = await revokeInvitation(invite.clerkInvitationId);
    if (outcome === "failed") {
      return {
        ok: false, status: 502,
        error: "Could not withdraw the previous invitation, so a new one was not sent. Try again shortly.",
        email: invite.email,
      };
    }
    if (outcome === "already-accepted") {
      await db
        .update(pendingInvitationsTable)
        .set({ acceptedAt: new Date() })
        .where(eq(pendingInvitationsTable.id, id));
      return {
        ok: false, status: 400,
        error: "They have already used their invitation. They will appear in the lists once they sign in.",
        email: invite.email,
      };
    }
  }

  // Same narrowing as the original send: an invited admin travels to Clerk as a
  // facilitator, and is raised on arrival from our own row. A resend must not be
  // the one path that hands admin to a link.
  const sent = await deliverInvitation({
    email: invite.email,
    role: invite.role === "admin" ? "instructor" : (invite.role as "instructor" | "learner"),
    describeAs: invite.role as "admin" | "instructor" | "learner",
    programmeTitle: invite.programTitle,
    programmeStart: invite.programStart,
  });
  if (!sent.ok) return { ok: false, status: 400, error: sent.error, email: invite.email };

  let saved;
  try {
    [saved] = await db
      .update(pendingInvitationsTable)
      .set({
        clerkInvitationId: sent.invitationId,
        // Dated as what it is: a new invitation. The console lists these
        // longest-wait-first, so this is also what moves somebody just dealt
        // with off the top of the queue and down to the bottom.
        createdAt: new Date(),
      })
      .where(eq(pendingInvitationsTable.id, id))
      .returning();
  } catch (err) {
    await revokeInvitation(sent.invitationId);
    logger.error({ err, email: invite.email }, "Could not record a resent invitation; withdrew it again");
    return {
      ok: false, status: 500,
      error: "Could not record that invitation, so it has been withdrawn. Try again.",
      email: invite.email,
    };
  }

  logger.info({ email: invite.email, role: invite.role }, "Invitation resent");
  return { ok: true, invitation: invitePayload({ ...saved, programTitle: invite.programTitle }) };
}

/**
 * Send the same invitation again.
 *
 * The commonest reason an invitation goes unanswered is not refusal: it went to
 * spam, or it was read on a phone in a queue and forgotten. Before this the only
 * remedy was to withdraw the invitation and re-invite the person from the
 * roster tool, which meant retyping their details and hoping the admin got the
 * programme right the second time.
 *
 * A resend is a genuinely new link. The old one is withdrawn first, because two
 * live invitations to one inbox is exactly the state this codebase works
 * everywhere else to avoid, and because a spent-but-unrecorded link is the one
 * kind that cannot later be taken back.
 */
router.post("/admin/invitations/:id/resend", async (req, res) => {
  if (!invitesConfigured()) {
    res.status(503).json({ error: "Clerk is not configured on the server, so invitations cannot be sent." });
    return;
  }

  const outcome = await resendOne(Number(req.params.id));
  if (!outcome.ok) { res.status(outcome.status).json({ error: outcome.error }); return; }
  res.json(outcome.invitation);
});

/**
 * Send several again, in one go.
 *
 * A cohort of fifty produces a dozen people who never answered, and clicking
 * through them one at a time — waiting for each to finish, watching the list
 * reorder itself under the cursor — is the kind of task an admin quietly stops
 * doing. Which means the invitations stop being chased at all.
 *
 * Two things it borrows from inviting a cohort in the first place, for the same
 * reasons. Each person is attempted alone and reported on alone, so one dead
 * address does not cost the other eleven their second chance. And they are sent
 * one after another rather than all at once: fifty simultaneous requests is the
 * quickest way to be rate-limited halfway through, leaving nobody able to say
 * who was sent to and who was not.
 */
router.post("/admin/invitations/resend-batch", async (req, res) => {
  if (!invitesConfigured()) {
    res.status(503).json({ error: "Clerk is not configured on the server, so invitations cannot be sent." });
    return;
  }

  const raw = (req.body ?? {}) as { ids?: unknown };
  const ids = Array.from(new Set(
    (Array.isArray(raw.ids) ? raw.ids : [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0),
  ));

  if (ids.length === 0) {
    res.status(400).json({ error: "Choose at least one invitation to send again." });
    return;
  }
  if (ids.length > MAX_RESEND_AT_ONCE) {
    res.status(400).json({
      error: `That is more than ${MAX_RESEND_AT_ONCE} at once. Send these, then do the rest.`,
    });
    return;
  }

  const outcomes: { id: number; email: string; status: "sent" | "failed"; detail: string }[] = [];

  for (const id of ids) {
    try {
      const outcome = await resendOne(id);
      outcomes.push(outcome.ok
        ? { id, email: outcome.invitation.email, status: "sent", detail: "A new invitation is on its way." }
        : { id, email: outcome.email ?? "", status: "failed", detail: outcome.error });
    } catch (err) {
      // One person's failure is theirs alone; the rest of the list continues.
      logger.error({ err, invitationId: id }, "Resending one invitation failed inside a batch");
      outcomes.push({ id, email: "", status: "failed", detail: "Something went wrong for this one. Try them again." });
    }
  }

  const sent = outcomes.filter((o) => o.status === "sent").length;
  logger.info({ asked: ids.length, sent, failed: outcomes.length - sent }, "Batch invitation resend");
  res.json({ outcomes, sent, failed: outcomes.length - sent });
});

router.delete("/admin/invitations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [invite] = await db.select().from(pendingInvitationsTable).where(eq(pendingInvitationsTable.id, id));
  if (!invite) { res.status(404).json({ error: "Invitation not found" }); return; }

  if (invite.acceptedAt) {
    res.status(400).json({ error: "That person has already joined. Change their role in the list instead." });
    return;
  }

  // acceptedAt is only written when the person first uses the app, so somebody
  // who has completed sign-up but not yet browsed still looks pending here.
  // Clerk is the authority on whether the link has been spent, and the local
  // row is only removed once Clerk confirms the grant is gone.
  const outcome = await revokeInvitation(invite.clerkInvitationId);

  if (outcome === "already-accepted") {
    // Record it as accepted so the admin sees the truth, and say plainly that
    // the role is now on that person's account and has to be removed there.
    await db
      .update(pendingInvitationsTable)
      .set({ acceptedAt: new Date() })
      .where(eq(pendingInvitationsTable.id, id));
    res.status(400).json({
      error: "They have already accepted, so the invitation cannot be withdrawn. They will appear in the list below once they sign in, and you can change their role there.",
    });
    return;
  }

  if (outcome === "failed") {
    res.status(502).json({
      error: "Could not reach Clerk to withdraw it, so the invitation is still live. Try again shortly.",
    });
    return;
  }

  await db.delete(pendingInvitationsTable).where(eq(pendingInvitationsTable.id, id));
  res.status(204).end();
});

function invitePayload(row: {
  id: number;
  email: string;
  role: string;
  sessionIds: number[];
  programId?: number | null;
  programTitle?: string | null;
  createdAt: Date;
  acceptedAt: Date | null;
}) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    sessionIds: row.sessionIds ?? [],
    programId: row.programId ?? null,
    programTitle: row.programTitle ?? null,
    createdAt: row.createdAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    summary: describeInvite({
      email: row.email,
      role: row.role,
      sessionCount: (row.sessionIds ?? []).length,
      createdAt: row.createdAt,
      programmeTitle: row.programTitle ?? null,
    }),
  };
}

export default router;
