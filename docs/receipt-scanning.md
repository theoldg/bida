# Receipt scanning

*For: whoever builds or changes the scan. Core, Worker endpoint and the
client-side scan lib exist; the button, its states and the final field schema
are deliberately not — the owner wants to design those.*

Photograph a receipt, get the expense form filled in. One model call, one
Worker request, and a form you still have to look at before anything is saved.

## The shape

```
phone: capture → downscale → build the request body
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
| total | **the string as printed**: `"42,50"`, `"1.234,50"` |
| currency | ISO 4217 if legible, else null |
| date | `YYYY-MM-DD` if legible, else null — trusted as printed, no date parser here |
| category | one of the group's, or null |

Line items (restaurant splitting) are deferred scope — see product.md — so
`ScanResult` doesn't carry them; add the field when that work starts.

`normalizeScan()` in `packages/core/src/scan.ts` turns that into an
`ExpenseDraft` patch: a cleaned `amountText` the existing `AmountInput` accepts
(thousands separators stripped, last `,`/`.` kept as the decimal point only
when 1–2 digits follow it), an uppercased currency, and `occurredAt` from the
printed date. Conversion to minor units stays where it already is —
`parseMinor` on save. `category` passes through as a name; matching it to the
group's actual category id is the caller's job, since core doesn't know a
group's categories.

**Never the model's job:** arithmetic, the FX rate (frozen manually, ADR-0005),
who paid, or how it splits. It fills three fields and leaves the ledger alone.

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

## Build order

1. ✅ `packages/core/src/scan.ts` + tests — the normaliser, no network.
2. ✅ `apps/api` — `POST /api/groups/:id/scan`, same bearer-secret check as
   sync, passthrough to `GEMINI_MODEL = "gemini-2.5-flash"` (best-documented
   free tier as of writing — re-check in AI Studio once a key exists, model id
   is one constant in `apps/api/src/index.ts`). Needs the `GEMINI_API_KEY`
   Worker secret — [hosting.md](hosting.md#deploying).
3. ✅ `apps/web/lib/scan/` — `downscale.ts`, `request.ts` (prompt + structured
   output schema), `response.ts`, and `scanReceipt()` tying them together.
4. ⬜ The button on `/g/expense`, its states, and the privacy line — owner's
   design. `pnpm shots` after.
5. ⬜ ADR-0016, product.md's deferred row, roadmap Phase 4 checkbox.

## Still to verify — needs a real key

- Free-tier RPD for `gemini-2.5-flash` (check the rate-limit view in AI Studio
  for the actual key, Google no longer publishes static numbers).
- That a `ReadableStream` request body survives a Workers subrequest end-to-end
  — the passthrough sets `duplex: "half"` on the upstream `fetch()` on the
  assumption that's required and sufficient, unverified against a real request.
- A real photo through `downscaleToBase64Jpeg` → the endpoint → Gemini →
  `parseScanResponse`, once `GEMINI_API_KEY` is set.

## Gotchas

*Empty until something bites. Add to it rather than learning it twice.*
