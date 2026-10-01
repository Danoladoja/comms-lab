import { Router, type IRouter } from "express";
import {
  db, programFormsTable, formQuestionsTable, formResponsesTable, formAnswersTable,
  programsTable, enrollmentsTable, usersTable,
} from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  formProblem, formFaults, faultSummary, standardQuestions, filedTally, satisfiesRole,
  type FormQuestion, type FormStage,
} from "@workspace/domain";
import { getCurrentUser, currentRole } from "../lib/auth";
import { logger } from "../lib/logger";

/**
 * The opening assessment and the closing survey.
 *
 * Two things in this file are load-bearing beyond the obvious.
 *
 * The first is that filing is all-or-nothing inside one transaction. A form
 * half-written to the database is a learner who has answered everything and is
 * still being told to answer it, while a certificate sits withheld on the other
 * side of the fault.
 *
 * The second is who may read what. Admins see names; facilitators see the
 * answers without them. That is not a convenience — it is a promise made to a
 * cohort being asked to say honestly what was weakest about a programme the
 * people reading it taught. The check is in one helper used by every read, so
 * there is one place to be right rather than four to drift.
 */

const router: IRouter = Router();

const STAGES: FormStage[] = ["before", "after"];

function stageFrom(raw: string): FormStage | null {
  return STAGES.includes(raw as FormStage) ? (raw as FormStage) : null;
}

async function loadQuestions(formId: number): Promise<FormQuestion[]> {
  const rows = await db
    .select()
    .from(formQuestionsTable)
    .where(eq(formQuestionsTable.formId, formId))
    .orderBy(asc(formQuestionsTable.sortOrder), asc(formQuestionsTable.id));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as FormQuestion["kind"],
    prompt: r.prompt,
    help: r.help,
    required: r.required,
    config: r.config,
    pairKey: r.pairKey,
    sortOrder: r.sortOrder,
    section: r.section,
  }));
}

async function isEnrolled(userId: number, programId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: enrollmentsTable.id })
    .from(enrollmentsTable)
    .where(and(
      eq(enrollmentsTable.userId, userId),
      eq(enrollmentsTable.programId, programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));
  return !!row;
}

/* ------------------------------------------------------------------ *
 * The learner's side
 * ------------------------------------------------------------------ */

/**
 * The form, and whatever they have already filed.
 *
 * A draft form is invisible here, exactly as a draft quiz is. The difference
 * is what an accident costs: a draft quiz nobody sees is a nuisance, and a
 * half-written closing survey that goes live withholds certificates from a
 * whole cohort.
 */
router.get("/programs/:id/form/:stage", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const programId = Number(req.params.id);
  const stage = stageFrom(req.params.stage);
  if (!Number.isInteger(programId) || !stage) {
    res.status(400).json({ error: "That is not a form." });
    return;
  }

  if (!await isEnrolled(user.id, programId)) {
    res.status(403).json({ error: "You are not enrolled on this programme" });
    return;
  }

  const [form] = await db
    .select()
    .from(programFormsTable)
    .where(and(
      eq(programFormsTable.programId, programId),
      eq(programFormsTable.stage, stage),
    ));

  if (!form || form.draft) {
    res.json({ programId, stage, published: false, questions: [], filed: false });
    return;
  }

  const questions = await loadQuestions(form.id);
  const [filed] = await db
    .select({ id: formResponsesTable.id, submittedAt: formResponsesTable.submittedAt })
    .from(formResponsesTable)
    .where(and(
      eq(formResponsesTable.formId, form.id),
      eq(formResponsesTable.userId, user.id),
    ));

  res.json({
    programId,
    stage,
    published: true,
    formId: form.id,
    title: form.title,
    intro: form.intro,
    // Their own answers travel back so a filed form can be read again. It
    // cannot be changed — see the refusal in the POST below — but somebody who
    // wrote three hundred words about what they would change should be able to
    // see what they said.
    filed: !!filed,
    filedAt: filed?.submittedAt?.toISOString() ?? null,
    questions: questions.map((q) => ({
      id: q.id,
      kind: q.kind,
      prompt: q.prompt,
      help: q.help,
      required: q.required,
      config: q.config,
      section: q.section,
    })),
    answers: filed
      ? (await db
        .select()
        .from(formAnswersTable)
        .where(eq(formAnswersTable.responseId, filed.id)))
        .map((a) => ({
          questionId: a.questionId,
          number: a.number,
          text: a.text,
          choices: a.choices,
        }))
      : [],
  });
});

