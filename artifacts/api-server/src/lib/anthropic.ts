import { logger } from "./logger";

/**
 * One way of asking Claude a question, for the whole server.
 *
 * There were two before this file: the coursework drafter, which called the
 * API over plain HTTP with a forced tool call, and a second client the
 * Simulation Studio arrived with, which read a different pair of environment
 * variables and **threw while being imported** if they were missing. That
 * second one would have taken the entire Lab down on the first deploy, not
 * just the studio: a module that throws at import time takes the process with
 * it, and nothing on Railway sets those variables.
 *
 * So: one key, `ANTHROPIC_API_KEY`, the one already configured; one model
 * setting; one timeout; and a failure that is *returned*, never thrown, so a
 * caller can decide what to tell the person waiting.
 *
 * The answer always comes back through a forced tool call rather than as JSON
 * inside prose. A model asked politely for "only JSON" will eventually add a
 * sentence of explanation, and the parse breaks in front of a cohort. Forcing
 * the tool makes the shape the model's only option.
 */

/**
 * Where the API lives.
 *
 * Overridable because the preview workspace reaches Claude through a proxy of
 * its own rather than through api.anthropic.com, and the alternative was two
 * clients again, which is how the last one ended up crashing the server. Unset
 * everywhere else, which is the normal case.
 */
function apiUrl(): string {
  const base = process.env.ANTHROPIC_BASE_URL?.trim().replace(/\/$/, "");
  return base ? `${base}/v1/messages` : "https://api.anthropic.com/v1/messages";
}

export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

/**
 * For the turns in the middle of a run, where waiting is the whole problem.
 *
 * Writing the scenario and writing the debrief are worth a few seconds: they
 * happen once each and they are the parts people read closely. The
 * development between two answers is different, because somebody is sitting
 * there watching for it, and a smaller model is markedly quicker.
 *
 * Defaults to the same model, so nothing changes unless it is set: a model
 * name that does not exist is a 404 in the middle of an exercise, and that is
 * not a thing to guess at on somebody else's live site.
 */
export const FAST_MODEL = process.env.ANTHROPIC_FAST_MODEL ?? MODEL;

/** Is there a key at all? Callers use this to stay quiet rather than fail loudly. */
export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export type ClaudeAnswer = { input: unknown } | { error: string };

export async function askClaude(args: {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
  timeoutMs?: number;
  /** Use the quicker model, for the calls somebody is waiting on. */
  fast?: boolean;
  /** What to call this in the logs when it goes wrong. */
  label: string;
}): Promise<ClaudeAnswer> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "No AI key is configured on the server." };

  const body = {
    model: args.fast ? FAST_MODEL : MODEL,
    max_tokens: args.maxTokens ?? 4000,
    system: args.system,
    tools: [{ name: args.toolName, description: args.toolDescription, input_schema: args.schema }],
    tool_choice: { type: "tool", name: args.toolName },
    messages: [{ role: "user", content: args.user }],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 120_000);

  try {
    const res = await fetch(apiUrl(), {
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
      // The detail goes to the logs only. It can quote the request back, and
      // the request contains the scenario.
      logger.error({ status: res.status, label: args.label, detail: detail.slice(0, 400) }, "Claude call failed");
      if (res.status === 401) return { error: "The AI key was rejected. Check ANTHROPIC_API_KEY." };
      if (res.status === 429) return { error: "The AI service is busy right now. Try again in a minute." };
      if (res.status === 529) return { error: "The AI service is overloaded right now. Try again in a minute." };
      return { error: `The AI service is unavailable right now (error ${res.status}).` };
    }

    const json = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
    const toolUse = json.content?.find((b) => b.type === "tool_use" && b.name === args.toolName);
    if (!toolUse?.input) return { error: "The AI replied in an unexpected shape. Try again." };

    return { input: toolUse.input };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { error: "The AI took too long to answer. Try again." };
    }
    logger.error({ err, label: args.label }, "Claude call threw");
    return { error: "Could not reach the AI service. Try again shortly." };
  } finally {
    clearTimeout(timer);
  }
}
