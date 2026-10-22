// Doc: docs/scan-reading.md#what-the-model-decides-and-what-it-must-not
/**
 * The bill-reading request: prompt, schema and the photograph. Tone moves only
 * the refusal paragraph.
 */

/** Ours to move, never a caller's. */
const GEMINI_MODEL = "gemini-3.1-flash-lite";

/**
 * Two hosts, billed differently: Vertex takes our shared key and the Cloud
 * credit; AI Studio takes a person's own key.
 */
export const VERTEX_URL =
  `https://aiplatform.googleapis.com/v1/publishers/google/models/${GEMINI_MODEL}:generateContent`;

export const AI_STUDIO_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * `kind` jokes about the thumb in the photo, never the person. `stas` aims at the
 * person on purpose, never at what somebody was born as. Either must still say
 * plainly what to re-send.
 */
export type ScanTone = "kind" | "stas";

/**
 * Numbered sections, because a small model follows a list better than prose. The
 * photo is checked first, so nothing gets read off a photo that will be refused.
 * **Say how to read, never what it must come to**: told the lines must equal the
 * total, a model adjusts a line.
 */
const CHECK = "Read this receipt and return it as JSON.\n\n"
  + "1. CHECK THE PHOTO FIRST\n"
  + "- Unreadable or incomplete means blurry, cropped, folded or angled so that any line "
  + "item, or any line above the total, is hidden. Don't return a partial list.\n";

/** The only lines the two tones differ in. */
const VOICE: Record<ScanTone, string> = {
  kind:
    "- Not a receipt: set error to a short pun about what it actually shows, while "
    + "saying plainly that it isn't a receipt.\n"
    + "- Unreadable or incomplete: set error to one light, self-deprecating sentence that "
    + "says what's wrong, so the user knows what to re-shoot. Never joke at the "
    + "photographer's expense.\n",

  // No example lines: given one, the model writes variations of it.
  stas:
    "- Not a receipt, or unreadable or incomplete: set error to a brutal one- or "
    + "two-sentence insult aimed at the person who sent it, not at the picture. Find "
    + "your own angle in what's actually in the frame and in what sending it says about "
    + "them — don't reach for a stock line. Be genuinely cruel: no hedging, no "
    + "softening, no apology, no compliment first. Work the plain fact into the insult — "
    + "that it isn't a receipt, or exactly what can't be read — so they still know what "
    + "to re-shoot. Second person, and personal. The one thing you don't touch is what "
    + "they were born as: no slurs, and nothing about anyone's race, sex, religion, "
    + "disability or the like — everything else about them is fair game.\n",
};

/** A ticket printing "Friday, 9 October" with no year got one from the weekday. */
const general = (today: string | null): string =>
  "- In either case, leave every other field null or empty. Otherwise, error is null.\n\n"
  + "2. GENERAL RULES\n"
  + "- Amounts: plain decimals with \".\" as the separator and no thousands separators "
  + "(\"1234.50\"). Only transcribe printed amounts. Never compute or guess one.\n"
  + "- total: the total the receipt prints, never one you add up.\n"
  + "- Use null for illegible or absent values and [] for empty lists.\n"
  + "- currency: ISO 4217 code. date: YYYY-MM-DD."
  + (today ? ` Today is ${today}.` : "") + "\n"
  + "- english: true if the receipt is written in English.\n"
  + "- A till prints in capitals; a name is not written that way. Case the title and "
  + "all labels as ordinary writing, never all caps (\"POULET ROTI\" → \"Poulet "
  + "roti\"). Keep a brand's own casing (\"IKEA\", \"McDonald's\"). Change only the "
  + "case; keep the wording, language and spelling.\n\n";

