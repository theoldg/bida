/**
 * The bill-reading request: one prompt, one schema, and the bill itself — a
 * photograph, or the text of it somebody typed. Pure data, no I/O, so the
 * Worker and the phone can each send it to Google. `scan.ts` reads the reply.
 *
 * **Two prompts, not one prompt with two dialects.** A till roll and a chat
 * message are different documents, and the rules that make a photograph read
 * safely (amounts already multiplied out, nothing computed, a total to
 * reconcile against) are what make typed text unreadable. The schema holds
 * them together, not shared paragraphs.
 *
 * Both promise one answer shape and one set of conventions: plain decimal,
 * deductions as positive magnitudes, tax only where it sits on top, no title
 * in capitals. Within a medium, tone moves the refusal paragraph and nothing
 * else — `apps/api/src/scan-body.test.ts` holds them to both.
 */

/** The model both paths call. Ours to move, never a caller's. */
const GEMINI_MODEL = "gemini-3.1-flash-lite";

/**
 * Two hosts for one model, because the two paths pay for it differently.
 * `VERTEX_URL` takes our shared Agent Platform key, billed to the Cloud
 * project, which is the only place Google's Cloud credit can be spent.
 * `AI_STUDIO_URL` takes a key a person made for themselves
 * (docs/receipt-scanning.md#a-key-of-your-own).
 *
 * The envelope is the same for both: a brought key buys a different payer, not
 * a different reading.
 */
export const VERTEX_URL =
  `https://aiplatform.googleapis.com/v1/publishers/google/models/${GEMINI_MODEL}:generateContent`;

export const AI_STUDIO_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/**
 * Which medium a bill arrives in: a photograph, or the same bill typed or
 * pasted for a receipt nobody photographed
 * (docs/receipt-scanning.md#typing-a-bill-in). Each has its own prompt below.
 */
export type ScanMedium = "photo" | "text";

/**
 * The two tones. `kind` is the app's voice: a photo of somebody's thumb gets a
 * joke about the thumb, never about them. `stas` is Staś mode, switched on by
 * hand on `/diag`, and it is pointed at the person on purpose.
 *
 * Tone moves the refusal paragraph and nothing else — same prompt, schema and
 * arithmetic either way, so a mean scan cannot be a wrong one
 * (`scan-body.test.ts`).
 *
 * Both tones must still say plainly what is wrong: an insult that leaves
 * somebody guessing what to send is a worse refusal, not a funnier one. The
 * one thing `stas` leaves alone is what somebody was born as.
 */
export type ScanTone = "kind" | "stas";

/* ── A photograph of a receipt ─────────────────────────────────────────────
 *
 * A till roll has columns, a merchant, every amount already multiplied out and
 * a total at the foot, and every rule below leans on one of those.
 */

const PHOTO_LEAD = "Read this receipt. ";

/**
 * The field rules for a photograph. **Says how to read the page, never what
 * the answer has to come to**: told the lines must equal the printed total, a
 * model closes the gap by adjusting a line, and a bill made to add up is the
 * one error `checkScan` cannot see.
 */
const PHOTO_FIELDS_HEAD =
  "Return a title for the expense (described below); the total "
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
  + "Leave unitAmount null on every line: a till prints the extension, and that is the "
  + "figure to return. ";

/** A photograph can shear its own columns, which is the whole of this paragraph. */
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

/** The receipt that only half arrived — the same refusal, for a real and incomplete one. */
const PHOTO_TAIL =
  " The same applies if the receipt is cropped, "
  + "folded, or photographed at an angle that hides part of the line-item list, or if the "
  + "total is visible but any line above it is cut off or unreadable — don't guess at "
  + "missing lines or report a partial list as if it were complete; set error asking for "
  + "a photo of the whole receipt instead. Otherwise leave error null.";

/* ── A bill somebody typed ─────────────────────────────────────────────────
 *
 * Its own instruction, and deliberately about a third shorter than the
 * photograph's. What arrives here is a WhatsApp message, an email, a note made
 * at the table: no columns, usually no merchant and usually no total. Three of
 * the photograph's rules are actively wrong about it — every amount already
 * multiplied out, never compute anything, a total always there — and those
 * three are what this rewrites (docs/receipt-scanning.md#typing-a-bill-in).
 */

