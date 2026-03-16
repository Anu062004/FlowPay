import { z } from "zod";
import { createLlmClient } from "./llm/client.js";

export type OpenClawTask<T> = {
  name: string;
  systemPrompt: string;
  userPrompt: (input: unknown) => string;
  schema: z.ZodSchema<T>;
  temperature?: number;
};

const llm = createLlmClient();

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed);
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(match[0]);
}

export async function runOpenClawTask<T>(task: OpenClawTask<T>, input: unknown): Promise<T> {
  const responseText = await llm.generateText({
    system: task.systemPrompt,
    user: task.userPrompt(input),
    temperature: task.temperature ?? 0.2
  });

  const parsed = extractJson(responseText);
  return task.schema.parse(parsed);
}
