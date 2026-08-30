# Receipt scanning

*For: whoever builds or changes the scan. Core, Worker endpoint, the
client-side scan lib, the button and the item-assignment screen all exist and
are deployed. See [ADR-0016](decisions/0016-receipt-scan-ux-and-item-assignment.md)
for the UX decisions.*

Photograph a receipt, get the expense form filled in. One model call, one
Worker request, and a form you still have to look at before anything is saved.
The scan/upload buttons and "Edit who-had-what" live on the expense form's
"Receipt" tab, the fourth alongside Evenly/As parts/As amounts
([ADR-0018](decisions/0018-receipt-as-a-fourth-split-tab.md)).

## The shape

```
phone: capture or pick from library → downscale → build the request body
  ↓ POST /api/groups/:id/scan   (bearer = group secret)
worker: check the secret, add the API key, stream the body upstream
  ↓
Gemini Flash, free tier, one key shared by everyone
  ↑ response streamed straight back, untouched
phone: parse → normalizeScan() → write an ExpenseDraft → /g/expense
```

The scan ends at [`lib/draft.ts`](../apps/web/lib/draft.ts). That's the whole
integration: a draft is *"not a fact about the world yet"*, which is exactly
what a machine's reading of a crumpled receipt is. You review the form, and
saving appends the op the way it always did — one `actor`, one human, no new op
kinds, no schema change, nothing on the log that nobody looked at.

## Why the key sits on the Worker

Only Anthropic ships a browser-callable API (`anthropic-dangerous-direct-browser-access`);
`generativelanguage.googleapis.com` fails CORS preflight, so a device-direct
call to Gemini isn't available. Free tier means no card, no per-user signup, and
hosting stays £0 — the price is a shared key behind our own endpoint. See
**Trust** below for what that costs and ADR-0016 (to be written with the code).

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
  requests and the shared daily Gemini quota. A failure shows a "try again"
  button and lets the person decide.
- **No throttling, no counters, no D1 writes.** Auth is the existing
  `bearerSecret` + `sha256Hex` check against the group row: one D1 read, no new
  table, and it's the difference between "my friends" and "the internet".

Nothing changes in `sw.js` — it already ignores non-GET and cross-origin, and
`/api/*` was never cached.

## What the model decides, and what it must not

It reads. It doesn't compute.

| It returns | Type |
|---|---|
| merchant | string → `description` |
| total | plain decimal notation, `parseMinor()`-ready: `"42.50"`, `"1234.50"` — the model normalizes whatever separators the receipt prints, never local code |
| tip | a separate tip/service-charge line, same normalized notation, or null |
| currency | ISO 4217 if legible, else null |
| date | `YYYY-MM-DD` if legible, else null — trusted as printed, no date parser here |
| category | one of the group's, or null |
| lineItems | `{ label, labelEn, amount, quantity }[]` — printed label, English translation (null if already English), amount in the same normalized notation as `total`, and a count only when the receipt actually prints one (e.g. "2x", a qty column) — never inferred from repeated lines or defaulted to 1 |
| error | a short, lightly humorous sentence if the photo isn't a receipt or is unreadable (e.g. "Too blurry — I've read tea leaves with better odds."), else null — every other field is null/empty when set |

`lineItems` and `tip` are still unused by `normalizeScan` — the real
restaurant-splitting entity in product.md's deferred table isn't built. But
`/g/expense/items` (reached right after a scan that found line items, or via
"Edit who-had-what" later) reads them off the draft to build a who-had-what
grid, and reduces that to an ordinary `shares` split — no schema change, no
new op kind. The screen is three bands, not a scrolling page: who was there
above, the running per-person totals below, and the grid between them owning the
scroll, so its row of initials freezes while a long bill passes under it. The items, tip and the grid's own assignment are also written
onto the expense as plain optional fields so the grid reopens later, on any
device — [ADR-0016](decisions/0016-receipt-scan-ux-and-item-assignment.md),
[ADR-0017](decisions/0017-receipt-items-persist-on-the-expense.md).

`quantity` never multiplies anything — `amount` is already the line's printed
total, so folding the count into it too would double-count. It does one job on
the who-had-what grid: it's how many rows that line **unfolds** into. Tapping
the "×2" on a row replaces it with two, each a portion of the printed amount
with its own eaters — Alice and Bob shared one salad, Charlie had the other —
and tapping it again merges them back. Portions carry `portionOf` and sum to
the printed line exactly, so the bill's total never moves
([ADR-0022](decisions/0022-unfolding-a-receipt-line-into-portions.md)).

`normalizeScan()` in `packages/core/src/scan.ts` turns the rest into an
`ExpenseDraft` patch: `total` passes straight through as `amountText` — the
prompt already asks the model for `parseMinor()`-ready notation, so there's no
separator-guessing to do locally — plus an uppercased currency and
`occurredAt` from the printed date. Conversion to minor units stays where it
already is — `parseMinor` on save. `category` passes through as a name;
matching it to the group's actual category id is the caller's job, since core
doesn't know a group's categories.

**Never the model's job:** arithmetic, the FX rate (frozen manually, ADR-0005),
who paid, or how it splits. It reads what's printed and leaves the ledger alone.

