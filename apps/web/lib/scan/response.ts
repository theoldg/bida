import type { ScanResult } from "@hajsik/core";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** Unwraps Gemini's response envelope and reshapes the JSON we asked for. */
export function parseScanResponse(json: unknown): ScanResult {
  const text = (json as GeminiResponse).candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("parseScanResponse: no text in response");

  const parsed = JSON.parse(text) as Partial<ScanResult>;
  return {
    merchant: parsed.merchant ?? null,
    total: parsed.total ?? null,
    currency: parsed.currency ?? null,
    date: parsed.date ?? null,
    category: parsed.category ?? null,
  };
}
