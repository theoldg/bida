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

/* ── A photograph of a receipt ───────────────────────────────────────────── */

const PHOTO_LEAD = "Read this receipt. ";

/**
 * **Say how to read, never what it must come to**: told the lines must equal the
 * total, a model adjusts a line.
 */
const PHOTO_FIELDS_HEAD =
  "Return a title for the expense (described below); the total "
  + "normalized to plain decimal notation — '.' as the decimal point, no thousands separators, e.g. "
  + "\"1234.50\" whether the receipt prints \"1.234,50\", \"1,234.50\" or \"1234,50\" — "
  + "using the receipt's own locale and currency to tell decimal point from thousands "
  + "mark; a separate tip or service charge line if one is printed apart from the total, "
  + "same normalized notation, else null; the ISO 4217 currency code if legible; the "
  + "date as YYYY-MM-DD if legible. "
  + "The title is the merchant's name as printed, with two adjustments. Strip whatever "
  + "isn't the name — a legal form or registered owner, a branch address or store "
  + "number, a slogan, a till or VAT line: \"Bar Zahra - Sarl M. Benali\" is \"Bar "
  + "Zahra\", \"Hotel Amira, 12 Rue Bab Doukkala\" is \"Hotel Amira\". And when the "
  + "name alone wouldn't tell somebody what the money went on, add two or three English "
  + "words for what was bought, after \" - \": \"Lidl - barbecue\", \"Carrefour - "
  + "breakfast\". Add nothing when the merchant already says it (a restaurant, a café, "
  + "a taxi), when the lines are too mixed to sum up in a few words, or when no lines "
  + "are printed — a bare name beats a wrong guess. "
  + "Keep the whole title under 40 characters, and null if no name is legible and the "
  + "lines say nothing either. "
  + "Return tax only where it is charged on top of the line items — a figure the "
  + "receipt adds to them to reach the total. Tax already inside the printed prices, "
  + "which most VAT-inclusive receipts break out for information near the foot "
  + "(\"of which VAT 20%\", \"TVA incluse\"), is not that: return null for it, or the "
  + "bill gets charged for twice. "
  + "Return discounts as one entry per deduction the receipt prints — loyalty "
  + "deductions, vouchers, staff discounts, a \"2 for 1\" or \"buy one get one free\" "
  + "credit — each with its label as printed, an English translation of that label "
  + "(null if it's already English), and its amount written WITHOUT a minus sign as "
  + "the amount that comes off (a line reading \"2 FOR 1  -8.00\" has amount "
  + "\"8.00\"). Use an empty list if the receipt takes nothing off. It doesn't matter "
  + "whether a deduction is printed against one item or against the whole bill; "
  + "either way it belongs in this list and not in the line items. "
  + "Also return every line item: its label as "
  + "printed, in the receipt's own language, an English translation of that label (null "
  + "if it's already English), its amount in the same normalized decimal notation as the "
  + "total, and a quantity if the receipt states a count for that line (e.g. \"2x\", a "
  + "multiplier, a quantity column) — null if no count is printed, don't infer one from "
  + "repeated lines or guess a default of 1. A measure is not a count: litres of fuel "
  + "or goods sold by weight leave quantity and unitAmount null. The amount is the "
  + "total printed against "
  + "that line — the figure in the receipt's own amount column, already multiplied out "
  + "where a count is printed (a line reading \"2 ... 18.00\" has amount \"18.00\", not "
  + "\"9.00\") — never the per-unit price, and never a product you work out yourself. "
  + "Where the receipt also prints the price of one unit for that line (a row like "
  + "\"2 x 1.79\" above or beside it), return that as unitAmount, in the same "
  + "normalized notation; otherwise leave unitAmount null. Copy both figures exactly as "
  + "printed, even where the quantity times unitAmount doesn't come to the amount: "
  + "don't correct either one from the other. ";

/**
 * Words and spelling are transcribed so the split can be checked against paper.
 */
const PHOTO_CASING =
  "A till prints in capitals; a name is not written that way. Case the title and every "
  + "label as ordinary writing, never in all capitals: \"BAR ZAHRA\" is \"Bar Zahra\", "
  + "\"POULET ROTI\" is \"Poulet roti\". Keep the casing a brand owns where it is the "
  + "brand's and not the printer's (\"IKEA\", \"H&M\", \"McDonald's\", \"lululemon\"). "
  + "Re-case only: the words themselves, their language and their spelling stay "
  + "exactly as the receipt prints them. ";

/**
 * One question for the whole bill: per line the model "translates" shorthand. And
 * a guessed expansion reads as fact: "Sop" (Soplica) came back "Sopot".
 */
const ENGLISH =
  "Set english to true when the bill is written in English, and false otherwise. An "
  + "English bill has nothing to translate: leave every labelEn on it null, even where "
  + "a label is abbreviated, misspelled or terse — expanding \"Chkn wrap\" is not a "
  + "translation. On any other bill, every labelEn — line items and discounts alike — "
  + "translates the words you can read and keeps an abbreviation, fragment or brand "
  + "you can't be sure of as printed: \"LikierSopMix\" is \"Sop liqueur mix\". ";

