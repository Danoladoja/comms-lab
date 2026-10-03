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

/**
 * Which model the Lab asks for, when Railway does not say.
 *
 * This default was `claude-sonnet-4-5`, which Anthropic deprecated on
 * 30 September 2026 and stops serving on 30 November 2026. A model that is no
 * longer served is a 404, and a 404 here is not a degraded answer: the scenario
 * does not get written, the debrief does not get written, and the draft help on
 * a learner's task does not appear. One line in this file would have taken the
 * Studio down in front of a cohort, on a date nobody in the Lab had written
 * down.
 *
 * So the default moves forward, and `modelConcern` below says so out loud
 * rather than waiting for the outage. Railway's `ANTHROPIC_MODEL` still wins:
 * a deployment that pins a model keeps the model it pinned, which is the point
 * of pinning one.
 */
export const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";

/**
 * Models Anthropic has stopped serving, or has said when it will.
 *
 * Deliberately short and deliberately dated. This is not a catalogue and it
 * will go out of date; what it buys is that the two failures worth catching —
 * a model that already does not exist, and one with a date on it — are said in
 * the console by somebody who can change the setting, instead of arriving as
 * "error 404" in the middle of a live session.
 *
 * Checked at https://platform.claude.com/docs/en/about-claude/model-deprecations
 * on 3 October 2026.
 */
const MODEL_DATES: { readonly match: string; readonly retiresMs: number; readonly instead: string }[] = [
  { match: "claude-sonnet-4-5", retiresMs: Date.UTC(2026, 10, 30), instead: "claude-sonnet-5-5" },
  { match: "claude-opus-4-1", retiresMs: Date.UTC(2026, 7, 5), instead: "claude-opus-5-5" },
  { match: "claude-sonnet-4-20", retiresMs: Date.UTC(2026, 5, 15), instead: "claude-sonnet-5-5" },
  { match: "claude-opus-4-20", retiresMs: Date.UTC(2026, 5, 15), instead: "claude-opus-5-5" },
  { match: "claude-3-haiku", retiresMs: Date.UTC(2026, 3, 20), instead: "claude-haiku-4-5" },
  { match: "claude-3-5-haiku", retiresMs: Date.UTC(2026, 1, 19), instead: "claude-haiku-4-5" },
  { match: "claude-3-7-sonnet", retiresMs: Date.UTC(2026, 1, 19), instead: "claude-sonnet-5-5" },
  { match: "claude-3-5-sonnet", retiresMs: Date.UTC(2025, 9, 28), instead: "claude-sonnet-5-5" },
  { match: "claude-3-opus", retiresMs: Date.UTC(2026, 0, 5), instead: "claude-opus-5-5" },
];

/** When a date matters, in the way a person writes it. */
function onThe(ms: number): string {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Anything worth saying about the model this server is configured to ask for.
 *
 * Pure, so it can be tested without a network or an environment, and read by
 * both the startup log and the admin console.
 */
export function modelConcern(model: string, nowMs: number): string | null {
  const known = MODEL_DATES.find((m) => model.startsWith(m.match));
  if (!known) return null;
  if (nowMs >= known.retiresMs) {
    return `The AI model this server asks for, ${model}, stopped being served on ${onThe(known.retiresMs)}. `
      + `Every AI feature in the Lab will fail until ANTHROPIC_MODEL is changed — ${known.instead} replaces it.`;
  }
  return `The AI model this server asks for, ${model}, stops being served on ${onThe(known.retiresMs)}. `
    + `Change ANTHROPIC_MODEL to ${known.instead} before then, or every AI feature in the Lab will stop.`;
}

/** What an admin can be told about the AI, without being told the key. */
export function aiStatus(nowMs = Date.now()): {
  configured: boolean; model: string; fastModel: string; concern: string | null;
} {
  return {
    configured: anthropicConfigured(),
    model: MODEL,
    fastModel: FAST_MODEL,
    concern: modelConcern(MODEL, nowMs) ?? modelConcern(FAST_MODEL, nowMs),
  };
}

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
  // Timed, because "it never came back" and "it took fifty seconds" are
  // different faults with different fixes, and from outside the server they
  // look identical. One line per call, with the model on it, so a slow model
  // and a rejected model name can be told apart at a glance.
  const startedAt = Date.now();

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
      logger.error({
        status: res.status, label: args.label, model: body.model,
        ms: Date.now() - startedAt, detail: detail.slice(0, 400),
      }, "Claude call failed");
      if (res.status === 401) return { error: "The AI key was rejected. Check ANTHROPIC_API_KEY." };
      if (res.status === 429) return { error: "The AI service is busy right now. Try again in a minute." };
      if (res.status === 529) return { error: "The AI service is overloaded right now. Try again in a minute." };
      return { error: `The AI service is unavailable right now (error ${res.status}).` };
    }

    const json = (await res.json()) as {
      content?: { type: string; name?: string; input?: unknown }[];
      stop_reason?: string;
      usage?: { output_tokens?: number };
    };

    logger.info(
      {
        label: args.label, model: body.model, ms: Date.now() - startedAt,
        stop: json.stop_reason, out: json.usage?.output_tokens, cap: body.max_tokens,
      },
      "Claude call finished",
    );

    /*
      It ran out of room, and the answer is a sentence cut in half.

      This was invisible. A reply stopped at the token ceiling still comes back
      200, still has a tool_use block on it, and still has an `input` — just an
      incomplete one, because the JSON was being written when the budget ran
      out. So a truncated answer reached the validators looking like a bad
      answer, and was reported as one: "the plan came back with no objectives",
      when what actually happened was that the plan came back with no room.

      Checked before the shape, because "it did not fit" explains the shape and
      the shape explains nothing.
    */
    if (json.stop_reason === "max_tokens") {
      logger.error(
        { label: args.label, model: body.model, cap: body.max_tokens, out: json.usage?.output_tokens },
        "Claude call hit the token ceiling",
      );
      return { error: "The AI ran out of room before it finished writing. Try again, and if it keeps happening the limit for this step is too low." };
    }

    const toolUse = json.content?.find((b) => b.type === "tool_use" && b.name === args.toolName);
    if (!toolUse?.input) return { error: "The AI replied in an unexpected shape. Try again." };

    return { input: toolUse.input };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.error(
        { label: args.label, model: body.model, ms: Date.now() - startedAt },
        "Claude call timed out",
      );
      return { error: "The AI took too long to answer. Try again." };
    }
    logger.error({ err, label: args.label, model: body.model, ms: Date.now() - startedAt }, "Claude call threw");
    return { error: "Could not reach the AI service. Try again shortly." };
  } finally {
    clearTimeout(timer);
  }
}
