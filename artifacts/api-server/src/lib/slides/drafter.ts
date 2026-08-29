import {
  draftSystemPrompt,
  draftUserPrompt,
  draftResponseSchema,
  validateDraft,
  type CourseworkDraft,
} from "@workspace/domain";
import { logger } from "../logger";

/**
 * Asking Claude for a first draft of a module's coursework.
 *
 * Called straight over HTTP rather than through the SDK: this is one endpoint
 * with no streaming and no tool use, and the server already talks to Google the
 * same way.
 *
 * The model is made to answer through a tool call rather than by writing JSON
 * into prose, because a model asked for "JSON only" will eventually wrap it in
 * an explanation and break the parse at the worst moment. Whatever comes back is
 * still checked by validateDraft before anyone sees it.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
const MAX_TOKENS = 4000;
const TIMEOUT_MS = 120_000;

export function drafterConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export type DraftResult = {
  draft: CourseworkDraft | null;
  problems: string[];
};

export async function draftCoursework(args: {
  programTitle: string;
  sessionTitle: string;
  sessionDescription: string;
  slideText: string;
}): Promise<DraftResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { draft: null, problems: ["No AI key is configured on the server."] };
  }

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: draftSystemPrompt(),
    tools: [
      {
        name: "submit_coursework",
        description: "Return the drafted quiz and written task for this class.",
        input_schema: draftResponseSchema(),
      },
    ],
    // Force the tool: the answer must arrive as data, not prose.
    tool_choice: { type: "tool", name: "submit_coursework" },
    messages: [{ role: "user", content: draftUserPrompt(args) }],
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
      // The message a facilitator sees should tell them what to do next.
      if (res.status === 401) return { draft: null, problems: ["The AI key was rejected. Check ANTHROPIC_API_KEY."] };
      if (res.status === 429) return { draft: null, problems: ["The AI service is rate limited right now. Try again in a minute."] };
      return { draft: null, problems: [`The drafter is unavailable right now (error ${res.status}).`] };
    }

    const json = (await res.json()) as {
      content?: { type: string; name?: string; input?: unknown }[];
    };

    const toolUse = json.content?.find((block) => block.type === "tool_use" && block.name === "submit_coursework");
    if (!toolUse?.input) {
      return { draft: null, problems: ["The drafter replied in an unexpected shape. Try again."] };
    }

    return validateDraft(toolUse.input);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { draft: null, problems: ["The drafter took too long. Try again, or with a shorter deck."] };
    }
    logger.error({ err }, "Coursework drafting threw");
    return { draft: null, problems: ["Could not reach the drafter. Try again shortly."] };
  } finally {
    clearTimeout(timer);
  }
}
