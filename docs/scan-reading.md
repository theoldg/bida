# What a scan reads

*For: anyone changing the prompt, the schema, or what the app does with an
answer. Part of the [receipt-scanning](receipt-scanning.md) docs; the grid the
line items go on is [who-had-what.md](who-had-what.md), and how the prompt
reaches the model is [scan-worker.md](scan-worker.md).*

## What the model decides, and what it must not

It reads. It doesn't compute — the one multiplication in the whole reading is
`lineMinor`'s, here, on figures the bill stated. The table below is the
photograph's reading; a typed bill answers the same schema by its own prompt,
and differs in the three places [Typing a bill in](receipt-scanning.md#typing-a-bill-in) names.

| It returns | Type |
|---|---|
| title | string → `description` — the merchant's name, minus the parts that aren't the name ("Bar Zahra - Sarl M. Benali" → "Bar Zahra"), plus two or three words of what was bought where the name alone wouldn't say ("Lidl - barbecue"). Nothing added when the merchant already says it, when the lines are too mixed, or when none are printed: a bare name beats a wrong guess. |
| total | plain decimal notation, `parseMinor()`-ready: `"42.50"`, `"1234.50"` — the model normalizes whatever separators the receipt prints, never local code. Only ever a figure the bill itself states: null where it states none, and never added up ([what a reading is checked against](#what-a-reading-is-checked-against)) |
| tip | a separate tip/service-charge line, same normalized notation, or null |
| tax | tax charged *on top of* the lines, same notation, or null — VAT already inside the printed prices, which most European receipts break out near the foot, is not this and would be counted twice |
| discounts | every deduction the receipt prints, one entry each — `{ label, labelEn, amount }`, the amount written **without** a minus sign — a loyalty deduction, a voucher, a two-for-one credit, whether it printed against one item or against the whole bill; empty when it takes nothing off |
| currency | ISO 4217 if legible, else null |
| date | `YYYY-MM-DD` if legible, else null — trusted as printed, no date parser here |
| lineItems | `{ label, labelEn, amount, unitAmount, quantity }[]` — printed label (a label the printer wrapped over several rows is one item), English translation (null if already English), a count only when the bill actually states one (e.g. "2x", a qty column) — never inferred from repeated lines or defaulted to 1 — and **exactly one of the two figures**, in the same normalized notation as `total`. `amount` is what the whole line came to, which is what a till prints and so always the photograph's answer; `unitAmount` is the price of one, which is how somebody typing writes it ("3 chicken at 13 each"), and `lineMinor` multiplies it by the count |
| english | whether the bill is written in English — true clears every `labelEn` on it in `readBill`. Asked line by line, the model "translates" an English bill's shorthand ("Chkn wrap" → "Chicken wrap") and the translate toggle turns up with nothing to translate; asked once for the whole bill, it doesn't |
| error | a short, lightly humorous sentence if the photo isn't a receipt or is unreadable (e.g. "Too blurry — I've read tea leaves with better odds."), else null — every other field is null/empty when set. In Staś mode the same sentence, delivered as an insult aimed at the photographer ([scan-worker.md](scan-worker.md#staś-mode)) |

**Nothing comes back in the printer's capitals.** A till shouts every string it
prints, and the title, the line-item labels and the discount labels are all
written the way a name is written instead: "BAR ZAHRA" → "Bar Zahra", "POULET
ROTI" → "Poulet roti", keeping the casing a brand owns ("IKEA", "H&M",
"lululemon"). The casing is the only thing the reading changes about a label —
the words, their language and their spelling are the receipt's, or the person
checking the grid against the paper is comparing two different bills.

**Both labels are kept**, `label` and `labelEn` together, all the way onto the
expense. The bill reads as printed everywhere by default, and the translation
icon in the who-had-what bar switches every line to English — the grid, each
person's copy of the bill on the entry screen, and the text a quick split is
handed over as. It is drawn only where the model gave a translation on some
line (`hasTranslation`), so never on a bill it called English, and remembered
per phone and not per group (`DeviceRecord.billEnglish`): it is how one person
reads, not a fact about the bill. A line the model left untranslated keeps its printed label rather than
going blank. `billLabel` (`web/lib/scan/items.ts`) is the only place either is
chosen; the draft's own labels are never overwritten, or splitting a line would
write the translation back as the bill's own words.

`normalizeScan()` in `packages/core/src/scan.ts` turns the rest into an
`EntryDraft` patch: `total` passes straight through as `amountText` — the
prompt already asks the model for `parseMinor()`-ready notation, so there's no
separator-guessing to do locally. Conversion to minor units stays where it
already is — `parseMinor` on save. The scan asks for no category: an expense
carries a `categoryId`, but nothing in the app makes a category or maps a name
to an id (Categories is deferred —
[product.md](product.md#deliberately-not-in-the-mvp)). Two prompt lines and a
schema property would add it.

Two fields the model doesn't get the last word on:

- **The currency** is uppercased and then has to pass `isCurrencyCode` — three
  ASCII letters, the only thing `Intl.NumberFormat` accepts. Anything else is
  dropped and the draft keeps the currency it had. Dropped, not repaired:
  clipping "USDT" to "USD" banks a number in a currency nobody named.
- **The date** becomes local midnight of the printed day, built from the
  `YYYY-MM-DD` parts — unless the printed day is *today*, which takes the
  moment of the scan instead, since that is roughly when you paid. Local
  midnight, not UTC: the app reads instants back in local time everywhere, so
  a UTC-midnight stamp files a receipt under the previous day west of
  Greenwich. `normalizeScan` takes that clock as an argument, like everything
  else in core, and returns `dateOnly` beside the stamp: the printed day is all
  a backdated receipt knows, and the entry carries that as a fact rather than
  leaving midnight to be read as an hour. The rule is not the scan's — an entry
  dated by hand onto another day loses its time the same way
  ([data-model.md](data-model.md#a-day-without-a-time)).

**Never the model's job:** arithmetic, the FX rate (frozen manually, ADR-0005),
who paid, or how it splits. It reads what's printed and leaves the ledger alone.

**A scan is a guess, and it defers to a person.** The title lands in
`description` only when that field is empty or still holds the *previous*
scan's title (`EntryDraft.scannedDescription`), so a rescan can correct
itself without renaming an expense somebody named. The adapting is the model's
— it holds the whole page, and the alternative is a local rule guessing at
which half of "Hotel Amira, 12 Rue Bab Doukkala" is the name. It is a title,
not a reading, which is why the field is `title` and not `merchant`: nothing
downstream treats it as the merchant of record.

**A scan never navigates.** Pushing to the who-had-what grid would make every
scan a commitment to itemise a bill somebody may only want the total off; the
grid is one tap away on the Items tab, and going is the person's decision
(ADR-0016). The tab's own complaint waits for a save attempt, the way the
missing amount does: a bill that read perfectly well should not be met in red.
Nor does a bill
with no lines claim that tab — there is nothing to assign, so it leaves the
split where it was. **Nor does one that has lines, if the tab moved while the
model read** (`tabAfterScan`, lib/draft.ts): tapping Evenly is a decision about
how this expense divides, and an answer landing two seconds later and dragging
the form back to Items overrules a person with a stale intention. Started from
Items and left there, it claims Items; started from `/g/scan`, which has no tab
bar to move off, it claims Items too. `/g/scan` is the near-exception: holding a filled draft
and no form to show it on, it hands over with `replace` (back from the form is
the ledger), and only if it is still on screen, since a scan outlives the
screen that started it. It seeds the draft under the key the form uses for a
blank expense, which is what makes the form adopt it rather than seed over it.

With nothing racing it, a receipt in a currency the group has no rate for
simply opens the rate dialog — asked for by the currency the *draft* holds
rather than by the act of picking one, so a scan from either screen reaches
it. One ref keeps it to a single ask: dismissing the dialog leaves the
currency exactly as it was.

**Whether the photo is readable is the model's call too.** It sets `error` to a
short sentence — a light joke at its own expense, never the photographer's, that
still names what to re-shoot — instead of guessing at the other fields.
`scanReceipt()` throws `ScanRejectedError` carrying that sentence, and the form
prints it verbatim.

**Whether it adds up is not the model's call.** `checkScan` (core) is an
absolute arithmetic bar, and `scanReceipt` throws `ScanUnreliableError` at the
first thing it finds: a total it can't read (`no-total`), a line or an extra it
can't read (`unreadable-line`), or lines plus tip plus tax less the discounts
missing the total by any amount, a non-positive total included (`mismatch`). No
tolerance: a bill the app can't reconcile prices the who-had-what grid against a
total the receipt never printed, silently. Refusing costs one more photo — which
is what `copy.scan.problem.mismatch` asks for, in the words that actually help:
flatter, square-on (see Gotchas). A deduction counted twice — once as a negative
line and once in `discount` — lands here too, which is the safe way for that
particular misreading to fail.

### What a reading is checked against

The bar above needs a total that is **evidence**, and only one medium always
has one. A till roll prints one, so a photograph with none is a cropped
photograph and is refused. A typed bill usually has none, and demanding one
would refuse almost every bill anybody types.

So `checkScan` takes the medium, and reconciles only against a figure the bill
itself stated. Where a typed bill states none, its lines *are* the bill:
`billTotalMinor` sums them with the extras, `normalizeScan` puts that in the
amount field, and the sum is not then checked against itself. That is not a
weaker check but an honest one. The alternative on offer — asking the model for
a total when the page has none — is worse than no check at all: a model told the
lines must equal the total closes the gap by adjusting a line, and a bill that
has been *made* to add up is the one error this function cannot see.

Two conditions of the *phone* are told apart from that, because neither has
anything to do with the photo and the generic message would send people back to
re-shoot a receipt that was fine: a `429`/`503` from Gemini throws
`ScanUnavailableError` ("Gemini is busy"), and — **scanning being the one act in
the app that needs a network** — an offline phone throws `ScanOfflineError`,
checked before the downscale and again on a rejecting `fetch`, which is the
captive portal `navigator.onLine` calls online. The words are `copy.scan.*`
([ADR-0033](decisions/0033-every-word-in-one-file.md)); `scanErrorText` maps
error to sentence. Anything else falls back to the generic message.

## Gotchas

- **VAT printed for information is not tax charged on top.** Most European
  receipts show "of which VAT 20%" under a total that already includes it;
  adding that figure charges the table for it twice, and the bill then misses
  its own printed total. The prompt says so twice, and `checkScan` catches it
  when the model does it anyway.
- **`mismatch` on a bill that plainly adds up means the photo was taken at an
  angle.** The shear pulls the amount column out of line with the labels, and a
  wrapped continuation row ends up taking an amount of its own — one line lost
  or one counted twice. Re-shot square-on, the same receipt reads fine, so the
  prompt describes a sheared page and the copy asks for the flatter photo.
  What the prompt must never carry is the arithmetic it is checked against: a
  model told the lines have to equal the total closes the gap by adjusting a
  line, and a bill that has been made to add up is the one error `checkScan`
  cannot see.
- **A rule written for one field governs one field.** A casing rule written
  for the *title* leaves every label in the till's capitals. Where a convention is about how
  a string is written rather than which string it is, give it its own paragraph
  naming every field it covers (`PHOTO_CASING`).
- **A model field that reaches `formatMinor` is a crash waiting to happen.**
  `Intl.NumberFormat` throws on anything but three ASCII letters, the form
  formats on every render — one "€" in the scan's `currency` white-screens the
  form.
