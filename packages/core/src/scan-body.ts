// Doc: docs/scan-reading.md#what-the-model-decides-and-what-it-must-not
/**
 * The bill-reading request: prompt, schema and the photograph. Tone moves only
 * the refusal paragraph.
 */

/** Ours to move, never a caller's. */
const GEMINI_MODEL = "gemini-3.1-flash-lite";

/**
 * Two hosts, billed differently: Vertex takes our shared key and the Cloud
 * credit; a person's own key goes to whichever of the two it belongs to.
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
  + "rows is one item with one amount. Every amount in the amount column, from the "
  + "first item down to the total you return, belongs to exactly one entry: none "
  + "dropped, none duplicated. Nothing printed below that total is an entry; a tip "
  + "written there is the tip (section 6).\n\n"
  + "4. TITLE\n"
  + "Use the merchant name only. Drop the legal form, owner, address, store number, "
  + "slogan and till or VAT lines (\"Bar Zahra - Sarl M. Benali\" → \"Bar Zahra\").\n"
  + "If the name doesn't reveal what was bought, append \" - \" and 2–3 English words "
  + "(\"Lidl - barbecue\"). Don't append anything when the merchant type is obvious "
  + "(restaurant, café, taxi), when the items are too mixed to sum up, or when no lines "
  + "are printed.\n"
  + "Keep the title under 40 characters. Use null if no name is legible.\n\n"
  + "5. LINE ITEMS\n"
  + "- A row with no figure of its own in the amount column is not a line item: a "
  + "modifier (\"Medium\"), part of a set or meal, a note, a dash. Leave it out.\n"
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
  + "6. DISCOUNTS AND CHARGES\n"
  + "An entry is a row that changes what is paid. A row that only reports a figure is "
  + "never one: listing it counts it twice. Amounts are written positive.\n"
  + "DISCOUNT: a deduction printed as its own row in the amount column:\n"
  + "- a loyalty, staff or member discount (\"Clubcard -1.50\")\n"
  + "- a voucher or coupon taken off before the total (\"Voucher -5.00\")\n"
  + "- a multi-buy credit (\"2 for 3 -2.49\")\n"
  + "CHARGE: an amount added after the items, on the way to the total:\n"
  + "- service (\"10% Svc chg 10.03\")\n"
  + "- a tip printed above the total\n"
  + "- tax added on top (\"Sales tax 1.39\", \"7% GST 7.72\")\n"
  + "TIP: a tip printed or written after the total (\"Total 19.38 / + Tip 3.00\", a "
  + "tip written on a card slip). Return it as tip, never as a charge, and keep total "
  + "as printed. Otherwise tip is null. A service charge is never a tip.\n"
  + "NEITHER: these only report:\n"
  + "- a subtotal or net figure: \"Subtotal\", \"Mdse st\", \"Netto\", \"Base\", \"HT\"\n"
  + "- tax already in the prices: \"Fuel includes GST 1.57\", \"of which VAT 20%\", "
  + "\"inkl. MwSt\", \"dont TVA\"\n"
  + "- tax printed after a net figure (\"Netto 129,75 / + 19% MwSt 24,65\"): the net is "
  + "the prices without the tax they already include\n"
  + "- what was saved or what a price was before: \"Saved 0.39\", \"You saved 0.50\", "
  + "\"Savings 3.00\", \"Uwzgl. opust: -2,00 st. c 10,99\" (Polish for \"discount "
  + "included, was 10,99\"), \"W tym rabaty 5,00\"\n"
  + "- anything else below the total: payments, change, coupons tendered, a VAT table\n\n"
  + "7. LABELS\n"
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
          tip: { type: "STRING", nullable: true },
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
          "title", "total", "tip", "charges", "discounts", "currency", "date", "lineItems", "english",
          "error",
        ],
      },
    },
  };
}