/**
 * Filing it.
 *
 * Once, and then it is closed. Not because changing an answer would be wrong
 * in principle, but because this is the evidence an impact report is built on,
 * and a dataset that can be revised after the fact by the people it describes
 * is not evidence. A learner who wants something changed can say so and an
 * admin can remove the response, which leaves a trace; silent editing would
 * not.
 */
router.post("/programs/:id/form/:stage", async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

  const programId = Number(req.params.id);
  const stage = stageFrom(req.params.stage);
  if (!Number.isInteger(programId) || !stage) {
    res.status(400).json({ error: "That is not a form." });
    return;
  }

  if (!await isEnrolled(user.id, programId)) {
    res.status(403).json({ error: "You are not enrolled on this programme" });
    return;
  }

  const [form] = await db
    .select()
    .from(programFormsTable)
    .where(and(
      eq(programFormsTable.programId, programId),
      eq(programFormsTable.stage, stage),
    ));
  if (!form || form.draft) {
    res.status(404).json({ error: "That form is not open." });
    return;
  }

  const [already] = await db
    .select({ id: formResponsesTable.id })
    .from(formResponsesTable)
    .where(and(
      eq(formResponsesTable.formId, form.id),
      eq(formResponsesTable.userId, user.id),
    ));
  if (already) {
    res.status(409).json({
      error: "You have already filed this one. If something needs changing, tell the Lab and we "
        + "will clear it so you can file it again.",
    });
    return;
  }

  const questions = await loadQuestions(form.id);
  const given = Array.isArray(req.body?.answers) ? req.body.answers : [];
  const sanitised = given
    .filter((a: unknown): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a: Record<string, unknown>) => ({
      questionId: Number(a.questionId),
      number: a.number === null || a.number === undefined ? null : Number(a.number),
      text: typeof a.text === "string" ? a.text : "",
      choices: Array.isArray(a.choices) ? a.choices.filter((c): c is string => typeof c === "string") : [],
    }))
    .filter((a: { questionId: number }) => Number.isInteger(a.questionId));

  // Every fault at once. A form that complains one question at a time is a
  // form somebody abandons on the third try — and this one is compulsory.
  const faults = formFaults(questions, sanitised);
  if (faults.length > 0) {
    res.status(400).json({ error: faultSummary(faults), faults });
    return;
  }

  const known = new Map(questions.map((q) => [q.id, q]));

  await db.transaction(async (tx) => {
    const [response] = await tx
      .insert(formResponsesTable)
      .values({ formId: form.id, userId: user.id })
      .returning({ id: formResponsesTable.id });

    for (const answer of sanitised) {
      const question = known.get(answer.questionId);
      // Anything the form did not ask is dropped rather than stored. A row
      // against a question that does not exist would read as data later.
      if (!question) continue;
      await tx.insert(formAnswersTable).values({
        responseId: response.id,
        questionId: question.id,
        number: question.kind === "slider" || question.kind === "rating" ? answer.number : null,
        text: question.kind === "slider" || question.kind === "rating" || question.kind === "multi"
          ? "" : answer.text.trim(),
        choices: question.kind === "multi" ? answer.choices : [],
      });
    }
  });

  logger.info({ programId, stage, userId: user.id }, "Programme form filed");
  res.json({ programId, stage, filed: true });
});

/* ------------------------------------------------------------------ *
 * The admin's side
 * ------------------------------------------------------------------ */

