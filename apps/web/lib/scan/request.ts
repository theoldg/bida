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
          text: "Read this receipt. Return the merchant name; the total exactly as printed, "
            + "keeping whatever decimal and thousands separators it uses; a separate tip or "
            + "service charge line if one is printed apart from the total, same convention, else "
            + "null; the ISO 4217 currency code if legible; the date as YYYY-MM-DD if legible; and "
            + `a category. ${categoryLine} Also return every line item: its label exactly as `
            + "printed in the receipt's own language, an English translation of that label (null "
            + "if it's already English), and its amount exactly as printed. Use null for anything "
            + "illegible or absent, and an empty list if there are no line items. Don't compute or "
            + "guess anything that isn't printed.",
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
              },
              required: ["label", "labelEn", "amount"],
            },
          },
        },
        required: ["merchant", "total", "tip", "currency", "date", "category", "lineItems"],
      },
    },
  };
}
