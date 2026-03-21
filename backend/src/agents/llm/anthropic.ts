import { env } from "../../config/env.js";

export async function anthropicGenerateText({
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
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL,
      max_tokens: maxOutputTokens ?? 512,
      temperature,
      system,
      messages: [{ role: "user", content: user }]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Anthropic error: ${JSON.stringify(data)}`);
  }

  const parts = Array.isArray(data.content) ? data.content : [];
  const text = parts
    .map((part: any) => (typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Anthropic response missing text");
  }

  return text;
}