const TEXT_LEAD =
  "Read this bill. It is text somebody typed or pasted — a chat message, an email, a "
  + "note they made at the table — not a photograph and not a printout, so it has no "
  + "layout to read and none to trust. It may be a tidy list, one long sentence, or both "
  + "at once, in any language. Read what the words say and never mind how they are "
  + "arranged: a line break means nothing in particular, one line can hold several "
  + "things, and one thing can be spread over several lines. ";

/**
 * The line items, and where this prompt earns its keep. A typist writes the
 * unit price — "3 chicken at 13 each", and the 39 is nowhere on the page — so
 * asking for an amount while forbidding multiplication leaves no legal answer.
 * It asks for whichever figure the text gives; `scan.ts` multiplies, in minor
 * units, where it can be tested.
 *
 * The label is the one field the model may *improve* rather than transcribe:
 * "10 beef at 15" under a line about skewers is half a name. Scoped tight —
 * only what the surrounding line makes plain — because it is still invention.
 */
const TEXT_ITEMS =
  "Return every separate thing that was bought as a line item, each with: label — a "
  + "short, clean name for it, the way it would read on a receipt or a shopping list: "
  + "capitalized, singular, in the text's own language, not necessarily the exact words "
  + "used. Fill in a word another line makes plain but this one dropped — \"3 chicken "
  + "skewers at 13\" then \"10 beef at 15\" is \"Chicken skewer\" and \"Beef skewer\", not "
  + "\"Beef\" — and where a generic word plainly names one well-known brand and nothing "
  + "else, name the brand instead of the genre (\"large cola\" is \"Coca-Cola\", not "
  + "\"Cola\"). Guess only what a person reading the same line would also assume; never "
  + "invent a dish, a brand or a detail the line gives no reason to pick. "
  + "labelEn — an English "
  + "translation of that label, or null if it is already English; quantity — how many, "
  + "when the text says how many (\"3 chicken\", \"2x beer\", \"beer x4\"), and null when "
  + "it does not say, never inferred from a thing being mentioned twice and never "
  + "defaulted to 1; and one of two figures. "
  + "Which figure depends on what the text gives, and both are ordinary. Where it gives "
  + "what the whole line came to, put that in amount and leave unitAmount null. Where it "
  + "gives the price of one — \"3 chicken at 13 each\", \"2 beers @ 5\", \"po 13\" — put "
  + "that price in unitAmount and leave amount null. Fill exactly one of the two, "
  + "whichever the text actually states, and never both. Do not multiply and do not "
  + "divide: \"3 chicken at 13 each\" is quantity 3 with unitAmount \"13\" and never an "
  + "amount of \"39\", and \"3 chicken 39\" is quantity 3 with amount \"39\" and never a "
  + "unitAmount of \"13\". Where the text plainly gives both, keep the line total: fill "
  + "amount and leave unitAmount null. "
  + "A count is not money, and the same figure can be either — only the words around it "
  + "say which. In \"10 beef (15 each)\" the 10 is how many and the 15 is the price; in "
  + "\"large cola 10\" the 10 is the price. "
  + "A line that announces a group and is then broken down is not a line item of its "
  + "own: \"15 skewers, of which 3 chicken, 10 beef and 2 duck\" is three line items and "
  + "not four, and its 15 is not an amount. Read the breakdown and leave the "
  + "announcement out, or the bill is counted twice. ";

/**
 * The total, which a typed bill usually does not have. Asked for one anyway a
 * model supplies it, and a total derived from the lines cannot then check the
 * lines — `checkScan` reconciles only against a figure the bill itself stated
 * (docs/receipt-scanning.md#what-a-reading-is-checked-against).
 */
const TEXT_TOTAL =
  "Return total only where the text states one — a figure it calls the total, the sum, "
  + "the bill or the amount due, or one plainly standing for the whole of it. Where it "
  + "states none, return null and never add the bill up yourself. Most typed bills have "
  + "no total: null is the ordinary and correct answer for them, not a fault, not "
  + "something missing, and never a reason to refuse a bill. ";

