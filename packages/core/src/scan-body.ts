/**
 * The receipt-reading request, and the two refusals it can come back with.
 *
 * Pure data — no I/O, no fetch — so the Worker and the phone can each send it
 * to Google themselves. `scan.ts` beside this reads what comes back.
 */

/** The model both paths call. Ours to move, never a caller's. */
export const GEMINI_MODEL = "gemini-3.1-flash-lite";

/**
 * Two hosts for one model, because the two paths pay for it differently.
 *
 * `VERTEX_URL` is ours: the shared key is an Agent Platform key, billed to the
 * Cloud project, which is the only place Google's Cloud credit can be spent —
 * the AI Studio API has its own prepay balance and cannot reach it. `AI_STUDIO_URL`
 * is where a brought key goes, because that is the kind of key a person can
 * make for themselves (docs/receipt-scanning.md#a-key-of-your-own).
 *
 * The envelope below is the same for both, and `scan-body.test.ts` holds it to
 * that: a brought key still buys a different payer, not a different reading.
 */
export const VERTEX_URL =
  `https://aiplatform.googleapis.com/v1/publishers/google/models/${GEMINI_MODEL}:generateContent`;

export const AI_STUDIO_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * The two answers to a photo that is not a usable receipt, and the only part of
 * the prompt that has a second version.
 *
 * `kind` is the app's voice: a photo somebody took of their thumb gets a joke
 * about the thumb, never about them. `stas` is Staś mode — switched on by hand
 * on `/diag`, off for everybody else, and there because a group chat that
 * passes a phone round wants the other reply. It changes the wording of
 * `error` and nothing else: the reading of an actual receipt is the same
 * prompt, the same schema and the same arithmetic either way, so a mean scan
 * cannot be a wrong one.
 *
 * Both still have to say plainly what is wrong with the picture — an insult
 * that leaves somebody guessing what to re-shoot is a worse refusal, not a
 * funnier one. `stas` is pointed at the person, on purpose and at the owner's
 * asking; twice it was sent back for being too polite. The single thing it is
 * told to leave alone is what somebody was born as, which is not a softening
 * of the joke but the difference between a roast and something nobody wants
 * their expense app saying.
 */
const REFUSAL = {
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
} as const;

/**
 * The Gemini request body: this prompt, this schema, one image and nothing
 * else.
 *
 * It lives in core because **both ends build it**. A scan on the shared key
 * goes through the Worker, which streams the photo into this envelope and
 * never lets a caller near it — that is what keeps `/api/groups/:id/scan` a
 * receipt reader rather than a general-purpose model endpoint with our key on
 * it. A scan on a key the person brought themselves never touches the Worker
 * at all and builds the same body on the phone
 * (docs/receipt-scanning.md#a-key-of-your-own). One prompt, one home, so the
 * two readings cannot drift apart.
 *
 * Nothing is lost by the prompt being client-side now: the repo is public, and
 * what the envelope protects is *our* key, which the phone's own path does not
 * hold.
 *
 * The prompt says how to *read* a bill and never what the answer has to come
 * to. Told that the lines have to equal the printed total, a model closes the
 * gap by adjusting a line — and a bill that has been made to add up is the one
 * error `checkScan` cannot see. Instructions about the page are safe; the
 * invariant it is checked against is not.
 *
 * `tone` picks which of the two refusal paragraphs below goes in — the only
 * thing about this prompt a caller can move, and it moves by choosing one of
 * two constants, never by writing a word of either (`REFUSAL`).
 */
export type ScanTone = keyof typeof REFUSAL;

