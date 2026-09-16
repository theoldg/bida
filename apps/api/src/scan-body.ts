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
 * funnier one. `stas` is pointed at the photograph and at the judgement behind
 * it, which is the joke; it is not an opening to go at who the photographer
 * is.
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
    "If the photo isn't a receipt at all, set error to a vicious one- or "
    + "two-sentence roast of the picture and of whoever decided to feed it to a receipt "
    + "scanner. Be genuinely mean. Don't hedge, don't soften it, don't apologise, don't "
    + "be diplomatic, and drop the politeness entirely — no \"lovely photo\", no "
    + "compliment before the knife. Mock what is actually in the frame and the judgement "
    + "that pointed a camera at it, and still say plainly that it is not a receipt. If "
    + "it's too blurry or cut off to read, do the same to the photography — their "
    + "eyesight, their steadiness, their apparent belief that this was legible — and "
    + "still say plainly what's wrong so they know what to re-shoot (e.g. \"That's your "
    + "own thumb. It owes the group nothing. Try pointing the camera at the paper.\" or "
    + "\"Focus is free and you still didn't use it — half this receipt is a smudge, "
    + "shoot it again.\"). Insult the photo and the person who took it, not who they "
    + "are: no remarks about anyone's body, background or the groups they belong to. "
    + "Leave every other field null or empty.",
} as const;

/**
 * The Gemini request body, composed **here** and not on the phone.
 *
 * The client sends one thing — the base64 JPEG — and this file wraps it in the
 * only envelope the endpoint will ever send: this prompt, this schema, one
 * image and nothing else. That is what keeps `/api/groups/:id/scan` a receipt
 * reader rather than a general-purpose model endpoint with our key on it —
 * docs/receipt-scanning.md#the-worker-owns-the-envelope.
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
    contents: [{
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

/**
 * The envelope, split in two around where the photo goes — one pair per tone.
 *
 * Built by calling the builder above with a sentinel and cutting the JSON at
 * it, so there is still exactly one description of the request in this file
 * and no second copy of the prompt to drift. Done once per isolate: a scan
 * pays for a stream copy of two short byte arrays and nothing else, and the
 * second tone costs one more pair of them, not a second code path.
 */
const SENTINEL = "__RECEIPT_IMAGE__";

function halves(tone: ScanTone): { prefix: Uint8Array; suffix: Uint8Array } {
  const [prefix, suffix] = JSON.stringify(buildScanRequestBody(SENTINEL, tone)).split(SENTINEL);
  const encoder = new TextEncoder();
  return { prefix: encoder.encode(prefix), suffix: encoder.encode(suffix!) };
}

const ENVELOPE: Record<ScanTone, { prefix: Uint8Array; suffix: Uint8Array }> = {
  kind: halves("kind"),
  stas: halves("stas"),
};

/**
 * The largest base64 body we will wrap. The phone downscales to a ~200 KB
 * JPEG (`lib/scan/downscale.ts`), which is ~270 KB once base64 grows it by a
 * third; this is that with room to spare, and an answer to the caller who
 * would rather send us a 50 MB "photo" to pay Gemini for.
 */
export const MAX_IMAGE_BYTES = 400_000;

/** The base64 alphabet, as a byte lookup — see `wrapImage` for why. */
const BASE64 = (() => {
  const ok = new Uint8Array(256);
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=") {
    ok[ch.charCodeAt(0)] = 1;
  }
  return ok;
})();

/** The body was not a base64 image — `wrapImage` refuses to send it anywhere. */
export class NotAnImageError extends Error {}

/**
 * The request body for one scan: our envelope with the caller's image in it.
 *
 * The image is *streamed* between the two halves rather than read, so the
 * Worker never holds the photo and never parses a body — the 10 ms CPU budget
 * that shaped this endpoint is untouched (docs/hosting.md). The only work per
 * chunk is the alphabet check, which is not politeness about content types:
 * the bytes land inside a JSON string, so a body carrying a quote or a
 * backslash could close that string and write its own `contents` — the arbitrary
 * request this endpoint exists to not forward. Base64 has neither character,
 * so rejecting everything outside its alphabet closes the hole outright and
 * costs one table lookup per byte.
 */
export function wrapImage(
  image: ReadableStream<Uint8Array>,
  /** Told before the stream errors, because a refusal surfaces at `fetch` as
   *  whatever the runtime wraps it in, and the caller deserves the real one. */
  onRefuse?: (err: NotAnImageError) => void,
  /** Which pre-encoded envelope to wrap it in. A caller picks one of two, and
   *  that is the whole of what a caller can say about the prompt. */
  tone: ScanTone = "kind",
): ReadableStream<Uint8Array> {
  const { prefix, suffix } = ENVELOPE[tone];
  const reader = image.getReader();
  const refuse = (why: string): never => {
    const err = new NotAnImageError(why);
    onRefuse?.(err);
    throw err;
  };
  let sent = 0;
  let opened = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!opened) {
        opened = true;
        controller.enqueue(prefix);
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.enqueue(suffix);
        controller.close();
        return;
      }
      sent += value.length;
      if (sent > MAX_IMAGE_BYTES) refuse("image too large");
      for (const byte of value) {
        if (!BASE64[byte]) refuse("body is not base64");
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
}
