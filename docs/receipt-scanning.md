# Receipt scanning

*For: whoever builds or changes the scan. All of it is built and deployed;
[ADR-0016](decisions/0016-receipts.md) holds the UX rulings.*

Photograph a receipt, get the expense form filled in. One model call, one
Worker request, and a form you still have to look at before anything is saved.
Three screens start one: `/g/scan`, the camera above the ledger's "+", which is
the act with nothing else on screen; the form's own "Items" tab, for a
bill you reach for once the expense exists; and `/quick`, where there is no
group at all ([ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
All three call `useReceiptScan` and wear
`ScanPair` (`components/receipt-scan.tsx`), so neither the behaviour nor the
control can drift — one act, three doors, one button cut in two
([design-system.md](design-system.md#palette-roles)).

`/g/scan` and `/quick` both have to promise something they can't show, since a
scan's result is on another screen, so they draw it — one drawing,
`components/scan-diagram.tsx`, shared rather than copied: a bill of four lines
and a total — torn off at both ends, outlineless, so it reads as paper and not
as a second card — an arrow, and the expense that comes back — a title, that
same total, a date, and under them what the bill came to for three of the
people splitting it, which is what the Items tab would leave.

On `/g/scan` the drawing is the screen: under it, one line (`copy.scan.lede`)
says the two things it can only imply — the whole form comes back filled, and
the bill's own lines are a way to split it — and picture and line are one
block, centred with the control under it and a wide gap between the two, so the
drawing reads as what the control leads to rather than as a caption on it. The
drawing replaced a sentence saying the same thing, and that sentence is now its
`alt`.

On `/quick` it is the head of the screen instead (`.quickshow`), over the list
of who is splitting, with a line of its own: `copy.quick.lede`, not
`copy.scan.lede`, because what comes back there is the who-had-what grid and
then text to hand over, never the expense form the group's line promises. The
line sits above the picture here, not under it, so the screen opens on the
sentence rather than a drawing with nothing said about it yet. The generous
space is around the line-and-picture pair rather than inside it, so the
eyebrow under it reads as the next step and not as its caption. It divides its
bill between the people on that list, so it fills in with their names as they
are added.

The words are `copy.scan.diagram`, but the arithmetic isn't: `lib/scan/diagram.ts`
sums the shares from the same lines the left-hand card prints, and picks the
three names by the seed it is given — the group's id, or the quick split's
credential — so one group or one split sees the same faces each time and two
don't see the same ones. Fewer than three names borrows stand-ins. Nothing in the app would notice a picture whose shares stopped
adding to its own total — on the one screen whose whole job is reading totals
off receipts — so `diagram.test.ts` adds them up.

## The shape

```
phone: capture or pick from library → downscale → base64
  ↓ POST /api/groups/:id/scan   (body = the image; bearer = group secret)
worker: check the secret, wrap the image in our prompt + schema, add the API key
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

## The Worker owns the envelope

The client sends **the photo and nothing else** — the base64 JPEG as the whole
body, `text/plain`. The prompt and the response schema are Worker-side
constants (`apps/api/src/scan-body.ts`), so the only thing a caller decides is
which image Gemini reads.

That is deliberate, and it is what the endpoint is *for*. A scan credential
costs one unauthenticated request to mint — `ensureGroup` registers any id on
first sight, which is what a quick split relies on (below) — so the bearer check
is a speed bump, not a gate. What keeps our key off the open internet is that
there is no request a caller can compose: not a prompt, not a schema, not a
second image. The worst a minted credential buys is having a picture read.

## Minimal Cloudflare quota: the Worker still never touches the bytes

The free plan gives **10 ms CPU per request** and 100k requests/day. Requests
aren't the problem — a scan is one. CPU is, and only if we *deserialize* the
image: waiting on the upstream call is wall time, which doesn't count.

So the envelope is pre-encoded once per isolate and the photo is streamed
between its halves. The Worker never parses a body and never holds the image:

```ts
// apps/api/src/scan-body.ts — the prompt and schema, cut in two at the image
const [prefix, suffix] = JSON.stringify(buildScanRequestBody(SENTINEL)).split(SENTINEL);
// apps/api/src/index.ts — PREFIX, then the caller's bytes, then SUFFIX
body: wrapImage(c.req.raw.body, (err) => { refusal.err = err; }),
```

The rules that follow from it:

- **The Worker composes the request body; the client parses the response.** The
  prompt and the response schema live in `apps/api/src/scan-body.ts`. They used
  to live on the phone, for the CPU reason above — which the streamed envelope
  keeps, at the cost of one table lookup per byte.
- **That lookup is the security boundary, not a content-type nicety.** The
  caller's bytes land inside a JSON string, so a body carrying a `"` or a `\`
  closes that string and writes its own `contents` — the arbitrary request this
  endpoint exists not to forward. Base64 has neither character, so `wrapImage`
  rejects every byte outside its alphabet and the hole closes outright.
  `scan-body.test.ts` is mostly attempts to get a second field past it.
- **The client never names the destination.** URL, model and key are Worker-side
  constants. A client-supplied URL would make this an open proxy to anywhere
  with our key attached.
- **Downscale to ≤1024px long edge, JPEG ~0.7, target ≤200 KB**, encoded to
  base64 in the browser. Vision models don't read a receipt better above that.
  The Worker caps the body at `MAX_IMAGE_BYTES` (400 kB — that with room to
  spare), refusing on `content-length` before a byte is streamed anywhere, and
  counting again as it streams for the caller whose header lied.
- **One request per scan.** No automatic retry — a retry doubles both our
  requests and the shared daily Gemini quota. A failure says so and leaves the
  control enabled — the retry is the same button, not a second one.
- **No throttling, no counters, no D1 writes.** Auth is the existing
  `bearerToken` + `sha256Hex` check against the group row: one D1 read, no new
  table. It authenticates a *secret*, not a membership — which is what lets a
  quick split scan with a credential of its own (below). **Gemini's own free
  tier is the quota**: it caps the day and answers 429, which the app already
  reads as "busy". A cap of ours would add little and would hand one caller the
  power to spend everyone else's day.
- **Whoever is paying for the scan is the id in the path.** A group, or — for
  a quick split — the phone, which carries an id and a secret shaped like a
  group's and introduces the pair with an empty `POST …/ops` before each scan
  (`lib/quick.ts`, ADR-0035). One per phone rather than one per bill, because
  a stable caller is the unit anything we ever throttle would count; **if this
  ever needs a rate limit, that path parameter and `cf-connecting-ip` are what
  it has to key on**, and the scan handler is the one place to put it.

Nothing changes in `sw.js` — it already ignores non-GET and cross-origin, and
`/api/*` was never cached.

## What the model decides, and what it must not

It reads. It doesn't compute.

| It returns | Type |
|---|---|
| title | string → `description` — the merchant's name, minus the parts that aren't the name ("Bar Zahra - Sarl M. Benali" → "Bar Zahra"), plus two or three words of what was bought where the name alone wouldn't say ("Lidl - barbecue"). Nothing added when the merchant already says it, when the lines are too mixed, or when none are printed: a bare name beats a wrong guess. Cased as a name is written, never in the capitals a till prints ("BAR ZAHRA" → "Bar Zahra"), keeping the casing a brand owns ("IKEA", "H&M") |
| total | plain decimal notation, `parseMinor()`-ready: `"42.50"`, `"1234.50"` — the model normalizes whatever separators the receipt prints, never local code |
| tip | a separate tip/service-charge line, same normalized notation, or null |
| tax | tax charged *on top of* the lines, same notation, or null — VAT already inside the printed prices, which most European receipts break out near the foot, is not this and would be counted twice |
| discounts | every deduction the receipt prints, one entry each — `{ label, labelEn, amount }`, the amount written **without** a minus sign — a loyalty deduction, a voucher, a two-for-one credit, whether it printed against one item or against the whole bill; empty when it takes nothing off |
| currency | ISO 4217 if legible, else null |
| date | `YYYY-MM-DD` if legible, else null — trusted as printed, no date parser here |
| lineItems | `{ label, labelEn, amount, quantity }[]` — printed label (a label the printer wrapped over several rows is one item), English translation (null if already English), amount in the same normalized notation as `total` and equal to the figure in the receipt's own amount column — the line's extended total, never a unit price — and a count only when the receipt actually prints one (e.g. "2x", a qty column) — never inferred from repeated lines or defaulted to 1 |
| error | a short, lightly humorous sentence if the photo isn't a receipt or is unreadable (e.g. "Too blurry — I've read tea leaves with better odds."), else null — every other field is null/empty when set |

`normalizeScan` uses none of `lineItems`, `tip`, `tax` or `discounts`. `/g/entry/items` does —
reached by tapping the Items tab's button — "Assign who had what" on a bill
nobody has been given a line of, "Edit who-had-what" once somebody has —
building the grid that becomes a `receipt` split — its own mode, which is why
no screen has to ask a second field whether a split came off a bill
([ADR-0016](decisions/0016-receipts.md)). The screen is three bands rather than
a scrolling page: who was there in one sideways-scrolling line above, running
per-person totals stacked below, and the grid between them owning the vertical
scroll so its row of initials freezes while a long bill passes under it.
Everyone starts at the table and **nothing starts assigned**: ticking what you
had is the work, so the grid asks for it rather than handing you a bill already
split evenly to untick your way out of. Done is never grey: pressed on a bill
with a line nobody has been given, it refuses — the button and every unassigned
line's name and amount bloom together, and only then does the sentence under the
grid appear, until the last line has somebody
([design-system.md](design-system.md)). It waits for that press because on
arrival nothing is assigned yet, and a red line printed then scolds a grid for
being untouched.

**Tip, tax and discount are one family — `BillExtras`.** They are the lines a
bill charges for that nobody ordered, so none of them can be ticked for on the
grid: each is spread across everyone at the table in proportion to what they
*did* order, and the discount is the one that comes off. `readBill` (core)
gathers every deduction into `discounts` first, wherever it arrived — a
negative line item, a negative tip, the field itself — so the arithmetic
downstream sees positive lines and a list of figures that come off, and never a
sign to get the wrong way round. Only the tip is typed; the other two are read
off the bill and drawn as rows with no cells (`copy.items.extra`), and a caption
under them says so — naming only the charges this bill actually has
(`copy.items.extraNote`). It sits in the table rather than in the footer below
it, because it explains those rows and the footer's line is what to do next.

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
Items tab, and going is the person's decision (ADR-0016). The tab's own
complaint waits for a save attempt, the way the missing amount does: arriving
from `/g/scan` is now the ordinary way to be standing here, and a bill that
read perfectly well should not be met in red. Nor does a bill
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
  spends it, and a secret costs one request to mint. No per-group limits — the
  owner: *"assume maximum trust for now (we don't need per group throttling
  etc)"*. What that trust is now confined to is *having images read*: since the
  Worker owns the envelope, nobody can put their own prompt on our key.
- **Free tier trains on the input.** Google uses free-tier prompts to improve
  its products and human reviewers may see them. These are receipts: a place,
  a date, a card's last four. The scan button carries one plain line saying so,
  and since op bodies are sealed
  ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)) this is **the
  one thing in the app that leaves a phone readable** — `/about` names it as the
  exception rather than burying it in a clause.
- **Free-tier terms can change overnight.** If they do, scanning 404s and the
  button hides. The app is unaffected.

**If this is ever productionised**, the things to fix, in order: per-user keys
or a paid tier (kills both the shared-spend and the training problem), then a
rate limit (Cloudflare's rate-limiting binding keyed on the path id and
`cf-connecting-ip` — no D1 write, no counter to keep), then a decision about
whether the photo is stored at all. Turnstile in front of minting a credential
is the only one of these that answers *distributed* abuse.

## What it's made of

`packages/core/src/scan.ts` — the normaliser, no network · `apps/api`'s `POST
/api/groups/:id/scan`, the same bearer-token check as sync, passing through to
`GEMINI_MODEL = "gemini-3.1-flash-lite"` (one constant in `apps/api/src/index.ts`;
the key is the `GEMINI_API_KEY` Worker secret —
[hosting.md](hosting.md#deploying)) and the envelope is
`apps/api/src/scan-body.ts` (prompt, structured output schema, and the
base64 guard `scan-body.test.ts` attacks) · `apps/web/lib/scan/` — `downscale.ts`,
`response.ts`, `scanReceipt()` · `components/receipt-scan.tsx`, the hook all three scanning screens
share — `/g/scan`, the Items tab on `/g/entry/edit`, and `/quick` — with
the who-had-what grid (`components/who-had-what.tsx`) a tap behind the tab and
the screen after the scan respectively. The control they wear draws the round
trip as a bar filling over the ~2s a scan usually takes, falling back to the
spinner only when the model is slower
([design-system.md](design-system.md#palette-roles)). Where the scan is *up
to* is `lib/scan/live.ts`, a store keyed by group beside the draft rather than
state in the control: the bar is a clock on the scan (a negative
`animation-delay` puts a remounted bar where the scan actually is), so
switching tabs or stepping out to the payers editor no longer restarts it, and
a scan whose draft was discarded on the way out drops its result on arrival. Verified end to end
against the deployed Worker, 2026-08-28; discounts and tax added 2026-09-12 and
walked with `pnpm drive`'s `two-for-one` bill, grid to saved entry.

## Driving it without a phone

`pnpm drive`'s `receipt <name>` hands a phone one of the canned bills in
`scripts/fixtures/receipts/`; the scan button is then pressed like any other
control and everything but the round trip to Gemini really runs. It is the only
way to reach the who-had-what grid outside a real scan —
[testing.md](testing.md#pnpm-drive--the-app-as-text).

## Gotchas

- **`fetch` resolves when the response *headers* arrive, not when the request
  body finishes.** A streamed request body that errors after that point
  resolves the promise rather than rejecting it, so the `catch` around the
  upstream call never runs and a refused image answered **200**. Whatever a
  streaming body needs to report has to be read from a flag on both paths, not
  caught — which is what `refusal` in the scan handler is. Verified against
  workerd with the upstream pointed at a local echo.
- **A refusal still opens the upstream connection.** The alphabet check happens
  mid-stream, so by the time a bad body is found Gemini already has our prefix;
  refusing truncates the request, and what upstream receives is an unterminated
  JSON string and never the caller's bytes. Unavoidable while the image streams
  rather than being read, and harmless — a truncated request is not a request.
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
- **A screen coming back is not a scan starting.** "Reading…" and its bar were
  `useState` in the control, so the Items tab unmounting — a tab switch, or the
  payers editor — read as the scan ending, and coming back read as a new one:
  the sweep began again on a scan already two seconds old. What is durable is
  the scan, not the control drawing it.
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