const PHOTO_LAYOUT =
  "Read the columns as the printer laid them out, not as the photo happens to line "
  + "them up: a receipt shot at an angle shears them, so an amount can sit lower than "
  + "the label it belongs to. A label the printer wrapped over two or three rows is "
  + "still one line item with one amount — join the rows, and don't let a wrapped row "
  + "that has drifted under the amount column take an amount of its own. Every printed "
  + "amount belongs to exactly one line item: none dropped, none counted twice. ";

const PHOTO_FIELDS_TAIL =
  "No line item's amount is negative: a line that only takes money off is a "
  + "deduction, so leave it out of the list and put it in discounts instead. "
  + "Use null for anything illegible or absent, "
  + "and an empty list if there are no line items. Don't compute or guess any amount "
  + "that isn't printed — only reformat the separators. ";

const PHOTO_REFUSAL: Record<ScanTone, string> = {
  kind:
    "If the photo isn't a receipt at "
    + "all, set error to one short pun or joke about the picture's actual subject, "
    + "still saying plainly it's not a receipt. If it's too blurry or cut off to read, "
    + "set error to one short, slightly "
    + "humorous sentence saying so — light and self-deprecating, never at the "
    + "photographer's expense, and it still has to say plainly what's wrong so they know "
    + "what to re-shoot (e.g. \"Lovely photo, but I can't buy anything with it — that's "
    + "not a receipt.\" or \"Too blurry — I've read tea leaves with better odds.\") and "
    + "leave every other field null or empty.",

  stas:
    "If the photo isn't a receipt at all, set error to a brutal one- or two-sentence "
    + "roast of the person who sent it. Go at them, not at the picture: their judgement, "
    + "their competence, their apparent grasp of what a receipt is, the sheer confidence "
    + "it took to send this to a machine that asked for one. Be genuinely cruel about it. "
    + "Don't hedge, don't soften it, don't apologise, don't be diplomatic, don't "
    + "compliment anything first, and don't award them points for trying. Say plainly "
    + "that it is not a receipt, in the middle of the insult rather than instead of it. "
    + "If it's too blurry or cut off to read, tear into them the same way — their "
    + "eyesight, their hands, their standards, the fact that they looked at this and "
    + "thought it would do — and still say plainly what's wrong so they know what to "
    + "re-shoot (e.g. \"Congratulations, you have photographed your own thumb. Your thumb "
    + "has never bought anything. Point the camera at the paper.\" or \"You looked at "
    + "this smeared mess and pressed send, which tells me more about you than the receipt "
    + "does. Hold still and shoot it again.\"). Second person, and personal. The one "
    + "thing you don't touch is what they were born as: no slurs, and nothing about "
    + "anyone's race, sex, religion, disability or the like — everything else about them "
    + "is fair game. Leave every other field null or empty.",
};

const PHOTO_TAIL =
  " The same applies if the receipt is cropped, "
  + "folded, or photographed at an angle that hides part of the line-item list, or if the "
  + "total is visible but any line above it is cut off or unreadable — don't guess at "
  + "missing lines or report a partial list as if it were complete; set error asking for "
  + "a photo of the whole receipt instead. Otherwise leave error null.";

/**
 * A ticket printing "Friday, 9 October" with no year got one from the weekday.
 */
const dated = (today: string): string => ` Today is ${today}.`;

const PROMPT: Record<ScanTone, string> = {
  kind: PHOTO_LEAD + PHOTO_FIELDS_HEAD + PHOTO_CASING + PHOTO_LAYOUT + PHOTO_FIELDS_TAIL
    + ENGLISH + PHOTO_REFUSAL.kind + PHOTO_TAIL,
  stas: PHOTO_LEAD + PHOTO_FIELDS_HEAD + PHOTO_CASING + PHOTO_LAYOUT + PHOTO_FIELDS_TAIL
    + ENGLISH + PHOTO_REFUSAL.stas + PHOTO_TAIL,
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
  const prompt = PROMPT[tone]
    + (today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? dated(today) : "");
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
        type: "OBJECT",
        properties: {
          title: { type: "STRING", nullable: true },
          total: { type: "STRING", nullable: true },
          tip: { type: "STRING", nullable: true },
          tax: { type: "STRING", nullable: true },
          discounts: {
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
          currency: { type: "STRING", nullable: true },
          date: { type: "STRING", nullable: true },
          lineItems: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                label: { type: "STRING" },
                labelEn: { type: "STRING", nullable: true },
                amount: { type: "STRING", nullable: true },
                unitAmount: { type: "STRING", nullable: true },
                quantity: { type: "INTEGER", nullable: true },
              },
              required: ["label", "labelEn", "amount", "unitAmount", "quantity"],
            },
          },
          english: { type: "BOOLEAN" },
          error: { type: "STRING", nullable: true },
        },
        required: [
          "title", "total", "tip", "tax", "discounts", "currency", "date", "lineItems", "english",
          "error",
        ],
      },
    },
  };
}

