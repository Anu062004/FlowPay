import { env } from "../../config/env.js";

export async function geminiGenerateText({
  system,
  user,
  temperature
}: {
  system: string;
  user: string;
  temperature?: number;
}): Promise<string> {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required when LLM_PROVIDER=gemini");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${system}\n\n${user}` }]
        }
      ],
      generationConfig: {
        temperature
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini error: ${JSON.stringify(data)}`);
  }

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
