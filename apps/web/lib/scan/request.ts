/**
 * The Gemini request body. Prompt and response schema live here, not on the
 * Worker — see docs/receipt-scanning.md#why-the-key-sits-on-the-worker.
 */
export function buildScanRequestBody(imageBase64: string, categoryNames: readonly string[]): unknown {
  const categoryLine = categoryNames.length > 0
    ? `If it clearly matches one of these categories, return that exact name: ${categoryNames.join(", ")}. Otherwise return null.`
    : "Return null for category.";

  return {
    contents: [{
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
        {
          text: "Read this receipt. Return the merchant name; the total normalized to plain "
            + "decimal notation — '.' as the decimal point, no thousands separators, e.g. "
            + "\"1234.50\" whether the receipt prints \"1.234,50\", \"1,234.50\" or \"1234,50\" — "
            + "using the receipt's own locale and currency to tell decimal point from thousands "
            + "mark; a separate tip or service charge line if one is printed apart from the total, "
            + "same normalized notation, else null; the ISO 4217 currency code if legible; the "
            + "date as YYYY-MM-DD if legible; and a category. "
            + `${categoryLine} Also return every line item: its label exactly as `
            + "printed in the receipt's own language, an English translation of that label (null "
            + "if it's already English), its amount in the same normalized decimal notation as the "
            + "total, and a quantity if the receipt states a count for that line (e.g. \"2x\", a "
            + "multiplier, a quantity column) — null if no count is printed, don't infer one from "
            + "repeated lines or guess a default of 1. Use null for anything illegible or absent, "
            + "and an empty list if there are no line items. Don't compute or guess any amount "
            + "that isn't printed — only reformat the separators. If the photo isn't a receipt at "
            + "all, or is too blurry or cut off to read, set error to a short sentence saying so "
            + "(e.g. \"This doesn't look like a receipt\" or \"Too blurry to read\") and leave "
            + "every other field null or empty. Otherwise leave error null.",
        },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          merchant: { type: "STRING", nullable: true },
          total: { type: "STRING", nullable: true },
          tip: { type: "STRING", nullable: true },
          currency: { type: "STRING", nullable: true },
          date: { type: "STRING", nullable: true },
          category: { type: "STRING", nullable: true },
          lineItems: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                label: { type: "STRING" },
                labelEn: { type: "STRING", nullable: true },
                amount: { type: "STRING" },
                quantity: { type: "INTEGER", nullable: true },
              },
              required: ["label", "labelEn", "amount", "quantity"],
            },
          },
          error: { type: "STRING", nullable: true },
        },
        required: ["merchant", "total", "tip", "currency", "date", "category", "lineItems", "error"],
      },
    },
  };
}
