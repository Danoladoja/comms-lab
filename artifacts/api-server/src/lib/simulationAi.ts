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
  groupPlanSystemPrompt,
  groupPlanUserPrompt,
  groupPlanSchema,
  validateGroupPlan,
  type ValidatedGroupPlan,
  type StudioProgrammeContext,
  teamBeatUserPrompt,
  sessionDebriefSystemPrompt,
  sessionDebriefUserPrompt,
  sessionDebriefSchema,
  validateSessionDebrief,
  type SessionDebrief,
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

/** Plan a group session: what it tests, and what happens when. */
export async function generateGroupPlan(args: {
  openingBrief: string;
  teams: readonly { id: string; name: string; roleName: string }[];
  objective: string;
  durationMinutes: number;
  programme?: StudioProgrammeContext | null;
}): Promise<AiResult<ValidatedGroupPlan>> {
  const answer = await askClaude({
    system: groupPlanSystemPrompt(),
    user: groupPlanUserPrompt(args),
    toolName: "submit_plan",
    toolDescription: "Return the objectives and the running order.",
    schema: groupPlanSchema(),
    maxTokens: 4000,
    label: "studio-group-plan",
  });
  if ("error" in answer) return { ok: false, error: answer.error };

  const { plan, problem } = validateGroupPlan(answer.input, args.durationMinutes);
  if (!plan) return { ok: false, error: problem };
  return { ok: true, value: plan };
}

/** Write what actually reaches one team, from what they and the others did. */
export async function generateTeamBeat(
  args: Parameters<typeof teamBeatUserPrompt>[0] & { beatId: string },
): Promise<AiResult<ValidatedDevelopment>> {
  const answer = await askClaude({
    system: developmentSystemPrompt(),
    user: teamBeatUserPrompt(args),
    toolName: "submit_development",
    toolDescription: "Return what reaches this team.",
    schema: developmentSchema(),
    maxTokens: 1200,
    fast: true,
    timeoutMs: 60_000,
    label: "studio-team-beat",
  });
  if ("error" in answer) return { ok: false, error: answer.error };

  // The beat's own id, so the ticker's record of what it has delivered matches
  // what is on the table. A generated id here would let the same beat fire on
  // every pass, because the session would never recognise it as delivered.
  const development = validateDevelopment(answer.input, args.beatId);
  if (!development) return { ok: false, error: "The development came back unusable." };
  return { ok: true, value: development };
}

/** The facilitator's debrief, across every team. */
export async function generateSessionDebrief(
  args: Parameters<typeof sessionDebriefUserPrompt>[0],
): Promise<AiResult<SessionDebrief>> {
  const answer = await askClaude({
    system: sessionDebriefSystemPrompt(),
    user: sessionDebriefUserPrompt(args),
    toolName: "submit_session_debrief",
    toolDescription: "Return the debrief for the whole session.",
    schema: sessionDebriefSchema(),
    maxTokens: 3000,
    label: "studio-session-debrief",
  });
  if ("error" in answer) return { ok: false, error: answer.error };

  const debrief = validateSessionDebrief(answer.input);
  if (!debrief) return { ok: false, error: "The session debrief came back unusable." };
  return { ok: true, value: debrief };
}
