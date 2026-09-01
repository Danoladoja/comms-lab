import { anthropic } from "@workspace/integrations-anthropic-ai";
import { z } from "zod/v4";

const groupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  roleName: z.string().min(1),
  confidentialBrief: z.string(),
});
export const developmentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  content: z.string(),
  responsePrompt: z.string(),
});
const scenarioSchema = z.object({
  title: z.string().min(1),
  openingBrief: z.string().min(1),
  stakeholderGroups: z.array(groupSchema).min(1),
  initialDevelopment: developmentSchema,
  evaluationDimensions: z.array(z.object({ name: z.string().min(1), description: z.string().min(1) })).min(1),
  debriefQuestions: z.array(z.string().min(1)).min(1),
});
const debriefSchema = z.object({
  score: z.number().int().min(0).max(100),
  strengths: z.array(z.string()),
  risks: z.array(z.string()),
  stakeholderImpact: z.string(),
  recommendations: z.array(z.string()),
});

export type GeneratedScenario = z.infer<typeof scenarioSchema>;
export type GeneratedDevelopment = z.infer<typeof developmentSchema>;
export type GeneratedDebrief = z.infer<typeof debriefSchema>;

async function jsonCompletion(prompt: string): Promise<unknown> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8192,
    messages: [{ role: "user", content: `${prompt}\nReturn only valid JSON, with no markdown or explanation.` }],
  });
  const text = message.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("AI returned no text response");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AI returned invalid JSON");
  }
}

export async function generateScenario(brief: {
  sectorTopic: string; objective: string; difficulty: string; durationMinutes: number; participantPerspective: string; mode: string;
}): Promise<GeneratedScenario> {
  const result = await jsonCompletion(`Create a realistic, safe professional simulation scenario. Launch brief: ${JSON.stringify(brief)}.
Required JSON shape: {"title":string,"openingBrief":string,"stakeholderGroups":[{"id":string,"name":string,"roleName":string,"confidentialBrief":string}],"initialDevelopment":{"id":string,"title":string,"content":string,"responsePrompt":string},"evaluationDimensions":[{"name":string,"description":string}],"debriefQuestions":[string]}.`);
  return scenarioSchema.parse(result);
}

export async function generateDevelopment(input: {
  openingBrief: string; currentDevelopment: GeneratedDevelopment; latestResponse: string; perspective: string;
}): Promise<GeneratedDevelopment> {
  const result = await jsonCompletion(`Advance this simulation realistically based on the participant response. Do not include confidential information for other roles.
${JSON.stringify(input)}
Required JSON shape: {"id":string,"title":string,"content":string,"responsePrompt":string}.`);
  return developmentSchema.parse(result);
}

export async function generateDebrief(input: unknown): Promise<GeneratedDebrief> {
  const result = await jsonCompletion(`Evaluate this completed simulation against its evaluation dimensions. Be specific, constructive and grounded only in the supplied data.
${JSON.stringify(input)}
Required JSON shape: {"score":integer 0-100,"strengths":[string],"risks":[string],"stakeholderImpact":string,"recommendations":[string]}.`);
  return debriefSchema.parse(result);
}