const TEXT_EXTRAS =
  "Return tip where the text names a tip or a service charge apart from the things "
  + "bought (\"tip 10\", \"napiwek 10\", \"service 4.50\"), else null. Return tax only "
  + "where it is charged on top of the prices listed — a figure the bill adds to them. "
  + "Tax already inside those prices, which is most VAT, is not that and must be null, "
  + "or the bill gets charged for twice. Return discounts as one entry per deduction the "
  + "text names — a voucher, a loyalty credit, a \"2 for 1\" — each with its label, an "
  + "English translation of that label (null if it is already English), and the amount "
  + "that comes off written WITHOUT a minus sign, so \"-8.00\" is \"8.00\". Use an empty "
  + "list where nothing comes off. A deduction is never a line item, and no line item's "
  + "amount or unitAmount is ever negative. A percentage the text does not work out is "
  + "not an amount: return null rather than working it out. ";

/**
 * Almost never a title: a typed bill usually leads with the food, and a model
 * asked to name the expense describes the list back ("Skewers", "Barbecue").
 * That is worse than the empty field the person was about to type into, and it
 * lands in the draft as though it had been read off the bill.
 */
const TEXT_TITLE =
  "Return title only where the text plainly names where the money went — a restaurant, "
  + "a bar, a shop, a driver. Otherwise return null, which will usually be the answer: a "
  + "bill that only lists what was bought has no title, and a description of the list is "
  + "not one. Do not name it after the food, the occasion or the largest line, and do "
  + "not turn the list into a category — skewers and a cola is null, not \"Skewers\" and "
  + "not \"Barbecue\". Where a name is there, take the name and nothing around it (\"Bar "
  + "Zahra - Sarl M. Benali\" is \"Bar Zahra\"), write it the way a name is written "
  + "rather than the way a sign shouts it, never in all capitals, keeping the casing a "
  + "brand uses for itself (\"IKEA\", \"H&M\", \"McDonald's\"), and under 40 characters. ";

const TEXT_NUMBERS =
  "Write every figure you return in plain decimal notation: '.' as the decimal point, no "
  + "thousands separator, no currency symbol and no spaces — \"1234.50\" whether the text "
  + "writes \"1.234,50\", \"1,234.50\" or \"1234,50\", using the text's own language and "
  + "conventions to tell a decimal point from a thousands mark. Reformat the separators "
  + "and nothing else. Return currency as an ISO 4217 code only where the text names or "
  + "symbols one, and null otherwise — never guessed from the language it is written in. "
  + "Return date as YYYY-MM-DD only where the text gives a date, and null otherwise. Use "
  + "null for anything the text does not give, and an empty list where there are no line "
  + "items. Never round, never convert between currencies, and never supply a figure the "
  + "text does not contain — the one arithmetic you may rely on is that a count and a "
  + "price of one will be multiplied for you. ";

const TEXT_REFUSAL: Record<ScanTone, string> = {
  kind:
    "If the text is not a bill at all, set error to one short pun or joke about what it "
    + "actually is, still saying plainly that it is not a bill. If it names things bought "
    + "but gives no prices anywhere, or is plainly only a fragment — a list that stops "
    + "mid-way, a sentence cut off — set error to one short, slightly humorous sentence "
    + "saying so: light and self-deprecating, never at the sender's expense, and it still "
    + "has to say plainly what is missing so they know what to add (e.g. \"Lovely words, "
    + "but I can't buy anything with them — that's not a bill.\" or \"All the dishes and "
    + "none of the prices: I'm good, but not that good.\"). Don't guess at the rest of a "
    + "fragment. The same goes for a line with more numbers than the words explain — "
    + "\"chicken 2 5 7\" gives no word or symbol to say which figure is a count and which "
    + "is a price: don't pick an arrangement, set error the same short, light way, naming "
    + "the line so they know what to add (e.g. \"'chicken 2 5 7' — three numbers and I "
    + "can't tell which one's the price.\"). A bill with no total is none of these cases: "
    + "read it and leave total null. Where error is set, leave every other field null or "
    + "empty; otherwise leave error null.",

  stas:
    "If the text is not a bill at all, set error to a brutal one- or two-sentence roast "
    + "of the person who typed it. Go at them, not at the text: their judgement, their "
    + "competence, their apparent grasp of what a bill is, the sheer confidence it took "
    + "to type this into a machine that asked for one. Be genuinely cruel about it. "
    + "Don't hedge, don't soften it, don't apologise, don't be diplomatic, don't "
    + "compliment anything first, and don't award them points for trying. Say plainly "
    + "that it is not a bill, in the middle of the insult rather than instead of it. "
    + "If it names things bought and gives no prices anywhere, or is plainly only a "
    + "fragment of one, tear into them the same way — their typing, their standards, the "
    + "fact that they sat there keying this in and never once wondered where the prices "
    + "had gone — and still say plainly what is missing so they know what to add (e.g. "
    + "\"You have typed me a shopping list and called it a bill. The paper had numbers on "
    + "it. Those were the important part.\"). The same goes for a line with more numbers "
    + "than the words explain — \"chicken 2 5 7\" — tear into them for throwing digits at "
    + "a machine and expecting it to guess which one's the price, and still name the line "
    + "so they know what to add (e.g. \"'chicken 2 5 7' — three numbers, zero clues, and "
    + "you expected me to pick one?\"). Second person, and personal. The one thing "
    + "you don't touch is what they were born as: no slurs, and nothing about anyone's "
    + "race, sex, religion, disability or the like — everything else about them is fair "
    + "game. A bill with no total is none of these cases: read it, leave total null, and "
    + "keep your opinions about that to yourself. Where error is set, leave every other "
    + "field null or empty; otherwise leave error null.",
};

