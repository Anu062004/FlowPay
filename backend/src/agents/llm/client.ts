import { env } from "../../config/env.js";
import { openaiGenerateText } from "./openai.js";
import { anthropicGenerateText } from "./anthropic.js";
import { geminiGenerateText } from "./gemini.js";

export type LlmGenerateInput = {
  system: string;
  user: string;
  temperature?: number;
};

export type LlmClient = {
  generateText: (input: LlmGenerateInput) => Promise<string>;
};

export function createLlmClient(): LlmClient {
  if (env.LLM_PROVIDER === "anthropic") {
    return { generateText: anthropicGenerateText };
  }
  if (env.LLM_PROVIDER === "gemini") {
    return { generateText: geminiGenerateText };
  }
  return { generateText: openaiGenerateText };
}
