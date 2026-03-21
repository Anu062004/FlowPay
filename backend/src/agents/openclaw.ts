import { z } from "zod";
import { createLlmClient } from "./llm/client.js";

export type OpenClawTask<T> = {
  name: string;
  systemPrompt: string;
  userPrompt: (input: unknown) => string;
  schema: z.ZodSchema<T>;
  temperature?: number;
  maxRetries?: number;
  maxOutputTokens?: number;
};

const llm = createLlmClient();

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  
  // 1. Check if the entire response is a JSON object
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      // ignore and continue to more robust extraction
    }
  }

  // 2. Try to find JSON inside markdown blocks
  const markdownMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (markdownMatch) {
    try {
      return JSON.parse(markdownMatch[1]);
    } catch (e) {
      // ignore
    }
  }

  // 3. Fallback to finding the first { and last }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`No JSON object found in model response: ${text.slice(0, 100)}...`);
  }
  
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`Failed to parse extracted JSON: ${e instanceof Error ? e.message : String(e)}. Raw match: ${match[0].slice(0, 100)}...`);
  }
}

export async function runOpenClawTask<T>(task: OpenClawTask<T>, input: unknown): Promise<T> {
  const maxRetries = task.maxRetries ?? 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        console.warn(`[OpenClaw] Retrying task "${task.name}" (attempt ${attempt}/${maxRetries})...`);
      }

      const responseText = await llm.generateText({
        system: task.systemPrompt,
        user: task.userPrompt(input),
        temperature: task.temperature ?? 0.2,
        maxOutputTokens: task.maxOutputTokens
      });

      const parsed = extractJson(responseText);
      const validated = task.schema.parse(parsed);
      
      return validated;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[OpenClaw] Task "${task.name}" failed on attempt ${attempt}:`, lastError.message);
      
      // If it's a validation error, we might want to adjust the prompt or just retry
      if (attempt === maxRetries) {
        throw lastError;
      }
      
      // Small delay before retry
      await new Promise(resolve => setTimeout(resolve, 500 * attempt));
    }
  }

  throw lastError || new Error(`Task "${task.name}" failed after ${maxRetries} retries`);
}