/**
 * The four prompts, built once. Within a medium the only difference is the
 * refusal — the invariant `scan-body.test.ts` holds them to.
 */
const PROMPT: Record<ScanMedium, Record<ScanTone, string>> = {
  photo: {
    kind: PHOTO_LEAD + PHOTO_FIELDS_HEAD + PHOTO_LAYOUT + PHOTO_FIELDS_TAIL
      + PHOTO_REFUSAL.kind + PHOTO_TAIL,
    stas: PHOTO_LEAD + PHOTO_FIELDS_HEAD + PHOTO_LAYOUT + PHOTO_FIELDS_TAIL
      + PHOTO_REFUSAL.stas + PHOTO_TAIL,
  },
  text: {
    kind: TEXT_LEAD + TEXT_ITEMS + TEXT_TOTAL + TEXT_EXTRAS + TEXT_TITLE + TEXT_NUMBERS
      + TEXT_REFUSAL.kind,
    stas: TEXT_LEAD + TEXT_ITEMS + TEXT_TOTAL + TEXT_EXTRAS + TEXT_TITLE + TEXT_NUMBERS
      + TEXT_REFUSAL.stas,
  },
};

/** What the bill is attached as, per medium. The Worker picks it, never a caller. */
const MIME: Record<ScanMedium, string> = {
  photo: "image/jpeg",
  text: "text/plain",
};

/**
 * The Gemini request body: this prompt, this schema, one bill and nothing else.
 *
 * In core because **both ends build it** — the Worker on the shared key, the
 * phone on a key the person brought
 * (docs/receipt-scanning.md#a-key-of-your-own) — so the two readings cannot
 * drift apart. Building it here is what keeps `/api/groups/:id/scan` a receipt
 * reader rather than a general-purpose model endpoint with our key on it.
 *
 * `tone` and `medium` are all a caller can move, and each moves by choosing
 * one of the four strings in `PROMPT`, never by writing a word of one.
 *
 * **On `text` the bill is words somebody typed**, so a caller can put
 * sentences in front of the model. They still cannot compose a request: the
 * prompt, schema and destination are all here, so only a bill-shaped object
 * can come back (docs/receipt-scanning.md#typing-a-bill-in).
 */
export function buildScanRequestBody(
  billBase64: string,
  tone: ScanTone = "kind",
  medium: ScanMedium = "photo",
): unknown {
  return {
    // A silent default on AI Studio, required by Vertex. Stated once so one
    // envelope satisfies both hosts.
    contents: [{
      role: "user",
      parts: [
        { inlineData: { mimeType: MIME[medium], data: billBase64 } },
        { text: PROMPT[medium][tone] },
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
                // Nullable together, and exactly one of them filled: a typed
                // bill gives the price of one where a till gives the line's
                // own total, and asking for a figure the page doesn't hold is
                // what makes a model invent one. `lineMinor` resolves the pair.
                amount: { type: "STRING", nullable: true },
                unitAmount: { type: "STRING", nullable: true },
                quantity: { type: "INTEGER", nullable: true },
              },
              required: ["label", "labelEn", "amount", "unitAmount", "quantity"],
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