const READING =
  "3. READING THE LAYOUT\n"
  + "Follow the printer's columns, not the photo's alignment. Angled shots shear the "
  + "columns, so an amount can sit lower than its label. A label wrapped over several "
  + "rows is one item with one amount. Every printed amount belongs to exactly one "
  + "entry: none dropped, none duplicated.\n\n"
  + "4. TITLE\n"
  + "Use the merchant name only. Drop the legal form, owner, address, store number, "
  + "slogan and till or VAT lines (\"Bar Zahra - Sarl M. Benali\" → \"Bar Zahra\").\n"
  + "If the name doesn't reveal what was bought, append \" - \" and 2–3 English words "
  + "(\"Lidl - barbecue\"). Don't append anything when the merchant type is obvious "
  + "(restaurant, café, taxi), when the items are too mixed to sum up, or when no lines "
  + "are printed.\n"
  + "Keep the title under 40 characters. Use null if no name is legible.\n\n"
  + "5. LINE ITEMS\n"
  + "- amount: the line total from the amount column, already multiplied out (\"2 ... "
  + "18.00\" has amount \"18.00\", not \"9.00\"). Never use the unit price, and never "
  + "calculate your own product. Never negative.\n"
  + "- quantity: only if a count is printed for that line. Otherwise null; don't infer "
  + "it from repeated lines or default to 1. Weights and volumes are measures, not "
  + "counts (\"0.482 kg\", \"41.3 L\" of fuel), so quantity and unitAmount stay null.\n"
  + "- unitAmount: only if a per-unit price is printed for that line (a row like \"2 x "
  + "1.79\" above or beside it).\n"
  + "- Copy quantity and unitAmount exactly as printed, even if they don't multiply to "
  + "the amount.\n\n"
  + "6. DISCOUNTS\n"
  + "Add one entry per printed deduction (loyalty, voucher, staff, multi-buy credit), "
  + "whether it applies to one item or the whole bill. Write the amount as a positive "
  + "number.\n"
  + "Exclude notes in the label column that only report a discount already reflected in "
  + "a line's price (e.g. \"discount included, was 42.98\"). Listing them would subtract "
  + "the discount twice.\n\n"
  + "7. CHARGES\n"
  + "Add one entry per amount added on top of the line items to reach the total: "
  + "service, tip, or tax added on top.\n"
  + "Exclude tax already included in the prices (e.g. \"of which VAT 20%\").\n\n"
  + "8. LABELS\n"
  + "- Leave out the tax-rate code a till prints at the end of a label (\"PIWO KASZTEL "
  + "4X0.5.A\" → \"Piwo Kasztel 4x0.5\", \"TOST PELNOZ.500G...D\" → \"Tost "
  + "pelnoz.500g\"); it is not part of the name.\n"
  + "- labelEn (for items, discounts and charges): null on English receipts, even for "
  + "abbreviations. On other receipts, translate what you can read and keep "
  + "abbreviations or brands you're unsure of as printed (\"LikierSopMix\" → \"Sop "
  + "liqueur mix\").";

/**
 * Gemini otherwise writes properties alphabetically: `error` after the fields it
 * empties, `english` after the labels it governs, `total` after summing the lines.
 */
const ordered = <T extends Record<string, unknown>>(properties: T) =>
  ({ type: "OBJECT", properties, propertyOrdering: Object.keys(properties) });

const LABELLED = {
  label: { type: "STRING" },
  labelEn: { type: "STRING", nullable: true },
};

const EXTRAS_SCHEMA = {
  type: "ARRAY",
  items: {
    ...ordered({ ...LABELLED, amount: { type: "STRING" } }),
    required: ["label", "labelEn", "amount"],
  },
};

/**
 * In core so both the Worker and the phone build it, and readings can't drift. A
 * caller picks `tone`, never a word of the prompt.
 */
export function buildScanRequestBody(
  billBase64: string,
  tone: ScanTone = "kind",
  today?: string,
): unknown {
  const prompt = CHECK + VOICE[tone]
    + general(today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : null) + READING;
  return {
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: billBase64 } },
        { text: prompt },
      ],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        ...ordered({
          error: { type: "STRING", nullable: true },
          english: { type: "BOOLEAN" },
          title: { type: "STRING", nullable: true },
          total: { type: "STRING", nullable: true },
          currency: { type: "STRING", nullable: true },
          date: { type: "STRING", nullable: true },
          lineItems: {
            type: "ARRAY",
            items: {
              ...ordered({
                ...LABELLED,
                amount: { type: "STRING", nullable: true },
                quantity: { type: "INTEGER", nullable: true },
                unitAmount: { type: "STRING", nullable: true },
              }),
              required: ["label", "labelEn", "amount", "unitAmount", "quantity"],
            },
          },
          discounts: EXTRAS_SCHEMA,
          charges: EXTRAS_SCHEMA,
        }),
        required: [
          "title", "total", "charges", "discounts", "currency", "date", "lineItems", "english",
          "error",
        ],
      },
    },
  };
}