export function buildScanRequestBody(imageBase64: string, tone: ScanTone = "kind"): unknown {
  return {
    // `role` is a silent default on AI Studio and required by Vertex, which
    // refuses the body without it ("Please use a valid role: user, model").
    // Stated once here so one envelope satisfies both hosts.
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
        {
          text: "Read this receipt. Return a title for the expense (described below); the total "
            + "normalized to plain decimal notation — '.' as the decimal point, no thousands separators, e.g. "
            + "\"1234.50\" whether the receipt prints \"1.234,50\", \"1,234.50\" or \"1234,50\" — "
            + "using the receipt's own locale and currency to tell decimal point from thousands "
            + "mark; a separate tip or service charge line if one is printed apart from the total, "
            + "same normalized notation, else null; the ISO 4217 currency code if legible; the "
            + "date as YYYY-MM-DD if legible. "
            + "The title is the merchant's name as printed, with three adjustments. Strip whatever "
            + "isn't the name — a legal form or registered owner, a branch address or store "
            + "number, a slogan, a till or VAT line: \"Bar Zahra - Sarl M. Benali\" is \"Bar "
            + "Zahra\", \"Hotel Amira, 12 Rue Bab Doukkala\" is \"Hotel Amira\". And when the "
            + "name alone wouldn't tell somebody what the money went on, add two or three English "
            + "words for what was bought, after \" - \": \"Lidl - barbecue\", \"Carrefour - "
            + "breakfast\". Add nothing when the merchant already says it (a restaurant, a café, "
            + "a taxi), when the lines are too mixed to sum up in a few words, or when no lines "
            + "are printed — a bare name beats a wrong guess. Write the title the way a name is "
            + "written, not the way a till prints one: a receipt that shouts \"BAR ZAHRA\" or "
            + "\"CAFE DES NOMADES\" gives the title \"Bar Zahra\", \"Cafe des Nomades\". Never "
            + "return a title in all capitals. Keep the casing the brand itself uses where it is "
            + "not merely the printer's (\"IKEA\", \"H&M\", \"McDonald's\", \"lululemon\"). "
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
            + "Also return every line item: its label exactly as "
            + "printed in the receipt's own language, an English translation of that label (null "
            + "if it's already English), its amount in the same normalized decimal notation as the "
            + "total, and a quantity if the receipt states a count for that line (e.g. \"2x\", a "
            + "multiplier, a quantity column) — null if no count is printed, don't infer one from "
            + "repeated lines or guess a default of 1. The amount is the total printed against "
            + "that line — the figure in the receipt's own amount column, already multiplied out "
            + "where a count is printed (a line reading \"2 ... 18.00\" has amount \"18.00\", not "
            + "\"9.00\") — never the per-unit price, and never a product you work out yourself. "
            + "Read the columns as the printer laid them out, not as the photo happens to line "
            + "them up: a receipt shot at an angle shears them, so an amount can sit lower than "
            + "the label it belongs to. A label the printer wrapped over two or three rows is "
            + "still one line item with one amount — join the rows, and don't let a wrapped row "
            + "that has drifted under the amount column take an amount of its own. Every printed "
            + "amount belongs to exactly one line item: none dropped, none counted twice. "
            + "No line item's amount is negative: a line that only takes money off is a "
            + "deduction, so leave it out of the list and put it in discounts instead. "
            + "Use null for anything illegible or absent, "
            + "and an empty list if there are no line items. Don't compute or guess any amount "
            + "that isn't printed — only reformat the separators. "
            + REFUSAL[tone]
            + " The same applies if the receipt is cropped, "
            + "folded, or photographed at an angle that hides part of the line-item list, or if the "
            + "total is visible but any line above it is cut off or unreadable — don't guess at "
            + "missing lines or report a partial list as if it were complete; set error asking for "
            + "a photo of the whole receipt instead. Otherwise leave error null.",
        },
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
                amount: { type: "STRING" },
                quantity: { type: "INTEGER", nullable: true },
              },
              required: ["label", "labelEn", "amount", "quantity"],
            },
          },
          error: { type: "STRING", nullable: true },
        },
        required: [
          "title", "total", "tip", "tax", "discounts", "currency", "date", "lineItems", "error",
        ],
      },
    },
  };
}

