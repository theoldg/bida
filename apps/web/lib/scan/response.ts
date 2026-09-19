import type { ScanResult } from "@bida/core";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/** Unwraps Gemini's response envelope and reshapes the JSON we asked for. */
export function parseScanResponse(json: unknown): ScanResult {
  const text = (json as GeminiResponse).candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("parseScanResponse: no text in response");

  const parsed = JSON.parse(text) as Partial<ScanResult>;
  return {
    title: parsed.title ?? null,
    total: parsed.total ?? null,
    tip: parsed.tip ?? null,
    tax: parsed.tax ?? null,
    discounts: (parsed.discounts ?? []).map((d) => ({ ...d, labelEn: d.labelEn ?? null })),
    currency: parsed.currency ?? null,
    date: parsed.date ?? null,
    // `amount` and `unitAmount` are a pair of maybes now — a bill states one or
    // the other — so neither may arrive as undefined and be read as "absent"
    // by something that only checked for null (`lineMinor`).
    lineItems: (parsed.lineItems ?? []).map((li) => ({
      ...li,
      amount: li.amount ?? null,
      unitAmount: li.unitAmount ?? null,
      quantity: li.quantity ?? null,
    })),
    error: parsed.error ?? null,
  };
}