/** Both forms for a programme, with how many have filed each. */
router.get("/admin/programs/:id/forms", async (req, res) => {
  const user = await getCurrentUser(req);
  const role = await currentRole(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!satisfiesRole(role, ["instructor"])) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const programId = Number(req.params.id);
  if (!Number.isInteger(programId)) { res.status(400).json({ error: "That is not a programme." }); return; }

  const [programme] = await db
    .select({ id: programsTable.id, title: programsTable.title })
    .from(programsTable)
    .where(eq(programsTable.id, programId));
  if (!programme) { res.status(404).json({ error: "That programme no longer exists." }); return; }

  const [{ enrolled }] = await db
    .select({ enrolled: sql<number>`count(*)::int` })
    .from(enrollmentsTable)
    .where(and(
      eq(enrollmentsTable.programId, programId),
      sql`${enrollmentsTable.status} in ('enrolled', 'completed')`,
    ));

  const forms = await db
    .select()
    .from(programFormsTable)
    .where(eq(programFormsTable.programId, programId));

  const out = [];
  for (const stage of STAGES) {
    const form = forms.find((f) => f.stage === stage);
    if (!form) {
      out.push({ stage, exists: false, published: false, questionCount: 0, filed: 0, tally: "", title: "" });
      continue;
    }
    const questions = await loadQuestions(form.id);
    const [{ filed }] = await db
      .select({ filed: sql<number>`count(*)::int` })
      .from(formResponsesTable)
      .where(eq(formResponsesTable.formId, form.id));

    out.push({
      stage,
      exists: true,
      formId: form.id,
      title: form.title,
      intro: form.intro,
      published: !form.draft,
      questionCount: questions.length,
      filed,
      tally: filedTally({ enrolled, filed }),
      // Said here rather than only at the moment of publishing, so an admin can
      // see at a glance whether this form is in a state to be put in front of
      // anybody.
      problem: formProblem({ questions, title: form.title }) ?? "",
      questions: questions.map((q) => ({
        id: q.id, kind: q.kind, prompt: q.prompt, help: q.help,
        required: q.required, config: q.config, pairKey: q.pairKey, section: q.section,
      })),
    });
  }

  res.json({ programme, enrolled, forms: out });
});

/**
 * Start a form from the Lab's standard set.
 *
 * Offered because an empty question editor in front of somebody who needs a
 * survey running this week is a feature that does not get used. The standard
 * set is a starting point with the shape already right — paired sliders on both
 * sides, two compulsory written answers, both ends of every line named — and
 * every question in it is meant to be edited afterwards.
 */
router.post("/admin/programs/:id/forms/:stage/standard", async (req, res) => {
  const user = await getCurrentUser(req);
  const role = await currentRole(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!satisfiesRole(role, ["admin"])) { res.status(403).json({ error: "Forbidden" }); return; }

  const programId = Number(req.params.id);
  const stage = stageFrom(req.params.stage);
  if (!Number.isInteger(programId) || !stage) { res.status(400).json({ error: "That is not a form." }); return; }

  const [existing] = await db
    .select({ id: programFormsTable.id })
    .from(programFormsTable)
    .where(and(eq(programFormsTable.programId, programId), eq(programFormsTable.stage, stage)));
  if (existing) {
    res.status(409).json({
      error: "There is already a form here. Delete its questions first if you want to start again.",
    });
    return;
  }

  const title = stage === "before"
    ? "Before we begin"
    : "How did we do?";
  const intro = stage === "before"
    ? "A few questions before the first class, so we know where everybody is starting from and "
      + "what you came for. It takes about five minutes."
    : "The last thing we will ask of you. These answers are how we find out whether this "
      + "programme did what it set out to do — and your certificate is waiting on it.";

  const created = await db.transaction(async (tx) => {
    const [form] = await tx
      .insert(programFormsTable)
      .values({ programId, stage, title, intro, draft: true })
      .returning({ id: programFormsTable.id });

    for (const q of standardQuestions(stage)) {
      await tx.insert(formQuestionsTable).values({
        formId: form.id,
        kind: q.kind,
        prompt: q.prompt,
        help: q.help,
        required: q.required,
        config: q.config,
        pairKey: q.pairKey,
        sortOrder: q.sortOrder,
        section: q.section,
      });
    }
    return form.id;
  });

  logger.info({ programId, stage, formId: created, by: user.id }, "Form created from the standard set");
  res.json({ programId, stage, formId: created, published: false });
});

