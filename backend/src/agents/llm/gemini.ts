import { env } from "../../config/env.js";

const geminiFallbackModels = ["gemini-2.5-flash"];

function isMissingModelError(data: any) {
  const status = typeof data?.error?.status === "string" ? data.error.status.toUpperCase() : "";
  const message = typeof data?.error?.message === "string" ? data.error.message.toLowerCase() : "";
  return status === "NOT_FOUND" || message.includes("is not found");
}

async function requestGeminiText(model: string, body: Record<string, unknown>, apiKey: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  return { response, data };
}

function extractGeminiText(data: any): string {
  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .map((part: any) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Gemini response missing text");
  }

  return text;
}

export async function geminiGenerateText({
  system,
  user,
  temperature,
  maxOutputTokens
}: {
  system: string;
  user: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini");
  }
  const apiKey = env.GEMINI_API_KEY;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: `${system}\n\n${user}` }]
      }
    ],
    generationConfig: {
      temperature,
      maxOutputTokens
    }
  };

  const models = Array.from(new Set([env.GEMINI_MODEL, ...geminiFallbackModels].filter(Boolean)));
  let lastError: Error | null = null;

  for (const [index, model] of models.entries()) {
    const { response, data } = await requestGeminiText(model, body, apiKey);
    if (response.ok) {
      return extractGeminiText(data);
    }

    const error = new Error(`Gemini error: ${JSON.stringify(data)}`);
    lastError = error;

    if (isMissingModelError(data) && index < models.length - 1) {
      console.warn(`[Gemini] Model "${model}" is unavailable. Falling back to "${models[index + 1]}".`);
      continue;
    }

    throw error;
  }

  throw lastError ?? new Error("Gemini request failed");
}
