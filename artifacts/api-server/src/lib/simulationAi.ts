import {
  debriefSchema,
  debriefSystemPrompt,
  debriefUserPrompt,
  developmentSchema,
  developmentSystemPrompt,
  developmentUserPrompt,
  scenarioSchema,
  scenarioSystemPrompt,
  scenarioUserPrompt,
  validateDebrief,
  validateDevelopment,
  validateScenario,
  type StudioBrief,
  type ValidatedDebrief,
  type ValidatedDevelopment,
  type ValidatedScenario,
} from "@workspace/domain";
import { anthropicConfigured, askClaude } from "./anthropic";

/**
 * The three things the Studio asks Claude for: write me an exercise, tell me
 * what happens next, and tell me how I did.
 *
 * Nothing here throws. Each call returns either the thing or the reason there
 * is no thing, because the caller is a route with somebody sitting in front of
 * it, and "AI generation failed" is not a sentence that helps them decide
 * whether to press the button again.
 *
 * The prompts and the checking both live in @workspace/domain, next to the
 * rules and under test. This file is only the wiring.
 */

export type AiResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function simulationAiConfigured(): boolean {
  return anthropicConfigured();
}

export async function generateScenario(brief: StudioBrief): Promise<AiResult<ValidatedScenario>> {
  const answer = await askClaude({
    system: scenarioSystemPrompt(),
    user: scenarioUserPrompt(brief),
    toolName: "submit_scenario",
    toolDescription: "Return the exercise you have written.",
    schema: scenarioSchema(),
    maxTokens: 6000,
    label: "studio-scenario",
  });
  if ("error" in answer) return { ok: false, error: answer.error };

  const { scenario, problem } = validateScenario(answer.input);
  if (!scenario) return { ok: false, error: problem ?? "The exercise came back unusable. Try again." };
  return { ok: true, value: scenario };
}

export async function generateDevelopment(input: {
  openingBrief: string;
  history: { title: string; content: string; response: string | null }[];
  latestResponse: string;
  perspective: string;
  /** Used only to name the new development when the model forgets to. */
  turn: number;
}): Promise<AiResult<ValidatedDevelopment>> {
  const answer = await askClaude({
    system: developmentSystemPrompt(),
    user: developmentUserPrompt(input),
    toolName: "submit_development",
    toolDescription: "Return the next thing that happens.",
    schema: developmentSchema(),
    maxTokens: 1200,
    // Somebody is watching a spinner for this one.
    fast: true,
    timeoutMs: 60_000,
    label: "studio-development",
  });
  if ("error" in answer) return { ok: false, error: answer.error };

  const development = validateDevelopment(answer.input, `turn-${input.turn}`);
  if (!development) return { ok: false, error: "The next development came back unusable. Try again." };
  return { ok: true, value: development };
}

export async function generateDebrief(input: {
  openingBrief: string;
  evaluationDimensions: { name: string; description: string }[];
  debriefQuestions: string[];
  history: { title: string; content: string; response: string | null }[];
}): Promise<AiResult<ValidatedDebrief>> {
  const answer = await askClaude({
    system: debriefSystemPrompt(),
    user: debriefUserPrompt(input),
    toolName: "submit_debrief",
    toolDescription: "Return the debrief for this run.",
    schema: debriefSchema(),
    maxTokens: 3000,
    label: "studio-debrief",
  });
  if ("error" in answer) return { ok: false, error: answer.error };

  const debrief = validateDebrief(answer.input);
  if (!debrief) return { ok: false, error: "The debrief came back unusable. Try again." };
  return { ok: true, value: debrief };
}
