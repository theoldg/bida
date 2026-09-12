# Receipt scanning

*For: whoever builds or changes the scan. All of it is built and deployed;
[ADR-0016](decisions/0016-receipts.md) holds the UX rulings.*

Photograph a receipt, get the expense form filled in. One model call, one
Worker request, and a form you still have to look at before anything is saved.
Two screens start one: `/g/scan`, the camera above the ledger's "+", which is
the act with nothing else on screen; and the form's own "Receipt" tab, for a
bill you reach for once the expense exists. Both call `useReceiptScan` and wear
`ScanPair` (`components/receipt-scan.tsx`), so neither the behaviour nor the
control can drift — one act, two doors, one button cut in two
([design-system.md](design-system.md#palette-roles)).

`/g/scan` has to promise something it can't show, since a scan's result is on
another screen, so it draws it: a bill of four lines and a total — torn off at
both ends, outlineless, so it reads as paper and not as a second card — an arrow, and
the expense that comes back — a title, that same total, a date, and under them
what the bill came to for three of the group's own members, which is what the
Receipt tab would leave. Under the drawing, one line (`copy.scan.lede`) says
the two things it can only imply: the whole form comes back filled, and the
bill's own lines are a way to split it. Picture and line are one block, centred
with the control under it and a wide gap between the two, so the drawing reads
as what the control leads to rather than as a caption on it. The drawing
replaced a sentence saying the same thing, and that sentence is now its `alt`.

The words are `copy.scan.diagram`, but the arithmetic isn't: `lib/scan/diagram.ts`
sums the shares from the same lines the left-hand card prints, and picks the
three members by the group's id, so a group sees the same faces each time and
two groups don't see the same ones. A group of fewer than three borrows
stand-ins. Nothing in the app would notice a picture whose shares stopped
adding to its own total — on the one screen whose whole job is reading totals
off receipts — so `diagram.test.ts` adds them up.

## The shape

```
phone: capture or pick from library → downscale → build the request body
  ↓ POST /api/groups/:id/scan   (bearer = group secret)
worker: check the secret, add the API key, stream the body upstream
  ↓
Gemini Flash, free tier, one key shared by everyone
  ↑ response streamed straight back, untouched
phone: parse → normalizeScan() → write an EntryDraft, and stop
```

The scan ends at [`lib/draft.ts`](../apps/web/lib/draft.ts). That's the whole
integration: a draft is *"not a fact about the world yet"*, which is exactly
what a machine's reading of a crumpled receipt is. You review the form, and
saving appends the op the way it always did — one `actor`, one human, no new op
kinds, no schema change, nothing on the log that nobody looked at.

## Why the key sits on the Worker

The owner wanted the call to leave from the phone. Only Anthropic ships a
browser-callable API; `generativelanguage.googleapis.com` fails CORS preflight,
so a device-direct call to Gemini isn't available. Free tier means no card, no
per-user signup, and hosting stays £0 — the price is a shared key behind our own
endpoint, and **Trust** below is what that costs.

## Minimal Cloudflare quota: the Worker never touches the bytes

The free plan gives **10 ms CPU per request** and 100k requests/day. Requests
aren't the problem — a scan is one. CPU is, and only if we *deserialize* the
image: waiting on the upstream call is wall time, which doesn't count.

So the Worker is a pipe that adds a credential:

```ts
// apps/api/src/index.ts — no parse, no re-serialize, no base64 in our heap
const upstream = await fetch(GEMINI_URL, {
  method: "POST",
  headers: { "x-goog-api-key": c.env.GEMINI_API_KEY, "content-type": "application/json" },
  body: c.req.raw.body,                     // ReadableStream, passed through
});
return new Response(upstream.body, { status: upstream.status });
```

The rules that follow from it:

- **The client composes the request body and parses the response.** The prompt
  and the response schema live in `apps/web/lib/scan/`, not in the Worker.
- **The client never names the destination.** URL, model and key are Worker-side
  constants. A client-supplied URL would make this an open proxy to anywhere
  with our key attached.
- **Downscale to ≤1024px long edge, JPEG ~0.7, target ≤200 KB**, encoded to
  base64 in the browser. Vision models don't read a receipt better above that,
  and it keeps the streamed body small enough that the fallback path
  (`await c.req.text()`, if stream passthrough misbehaves) still fits in 10 ms.
- **One request per scan.** No automatic retry — a retry doubles both our
  requests and the shared daily Gemini quota. A failure says so and leaves the
  control enabled — the retry is the same button, not a second one.
- **No throttling, no counters, no D1 writes.** Auth is the existing
  `bearerSecret` + `sha256Hex` check against the group row: one D1 read, no new
  table, and it's the difference between "my friends" and "the internet".

Nothing changes in `sw.js` — it already ignores non-GET and cross-origin, and
`/api/*` was never cached.

## What the model decides, and what it must not

It reads. It doesn't compute.

| It returns | Type |
|---|---|
| title | string → `description` — the merchant's name, minus the parts that aren't the name ("Bar Zahra - Sarl M. Benali" → "Bar Zahra"), plus two or three words of what was bought where the name alone wouldn't say ("Lidl - barbecue"). Nothing added when the merchant already says it, when the lines are too mixed, or when none are printed: a bare name beats a wrong guess |
| total | plain decimal notation, `parseMinor()`-ready: `"42.50"`, `"1234.50"` — the model normalizes whatever separators the receipt prints, never local code |
| tip | a separate tip/service-charge line, same normalized notation, or null |
| tax | tax charged *on top of* the lines, same notation, or null — VAT already inside the printed prices, which most European receipts break out near the foot, is not this and would be counted twice |
| discounts | every deduction the receipt prints, one entry each — `{ label, labelEn, amount }`, the amount written **without** a minus sign — a loyalty deduction, a voucher, a two-for-one credit, whether it printed against one item or against the whole bill; empty when it takes nothing off |
| currency | ISO 4217 if legible, else null |
| date | `YYYY-MM-DD` if legible, else null — trusted as printed, no date parser here |
| lineItems | `{ label, labelEn, amount, quantity }[]` — printed label (a label the printer wrapped over several rows is one item), English translation (null if already English), amount in the same normalized notation as `total` and equal to the figure in the receipt's own amount column — the line's extended total, never a unit price — and a count only when the receipt actually prints one (e.g. "2x", a qty column) — never inferred from repeated lines or defaulted to 1 |
| error | a short, lightly humorous sentence if the photo isn't a receipt or is unreadable (e.g. "Too blurry — I've read tea leaves with better odds."), else null — every other field is null/empty when set |

`normalizeScan` uses none of `lineItems`, `tip`, `tax` or `discounts`. `/g/entry/items` does —
reached by tapping the Receipt tab's button — "Assign who had what" on a bill
nobody has been given a line of, "Edit who-had-what" once somebody has —
building the grid that becomes a `receipt` split — its own mode, which is why
no screen has to ask a second field whether a split came off a bill
([ADR-0016](decisions/0016-receipts.md)). The screen is three bands rather than
a scrolling page: who was there in one sideways-scrolling line above, running
per-person totals stacked below, and the grid between them owning the vertical
scroll so its row of initials freezes while a long bill passes under it.
Everyone starts at the table and **nothing starts assigned**: ticking what you
had is the work, so the grid asks for it rather than handing you a bill already
split evenly to untick your way out of. Done stays disabled until every line
has somebody.

**Tip, tax and discount are one family — `BillExtras`.** They are the lines a
bill charges for that nobody ordered, so none of them can be ticked for on the
grid: each is spread across everyone at the table in proportion to what they
*did* order, and the discount is the one that comes off. `readBill` (core)
gathers every deduction into `discounts` first, wherever it arrived — a
negative line item, a negative tip, the field itself — so the arithmetic
downstream sees positive lines and a list of figures that come off, and never a
sign to get the wrong way round. Only the tip is typed; the other two are read
off the bill and drawn as rows with no cells (`copy.items.extra`).

**The deductions are kept apart, not summed.** They divide identically either
way, so this is for the reader: "Discounts −9.25" cannot tell a two-for-one
from a loyalty card. Several of them collapse into one row wearing the same
`×N` the repeated items wear, and open into the names the bill printed —
display only, since the rows aren't assignable either way, so unlike an item's
unfold it writes nothing to the draft. Each person's own copy of the bill names
them one by one too (`billCharges`, `receiptBreakdown`).

Proportional is the reading [ADR-0016](decisions/0016-receipts.md) settles on,
and the argument is the "buy 1 get 1 free" the owner asked about — ham pizza
10, cheese pizza 8, discount 8. The credit exists because *both* pizzas were
bought, so giving all of it to the cheaper one leaves the other person paying
full price for a promotion their order created. Pro rata (5.56 / 4.44) is the
same rule a whole-bill loyalty deduction follows, scoped to what it came off,
which is why the code has one rule and not two. A whole-bill discount, pooled
this way, leaves every ratio between people exactly where the items put them —
it is only the total that moves.

`quantity` never multiplies anything — `amount` is already the line's printed
total. It says how many rows that line **unfolds** into on the grid, and — with
the number of people on the row — how much of it each of them had.

The grid is kept on the expense, so the entry screen can read it back:
`receiptBreakdown` returns the split weights *and* the lines they were summed
from, and each person's row on a scanned expense opens onto their own copy of
the bill — "Beer ×2", "Fries ×1 1/2", "Tagine ×1/3", the tip ruled off below what
was ordered. Opened, the row and its lines are one highlighted band with a rule
down its edge (the grid's own way of saying "these are one thing"), and each
line carries a printed bill's dotted leader out to its figure. Both
come out of one pass, so a row and the lines under it cannot disagree.

`normalizeScan()` in `packages/core/src/scan.ts` turns the rest into an
`EntryDraft` patch: `total` passes straight through as `amountText` — the
prompt already asks the model for `parseMinor()`-ready notation, so there's no
separator-guessing to do locally. Conversion to minor units stays where it
already is — `parseMinor` on save. The scan asks for no category: an expense
carries a `categoryId`, but nothing in the app makes a category or maps a name
to an id, so the field went out with nowhere to land (Categories is still a
roadmap line). Two prompt lines and a schema property bring it back.

Two fields the model doesn't get the last word on:

- **The currency** is uppercased and then has to pass `isCurrencyCode` — three
  ASCII letters, the only thing `Intl.NumberFormat` accepts. Anything else is
  dropped and the draft keeps the currency it had. Dropped, not repaired:
  clipping "USDT" to "USD" banks a number in a currency nobody named.
- **The date** becomes local midnight of the printed day, built from the
  `YYYY-MM-DD` parts. The app reads instants back in local time everywhere, so
  a UTC-midnight stamp files a receipt under the previous day west of
  Greenwich.

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

**A scan never navigates.** Finding lines used to push straight to the
who-had-what grid, which made every scan a commitment to itemise a bill
somebody may only have wanted the total off; the grid is one tap away on the
Receipt tab, and going is the person's decision (ADR-0016). The tab's own
complaint waits for a save attempt, the way the missing amount does: arriving
from `/g/scan` is now the ordinary way to be standing here, and a bill that
read perfectly well should not be met in red. Nor does a bill
with no lines claim that tab — there is nothing to assign, so it leaves the
split where it was. `/g/scan` is the near-exception: holding a filled draft
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
missing the printed total by any amount, a non-positive total included
(`mismatch`). No tolerance: a bill the app can't reconcile prices the
who-had-what grid against a total the receipt never printed, silently. Refusing
costs one more photo — which is what `copy.scan.problem.mismatch` asks for, in
the words that actually help: flatter, square-on (see Gotchas). A deduction
counted twice — once as a negative line and once in `discount` — lands here
too, which is the safe way for that particular misreading to fail.

Two conditions of the *phone* are told apart from that, because neither has
anything to do with the photo and the generic message sent people back to
re-shoot a receipt that was fine: a `429`/`503` from Gemini throws
`ScanUnavailableError` ("Gemini is busy"), and — **scanning being the one act in
the app that needs a network** — an offline phone throws `ScanOfflineError`,
checked before the downscale and again on a rejecting `fetch`, which is the
captive portal `navigator.onLine` calls online. The words are `copy.scan.*`
([ADR-0033](decisions/0033-every-word-in-one-file.md)); `scanErrorText` maps
error to sentence. Anything else falls back to the generic message.

## Trust, and what we're accepting

Deliberate, for a group of friends under fifty people:

- **One key, shared globally.** Anyone with the app URL and a group secret
  spends it. No per-group limits — the owner: *"assume maximum trust for now
  (we don't need per group throttling etc)"*.
- **Free tier trains on the input.** Google uses free-tier prompts to improve
  its products and human reviewers may see them. These are receipts: a place,
  a date, a card's last four. The scan button carries one plain line saying so.
- **Free-tier terms can change overnight.** If they do, scanning 404s and the
  button hides. The app is unaffected.

**If this is ever productionised**, the things to fix, in order: per-user keys
or a paid tier (kills both the shared-spend and the training problem), then
per-group quota, then a decision about whether the photo is stored at all.

## What it's made of

`packages/core/src/scan.ts` — the normaliser, no network · `apps/api`'s `POST
/api/groups/:id/scan`, the same bearer-secret check as sync, passing through to
`GEMINI_MODEL = "gemini-3.1-flash-lite"` (one constant in `apps/api/src/index.ts`;
the key is the `GEMINI_API_KEY` Worker secret —
[hosting.md](hosting.md#deploying)) · `apps/web/lib/scan/` — `downscale.ts`,
`request.ts` (prompt and structured output schema), `response.ts`,
`scanReceipt()` · `components/receipt-scan.tsx`, the hook both scanning screens
share — `/g/scan` and the Receipt tab on `/g/entry/edit` — with
`/g/entry/items` a tap behind the tab. The control they wear draws the round
trip as a bar filling over the ~2s a scan usually takes, falling back to the
spinner only when the model is slower
([design-system.md](design-system.md#palette-roles)). Verified end to end
against the deployed Worker, 2026-08-28; discounts and tax added 2026-09-12 and
walked with `pnpm drive`'s `two-for-one` bill, grid to saved entry.

## Driving it without a phone

`pnpm drive`'s `receipt <name>` hands a phone one of the canned bills in
`scripts/fixtures/receipts/`; the scan button is then pressed like any other
control and everything but the round trip to Gemini really runs. It is the only
way to reach the who-had-what grid outside a real scan —
[testing.md](testing.md#pnpm-drive--the-app-as-text).

## Gotchas

- **A discount is spread across everybody, and that is a decision, not a
  fallback.** The grid has no way to say who a particular credit belongs to, so
  there is no "this voucher was on my dish" to honour — and pro rata is the
  answer with the best argument anyway (see above, and ADR-0016). If per-item
  scope is ever wanted, the seam is `readBill`: stop pooling, and give a
  deduction the lines it came off.
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
- `gemini-2.5-flash` is **404 for new keys**, and Google's error names the
  replacement. If `3.1-flash-lite` ever goes the same way, try the current
  `-latest` alias before assuming the free tier is gone. A 503 on the same key
  at the same moment is overload, not a verdict on the model.
- **A scan that navigates has to be ordered against anything else wanting the
  screen, so it stopped navigating.** Opening the rate dialog and calling
  `router.push` in the same tick is not a sequence — the navigation unmounts
  the dialog before anybody sees it — and the sequencing state that fixed it
  outlived its usefulness the moment the grid became a tap rather than a
  destination.
- **What a bill is worth is asked of `receiptWeights` (lib/draft.ts), never of
  `weightsFromItems` under it.** Dividing a line leaves a remainder cent, and
  only `tiebreakSeed` says whose it is; the grid picked its own (`"new"`, from
  before the draft carried the id its entry would be written under) and so
  quoted €22.25 for someone the form then saved at €22.24 — two screens read
  one after the other. The wrapper takes the rows and names the seed itself, so
  a caller cannot get it wrong, and `pnpm rules` fails on a screen that reaches
  past it.
- **Two things that mean different things to a person are two things in the
  code, however alike their arithmetic.** A receipt split was a `shares` spec
  with a flag beside it, and every screen naming a split had to read both: the
  ledger row called a scanned bill "as parts", the log counted its weights as
  parts ("Teo ×3943 parts"), and the flag kept saying "Receipt" over a split
  somebody had switched back to Evenly. `receipt` is a `SplitMode` now and the
  flag is gone — upgraded on the way out of the op log (`upgradeReceiptSplit`).
- **A model field that reaches `formatMinor` is a crash waiting to happen.**
  `Intl.NumberFormat` throws on anything but three ASCII letters, the form
  formats on every render, and there is no error boundary — one "€" in the
  scan's `currency` white-screened the screen you were typing on.
- `validateSplit(0, spec)` reads as **fully allocated**, not incomplete
  (`allocated === total === 0`) — it printed "€0.00 of €0.00 allocated" under a
  green check in four places. The verdict is `splitFooter`'s (`lib/format.ts`)
  now, so the string is unreachable rather than guarded per call site.
- **Don't write a derived value into the draft for another screen's effect to
  resync.** That resync is only as reliable as the next mount happening before
  anyone reads the value, and a screen that writes the input then navigates away
  (`/g/entry/items`'s "Done") beats it. Recompute inline instead — and where one
  tab derives what another tab merely reads, closing it needs an explicit
  handoff, or leaving Receipt zeroes the amount.
