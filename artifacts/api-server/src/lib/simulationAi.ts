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
    // Four stakeholder groups, each with a confidential brief of up to two
    // thousand characters, plus the opening situation, the first development,
    // the dimensions and the debrief questions. Six thousand was close enough
    // to the edge to matter.
    maxTokens: 8000,
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

/**
 * How many times to ask for the running order before giving up.
 *
 * A model's reply is not deterministic, and the shapes that this one comes
 * back in are not all usable: an empty list where there should be four
 * objectives, the objectives written out as prose, a field under a name the
 * schema did not ask for. Each of those reached an admin as a refusal and a
 * button to press again — so the Lab was asking a person to do, by hand and
 * without being told that was what they were doing, the one thing it could
 * perfectly well do itself.
 *
 * Three, because the second attempt usually lands and the third is for the day
 * it does not. The ceiling matters: this is a paid call, and a loop with no end
 * on it is a bill nobody can explain.
 */
const PLAN_ATTEMPTS = 3;

/** Plan a group session: what it tests, and what happens when. */
export async function generateGroupPlan(args: {
  openingBrief: string;
  teams: readonly { id: string; name: string; roleName: string }[];
  objective: string;
  durationMinutes: number;
  programme?: StudioProgrammeContext | null;
}): Promise<AiResult<ValidatedGroupPlan>> {
  let lastProblem = "";

  for (let attempt = 1; attempt <= PLAN_ATTEMPTS; attempt += 1) {
    const result = await onePlanAttempt(args, attempt);
    if (result.ok) return result;
    // A failure that asking again cannot mend: no key, a rejected key, a model
    // that is not served any more, a timeout. Pressing on would spend three
    // calls to say the same thing three times.
    if (result.fatal) return { ok: false, error: result.error };
    lastProblem = result.error;
  }

  return {
    ok: false,
    error: `${lastProblem} Asked ${PLAN_ATTEMPTS} times and it came back unusable each time.`,
  };
}

/** Whether asking the same question again could plausibly answer it. */
function worthAskingAgain(error: string): boolean {
  return !/key|no longer|unavailable|busy|overloaded|took too long|could not reach/i.test(error);
}

async function onePlanAttempt(args: {
  openingBrief: string;
  teams: readonly { id: string; name: string; roleName: string }[];
  objective: string;
  durationMinutes: number;
  programme?: StudioProgrammeContext | null;
}, attempt: number): Promise<{ ok: true; value: ValidatedGroupPlan } | { ok: false; error: string; fatal: boolean }> {
  const answer = await askClaude({
    system: groupPlanSystemPrompt(),
    user: groupPlanUserPrompt(args),
    toolName: "submit_plan",
    toolDescription: "Return the objectives and the running order.",
    schema: groupPlanSchema(),
    // Up to five objectives with notes and ten beats, each with a title, what
    // it says and what it asks for. Four thousand was the tightest ceiling of
    // any call here and the only one behind a button an admin presses; a reply
    // that does not fit comes back half-written, which read as a bad plan
    // rather than as a plan with nowhere to go. A ceiling is a cap, not a
    // spend: raising it costs nothing on the replies that already fitted.
    maxTokens: 8000,
    label: `studio-group-plan-${attempt}`,
  });
  if ("error" in answer) {
    return { ok: false, error: answer.error, fatal: !worthAskingAgain(answer.error) };
  }

  const { plan, problem } = validateGroupPlan(answer.input, args.durationMinutes);
  if (!plan) return { ok: false, error: problem, fatal: false };
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
