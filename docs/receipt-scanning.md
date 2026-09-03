# Receipt scanning

*For: whoever builds or changes the scan. All of it is built and deployed;
[ADR-0016](decisions/0016-receipts.md) holds the UX rulings.*

Photograph a receipt, get the expense form filled in. One model call, one
Worker request, and a form you still have to look at before anything is saved.
The scan and upload buttons live on the form's "Receipt" tab.

## The shape

```
phone: capture or pick from library → downscale → build the request body
  ↓ POST /api/groups/:id/scan   (bearer = group secret)
worker: check the secret, add the API key, stream the body upstream
  ↓
Gemini Flash, free tier, one key shared by everyone
  ↑ response streamed straight back, untouched
phone: parse → normalizeScan() → write an EntryDraft → /g/entry
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
  scan buttons enabled — the retry is the same button, not a second one.
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

`normalizeScan` uses neither `lineItems` nor `tip`. `/g/entry/items` does —
reached right after a scan that found lines, or via "Edit who-had-what" later —
building the grid that reduces to an ordinary `shares` split
([ADR-0016](decisions/0016-receipts.md)). The screen is three bands rather than
a scrolling page: who was there in one sideways-scrolling line above, running
per-person totals stacked below, and the grid between them owning the vertical
scroll so its row of initials freezes while a long bill passes under it.

`quantity` never multiplies anything — `amount` is already the line's printed
total. It says how many rows that line **unfolds** into on the grid, and nothing
else.

`normalizeScan()` in `packages/core/src/scan.ts` turns the rest into an
`EntryDraft` patch: `total` passes straight through as `amountText` — the
prompt already asks the model for `parseMinor()`-ready notation, so there's no
separator-guessing to do locally — plus an uppercased currency and
`occurredAt` from the printed date. Conversion to minor units stays where it
already is — `parseMinor` on save. `category` passes through as a name;
matching it to the group's actual category id is the caller's job, since core
doesn't know a group's categories.

**Never the model's job:** arithmetic, the FX rate (frozen manually, ADR-0005),
who paid, or how it splits. It reads what's printed and leaves the ledger alone.

**Whether the photo is readable is the model's call too.** It sets `error` to a
short sentence — a light joke at its own expense, never the photographer's, that
still names what to re-shoot — instead of guessing at the other fields.
`scanReceipt()` throws `ScanRejectedError` carrying that sentence, and the form
prints it verbatim.

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
`GEMINI_MODEL = "gemini-3.6-flash"` (one constant in `apps/api/src/index.ts`;
the key is the `GEMINI_API_KEY` Worker secret —
[hosting.md](hosting.md#deploying)) · `apps/web/lib/scan/` — `downscale.ts`,
`request.ts` (prompt and structured output schema), `response.ts`,
`scanReceipt()` · the camera and library buttons on `/g/entry/edit`, which share
one handler, and `/g/entry/items` behind them. Verified end to end against the
deployed Worker, 2026-08-28.

## Gotchas

- `gemini-2.5-flash` is **404 for new keys**, and Google's error names the
  replacement. If `3.6-flash` ever goes the same way, try the current
  `-latest` alias before assuming the free tier is gone. A 503 on the same key
  at the same moment is overload, not a verdict on the model.
- **If a UI mode needs to stick, persist it; never re-derive it from data that
  outlives the choice.** `receiptItems` stays on the expense forever, so a
  derived `splitTab` kept saying "Receipt" after the person switched away and
  saved.
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
