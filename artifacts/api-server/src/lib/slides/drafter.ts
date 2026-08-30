import {
  draftSystemPrompt,
  draftUserPrompt,
  draftResponseSchema,
  questionsSystemPrompt,
  questionsResponseSchema,
  replaceQuestionUserPrompt,
  moreQuestionsUserPrompt,
  validateDraft,
  validateQuestions,
  readNotes,
  clampWanted,
  type CourseworkDraft,
  type DraftQuestion,
} from "@workspace/domain";
import { logger } from "../logger";

/**
 * Asking Claude for a first draft of a module's coursework, and for the two
 * smaller favours that follow: redo that question, and give me a few more.
 *
 * Called straight over HTTP rather than through the SDK: these are single
 * requests with no streaming, and the server already talks to Google the same
 * way.
 *
 * The model is made to answer through a tool call rather than by writing JSON
 * into prose, because a model asked for "JSON only" will eventually wrap it in
 * an explanation and break the parse at the worst moment. Whatever comes back is
 * still checked before anyone sees it.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 120_000;

export function drafterConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

type ClassContext = {
  programTitle: string;
  sessionTitle: string;
  sessionDescription: string;
  sourceText: string;
};

type ExistingQuestion = { prompt: string; options: string[] };

export type DraftResult = {
  draft: CourseworkDraft | null;
  problems: string[];
};

export type QuestionsResult = {
  questions: DraftQuestion[];
  problems: string[];
  notes: string[];
};

/** The whole thing: a quiz and a written task. */
export async function draftCoursework(args: ClassContext): Promise<DraftResult> {
  const answer = await ask({
    system: draftSystemPrompt(),
    user: draftUserPrompt(args),
    toolName: "submit_coursework",
    toolDescription: "Return the drafted quiz and written task for this class.",
    schema: draftResponseSchema(),
  });

  if ("error" in answer) return { draft: null, problems: [answer.error] };
  return validateDraft(answer.input);
}

/**
 * One replacement for the question at `replaceIndex`.
 *
 * The existing questions come from the editor rather than the database, so a
 * facilitator who has just reworded three questions without saving still gets a
 * replacement that does not collide with them.
 */
export async function replaceQuestion(args: ClassContext & {
  existing: ExistingQuestion[];
  replaceIndex: number;
  guidance?: string;
}): Promise<QuestionsResult> {
  // The question being replaced is not counted as a duplicate to avoid — the
  // whole point is to write something instead of it.
  const keep = args.existing.filter((_, i) => i !== args.replaceIndex);

  const answer = await ask({
    system: questionsSystemPrompt(),
    user: replaceQuestionUserPrompt(args),
    toolName: "submit_questions",
    toolDescription: "Return the replacement quiz question.",
    schema: questionsResponseSchema(1, 1),
  });

  if ("error" in answer) return { questions: [], problems: [answer.error], notes: [] };

  const data = (answer.input ?? {}) as Record<string, unknown>;
  const { questions, problems } = validateQuestions(data.questions, {
    existingPrompts: keep.map((q) => q.prompt),
  });

  return {
    questions: questions.slice(0, 1),
    problems: questions.length === 0 && problems.length === 0
      ? ["Nothing usable came back. Try again."]
      : problems,
    notes: readNotes(data.notes),
  };
}

/** A few more questions, covering ground the quiz does not. */
export async function moreQuestions(args: ClassContext & {
  existing: ExistingQuestion[];
  wanted: number;
  guidance?: string;
}): Promise<QuestionsResult> {
  // Blank rows a facilitator added and has not filled in are not questions, so
  // they must not eat into the room left on the quiz.
  const written = args.existing.filter((q) => q.prompt.trim()).length;
  const wanted = clampWanted(args.wanted, written);

  const answer = await ask({
    system: questionsSystemPrompt(),
    user: moreQuestionsUserPrompt({ ...args, wanted }),
    toolName: "submit_questions",
    toolDescription: "Return the further quiz questions.",
    schema: questionsResponseSchema(1, wanted),
  });

  if ("error" in answer) return { questions: [], problems: [answer.error], notes: [] };

  const data = (answer.input ?? {}) as Record<string, unknown>;
  const { questions, problems } = validateQuestions(data.questions, {
    existingPrompts: args.existing.map((q) => q.prompt),
  });

  const trimmed = questions.slice(0, wanted);
  if (trimmed.length === 0 && problems.length === 0) {
    problems.push("Nothing usable came back. Try again.");
  } else if (trimmed.length < wanted) {
    problems.push(
      `Asked for ${wanted}, kept ${trimmed.length} — the rest repeated questions already on the quiz.`,
    );
  }

  return { questions: trimmed, problems, notes: readNotes(data.notes) };
}

/* ------------------------------------------------------------------ */

type Answer = { input: unknown } | { error: string };

/**
 * One forced-tool request, with the error messages a facilitator can act on.
 *
 * Every failure returns something a person could do next — check the key, wait a
 * minute, shorten the material — rather than a status code.
 */
async function ask(args: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
}): Promise<Answer> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "No AI key is configured on the server." };

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: args.system,
    tools: [{ name: args.toolName, description: args.toolDescription, input_schema: args.schema }],
    // Force the tool: the answer must arrive as data, not prose.
    tool_choice: { type: "tool", name: args.toolName },
    messages: [{ role: "user", content: args.user }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text();
      logger.error({ status: res.status, detail: detail.slice(0, 400) }, "Coursework drafting failed");
      if (res.status === 401) return { error: "The AI key was rejected. Check ANTHROPIC_API_KEY." };
      if (res.status === 429) return { error: "The AI service is rate limited right now. Try again in a minute." };
      return { error: `The drafter is unavailable right now (error ${res.status}).` };
    }

    const json = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
    const toolUse = json.content?.find((b) => b.type === "tool_use" && b.name === args.toolName);
    if (!toolUse?.input) return { error: "The drafter replied in an unexpected shape. Try again." };

    return { input: toolUse.input };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "The drafter took too long. Try again, or with less material." };
    }
    logger.error({ err }, "Coursework drafting threw");
    return { error: "Could not reach the drafter. Try again shortly." };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tidy the questions the editor sent, keeping their positions.
 *
 * Positions must survive: `replaceIndex` counts into this same list, so dropping
 * a half-typed question here would redo the wrong one.
 */
export function normaliseExisting(raw: { prompt?: string; options?: string[] }[]): ExistingQuestion[] {
  return raw.map((q) => ({
    prompt: (q.prompt ?? "").trim(),
    options: (q.options ?? []).map((o) => (o ?? "").trim()).filter(Boolean),
  }));
}
