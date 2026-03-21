import { env } from "../../config/env.js";
import { openaiGenerateText } from "./openai.js";
import { anthropicGenerateText } from "./anthropic.js";
import { geminiGenerateText } from "./gemini.js";

export type LlmProvider = "openai" | "anthropic" | "gemini";

export type LlmGenerateInput = {
  system: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
  providerOverride?: LlmProvider;
  modelOverride?: string;
  apiKeyOverride?: string;
};

export type LlmClient = {
  generateText: (input: LlmGenerateInput) => Promise<string>;
};

export function createLlmClient(): LlmClient {
  return {
    generateText: (input) => {
      const provider = input.providerOverride ?? env.LLM_PROVIDER;
      if (provider === "anthropic") {
        return anthropicGenerateText(input);
      }
      if (provider === "gemini") {
        return geminiGenerateText(input);
      }
      return openaiGenerateText(input);
    }
  };
}
