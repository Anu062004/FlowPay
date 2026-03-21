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

function isOpenAiRateLimitError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("insufficient_quota") ||
    message.includes("rate_limit_exceeded") ||
    message.includes("\"code\":\"429\"") ||
    message.includes("status code 429") ||
    message.includes("\"status\":429")
  );
}

export function createLlmClient(): LlmClient {
  return {
    generateText: async (input) => {
      const provider = input.providerOverride ?? env.LLM_PROVIDER;
      if (provider === "anthropic") {
        return anthropicGenerateText(input);
      }
      if (provider === "gemini") {
        return geminiGenerateText(input);
      }

      try {
        return await openaiGenerateText(input);
      } catch (error) {
        if (!isOpenAiRateLimitError(error) || !env.GEMINI_API_KEY) {
          throw error;
        }

        console.warn("[LLM] OpenAI rate limit or quota hit. Falling back to Gemini.");
        return geminiGenerateText({
          system: input.system,
          user: input.user,
          temperature: input.temperature,
          maxOutputTokens: input.maxOutputTokens,
          modelOverride: env.GEMINI_MODEL,
          apiKeyOverride: env.GEMINI_API_KEY
        });
      }
    }
  };
}