/** Publish it to the cohort, or take it back to a draft. */
router.put("/admin/programs/:id/forms/:stage/published", async (req, res) => {
  const user = await getCurrentUser(req);
  const role = await currentRole(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!satisfiesRole(role, ["admin"])) { res.status(403).json({ error: "Forbidden" }); return; }

  const programId = Number(req.params.id);
  const stage = stageFrom(req.params.stage);
  if (!Number.isInteger(programId) || !stage) { res.status(400).json({ error: "That is not a form." }); return; }

  const [form] = await db
    .select()
    .from(programFormsTable)
    .where(and(eq(programFormsTable.programId, programId), eq(programFormsTable.stage, stage)));
  if (!form) { res.status(404).json({ error: "There is no form here yet." }); return; }

  const wantPublished = req.body?.published !== false;

  if (wantPublished) {
    // Checked at the door rather than left to be discovered by a learner. A
    // closing survey that cannot be filed withholds certificates.
    const problem = formProblem({ questions: await loadQuestions(form.id), title: form.title });
    if (problem) { res.status(400).json({ error: problem }); return; }
  }

  await db
    .update(programFormsTable)
    .set({
      draft: !wantPublished,
      postedAt: wantPublished ? (form.postedAt ?? new Date()) : null,
    })
    .where(eq(programFormsTable.id, form.id));

  logger.info({ programId, stage, published: wantPublished, by: user.id }, "Form publication changed");
  res.json({
    programId,
    stage,
    published: wantPublished,
    note: wantPublished
      ? stage === "after"
        ? "The closing survey is open. Certificates now wait on it, and every learner can see that "
          + "on their dashboard."
        : "The opening assessment is open to the cohort."
      : "Taken back to a draft. Nobody can see it, and it holds nothing up.",
  });
});

/**
 * What the cohort said.
 *
 * Names travel only to admins. A facilitator reading "what was weakest about
 * the programme" gets the answers and not the authors, which is the promise
 * that makes the question worth asking at all.
 */
router.get("/admin/programs/:id/forms/:stage/responses", async (req, res) => {
  const user = await getCurrentUser(req);
  const role = await currentRole(req);
  if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!satisfiesRole(role, ["instructor"])) { res.status(403).json({ error: "Forbidden" }); return; }

  const namesAllowed = satisfiesRole(role, ["admin"]);

  const programId = Number(req.params.id);
  const stage = stageFrom(req.params.stage);
  if (!Number.isInteger(programId) || !stage) { res.status(400).json({ error: "That is not a form." }); return; }

  const [form] = await db
    .select()
    .from(programFormsTable)
    .where(and(eq(programFormsTable.programId, programId), eq(programFormsTable.stage, stage)));
  if (!form) { res.status(404).json({ error: "There is no form here yet." }); return; }

  const questions = await loadQuestions(form.id);
  const responses = await db
    .select({
      id: formResponsesTable.id,
      userId: formResponsesTable.userId,
      submittedAt: formResponsesTable.submittedAt,
      name: usersTable.name,
      email: usersTable.email,
    })
    .from(formResponsesTable)
    .innerJoin(usersTable, eq(usersTable.id, formResponsesTable.userId))
    .where(eq(formResponsesTable.formId, form.id))
    .orderBy(asc(formResponsesTable.submittedAt));

  const answers = responses.length === 0 ? [] : await db
    .select()
    .from(formAnswersTable)
    .where(inArray(formAnswersTable.responseId, responses.map((r) => r.id)));

  const byResponse = new Map<number, typeof answers>();
  for (const a of answers) {
    const list = byResponse.get(a.responseId) ?? [];
    list.push(a);
    byResponse.set(a.responseId, list);
  }

  res.json({
    stage,
    title: form.title,
    namesShown: namesAllowed,
    questions: questions.map((q) => ({
      id: q.id, kind: q.kind, prompt: q.prompt, required: q.required,
      config: q.config, pairKey: q.pairKey, section: q.section,
    })),
    responses: responses.map((r) => ({
      // Withheld rather than sent and hidden in the browser. A name that
      // reaches the page is a name somebody can read.
      name: namesAllowed ? r.name : null,
      email: namesAllowed ? r.email : null,
      submittedAt: r.submittedAt.toISOString(),
      answers: (byResponse.get(r.id) ?? []).map((a) => ({
        questionId: a.questionId,
        number: a.number,
        text: a.text,
        choices: a.choices,
      })),
    })),
  });
});

export default router;
