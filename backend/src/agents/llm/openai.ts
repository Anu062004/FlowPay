import { env } from "../../config/env.js";

export async function openaiGenerateText({
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
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL,
      instructions: system,
      input: user,
      temperature,
      max_output_tokens: maxOutputTokens
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`OpenAI error: ${JSON.stringify(data)}`);
  }

  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  const output = Array.isArray(data.output) ? data.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content?.type === "output_text" && typeof content.text === "string") {
          chunks.push(content.text);
        }
        if (content?.type === "text" && typeof content.text === "string") {
          chunks.push(content.text);
        }
      }
    }
  }

  if (chunks.length === 0) {
    throw new Error("OpenAI response missing output text");
  }

  return chunks.join("\n").trim();
}