A photo that isn't a receipt (or is too blurry/cut off to read) is the
model's call too: it sets `error` to a short sentence — the prompt asks for a
light joke at the model's own expense, never the photographer's, that still
names what to re-shoot — instead of guessing at the other fields. `scanReceipt()` (`apps/web/lib/scan/index.ts`) turns that
into a thrown `ScanRejectedError` whose message *is* the model's sentence;
the expense form shows it verbatim on the Receipt tab in place of the
generic "Couldn't read that receipt." A `429`/`503` from Gemini (rate limited
or overloaded — the free tier hits this, see **Verified live** below) is
distinguished the same way, as `ScanUnavailableError`, so the person sees
"Gemini's busy right now" rather than a message indistinguishable from a bad
photo. Any other failure (network, other non-2xx, malformed JSON) still
falls back to the generic message.

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
`GEMINI_MODEL = "gemini-3.6-flash"` (one constant in `apps/api/src/index.ts`;
the key is the `GEMINI_API_KEY` Worker secret —
[hosting.md](hosting.md#deploying)) · `apps/web/lib/scan/` — `downscale.ts`,
`request.ts` (prompt and structured output schema), `response.ts`,
`scanReceipt()` · the camera and library buttons on `/g/expense/edit`, which
share one handler, and `/g/expense/items` behind them.

The decisions it accumulated, each one still worth reading before changing this:
[0016](decisions/0016-receipt-scan-ux-and-item-assignment.md) the grid reduces
to an ordinary `shares` split ·
[0017](decisions/0017-receipt-items-persist-on-the-expense.md) the bill and grid
persist on the expense, reopenable from any device ·
[0018](decisions/0018-receipt-as-a-fourth-split-tab.md) both live in a fourth
"Receipt" tab beside Evenly/As parts/As amounts ·
[0019](decisions/0019-receipt-mode-owns-the-total.md) Receipt owns the total and
the tab choice persists ·
[0020](decisions/0020-receipt-total-and-split-are-derived-not-cached.md) total
and split are derived at read time, never cached ·
[0021](decisions/0021-leaving-receipt-mode-hands-the-total-back.md) leaving
Receipt hands the total back ·
[0022](decisions/0022-unfolding-a-receipt-line-into-portions.md) a counted line
unfolds into portions.

## Verified live, 2026-08-28

Direct curls to `generativelanguage.googleapis.com`, then the same request
through the deployed Worker (`hajsik.hajsik-api.workers.dev`) with a throwaway
group and its secret:

- `gemini-2.5-flash` is **404 for new keys** — Google's own error names the
  replacement: *"no longer available to new users... use
  models/gemini-3.6-flash."* `gemini-3.7-flash` and `gemini-flash-latest` both
  came back 503 (overloaded) on the same key at the same moment, so that's not
  a verdict on those models either way — if `3.6-flash` ever 404s the same way,
  try the current `-latest` alias before assuming the free tier is gone.
- A synthesized Czech pub receipt (merchant, three line items, a 10% tip line,
  total, `28.08.2026`), sent as a real base64 JPEG through
  `POST /api/groups/:id/scan` on the live Worker: 200, correct merchant, total
  and tip cleaned to `parseMinor`-ready strings, line items translated
  (a brand name like "Kofola" correctly came back with `labelEn: null`), date
  converted to `2026-08-28`. Passthrough auth (missing/wrong secret, unknown
  group) returns 401/403/404 same as the sync endpoint.
- Still unverified: free-tier RPD for `gemini-3.6-flash` (AI Studio's
  rate-limit view has the number for a given key, Google no longer publishes
  it statically); a real phone photo rather than a synthesized one.

## Gotchas

- A UI-only "which tab is showing" field that isn't written onto the entity
  itself doesn't survive save/reopen if any other saved field can be used to
  re-derive a *different* answer — `receiptItems` staying on the expense
  forever (ADR-0017) meant `splitTab` kept re-deriving "Receipt" even after
  the person switched away and saved. If a UI mode needs to stick, persist it,
  don't derive it from data that outlives the choice (ADR-0019).
- `validateSplit(0, spec)` reads as **fully allocated**, not incomplete
  (`allocated === total === 0`) — which printed "€0.00 of €0.00 allocated"
  under a green check, four separate times, whenever anything upstream left
  the total at zero. The verdict is now `splitFooter`'s (`lib/format.ts`), not
  `check.ok`'s, so the string is unreachable rather than guarded per call site
  ([ADR-0021](decisions/0021-leaving-receipt-mode-hands-the-total-back.md)).
- Don't write a derived value into the draft for another screen's effect to
  notice and resync — that resync is only as reliable as the next mount
  actually happening before anyone reads the value, and a screen that writes
  the input and immediately navigates away (`/g/expense/items`'s "Done") can
  beat it. Receipt's total and split are recomputed inline, at the one place
  either is read, instead — [ADR-0020](decisions/0020-receipt-total-and-split-are-derived-not-cached.md).
- **Deriving a value only while one tab is showing needs a handoff when that
  tab closes.** Receipt derives the total; every other tab reads `amountText`,
  which nothing wrote, so leaving Receipt zeroed the amount. The split already
  handed over via `convertSplitMode`; the amount now does too
  ([ADR-0021](decisions/0021-leaving-receipt-mode-hands-the-total-back.md)).
