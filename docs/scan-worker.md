# The scan's Worker, key and budget

*For: anyone touching the Worker's half of a scan — the shared key, the
envelope, the budget, Turnstile — or the path that skips it, a key of the
phone's own. Part of the [receipt-scanning](receipt-scanning.md) docs; the
secrets are set per [hosting.md](hosting.md#deploying).*

## Why the shared key sits on the Worker

One key everybody shares means no per-user signup, and it cannot be shipped to
a phone, so it lives on the Worker and **Trust** below is what that costs.

It is an **Agent Platform key, and it goes to Vertex** (`VERTEX_URL`), not to
the AI Studio API a brought key uses (`AI_STUDIO_URL`). That is not a
preference: the two have separate billing, and Google's Cloud credit can only
be spent on the Vertex side — the AI Studio API has its own prepay balance and
refuses with *"prepayment credits are depleted"* however much is in the Cloud
account. Vertex also requires `role` on a `contents` entry, which AI Studio
defaults silently; core states it so one envelope satisfies both.

Not because the browser can't call Google: it can.
`generativelanguage.googleapis.com` answers a preflight from any origin and
allows `x-goog-api-key`. That is what makes the section below possible — and it
changes nothing about *our* key, which is shared and therefore never leaves the
server.

## A key of your own

**Advanced → Bring your own key** (`/advanced`, off the groups list's kebab).
Paste a Gemini API key and this phone stops using the shared one: it builds the
envelope itself and calls Google directly, so the scan never touches the
Worker at all.

What that drops is everything guarding a key that is no longer in play — the
bearer token, Turnstile, and all three budget buckets. What it does not touch
is the reading: the same envelope, the same model, the same `checkScan`
afterwards (`web/lib/scan/index.ts` holds both paths and is the only file that
knows which is which). A brought key buys a different payer, not a different
answer.

Three consequences worth stating plainly, because the screen states them:

- **Google bills that key**, and the caps in [What the scan costs](#what-the-scan-costs)
  do not apply to it.
- **The server has no record of the scan.** Not the photo, not the count — this
  is the one thing on `/about`'s privacy section that a person can switch off.
- **The key is on that phone**, in the device record like the group secrets
  beside it (`web/lib/db/dexie.ts`), device-local and never an op.

**Saving checks the key** against Google's free `models` list before storing
it, which answers two questions at once: whether the key works, and whether
this browser can reach Google at all. The second has no other moment to be
found in — a content blocker or a shield defeats the whole feature, however
good the key is, and finding that out with the key in hand beats finding it out
over a receipt. A key Google refuses is not stored.

**There is no fallback through the Worker**, on purpose. Sending the key to us
when the direct call fails would make the promise this screen makes ("your key
never leaves this phone") true only most of the time, and a caveat is what the
feature exists to not have. A blocked browser is told so and keeps the shared
path.

## The envelope, and who owns it

On the shared path the client sends **the bill and nothing else** — base64 as
the whole body, `text/plain`: the downscaled JPEG, or the typed bill's own UTF-8.
The prompt and the response schema live
in `packages/core/src/scan-body.ts`, because both ends build the same body (a brought key builds it on the phone);
the Worker streams the bill into its copy (`apps/api/src/scan-body.ts`), so on
that path a caller decides which bill Gemini reads and which of four envelopes
we hold it arrives in — never a word of the request.

**Four, because two things about the prompt move**: the tone of a refusal (Staś
below) and the medium the bill arrived in. Each moves by picking one of two
constants core holds. What a bill is read *by* — the title rules, the total, the
tip, the tax, the discounts, the line items — is one shared block whichever pair
is asked for, and `scan-body.test.ts` holds all four to it byte for byte. A
typed bill read by different rules would price a split differently depending on
whether anybody had a camera to hand.

What the medium is allowed to move is only what would be actively wrong about
the other one: how the bill is attached, the paragraph about reading an amount
per line (a photograph can shear its own columns; text has no columns left to
shear), and the refusals — "too blurry, re-shoot it" is useless advice about
something somebody typed, in either tone.

That is deliberate, and it is what the endpoint is *for*. A scan credential
costs one unauthenticated request to mint — `ensureGroup` registers any id on
first sight, which is what a quick split relies on (below) — so the bearer check
is a speed bump, not a gate. What keeps our key off the open internet is that
there is no *request* a caller can compose: not a prompt, not a schema, not a
second part, not a destination. **What a typed bill changes (owner's ruling):**
a caller's own words reach the model on our key, so the worst a minted
credential buys is more than having a picture read. It is
still confined on every side that matters — the schema is ours, so the only thing
that can come back is a bill-shaped object (a title under 40 characters, amounts,
one error sentence); the destination and the model are ours; Turnstile and all
three buckets apply. A caller cannot write the request, but can put sentences
inside it.

### Staś mode

One of the two things a caller gets to say about the prompt (the other being the
medium above), and it says it by picking
one of two paragraphs core holds. `X-Stas: 1` on the scan request swaps
the refusal wording for the vicious version — send a photo that isn't a
receipt, or one too blurry to read, and it comes back at *you*, not at the
photo. Each medium's pair is `PHOTO_REFUSAL` or `TEXT_REFUSAL` (`packages/core/src/scan-body.ts`), both
still have to say plainly what's wrong so the person knows what to re-shoot, and everything
else in the prompt is word for word the same, so a mean scan can't also be a
wrong one (`scan-body.test.ts` checks exactly that). Each tone's envelope is
pre-encoded per isolate, so each of the four envelopes is two short byte arrays
and no branch on the hot path. Both
tones carry a typed bill's own refusal as well, since a roast about a thumb says
nothing about a wall of text.

It is off, and turned on by hand on `/diag` — the hidden diagnostics screen, a
long-press on the wordmark — which is `localStorage` on that phone
(`lib/scan/stas.ts`) and therefore per phone, not per group: nobody is
signed up to be insulted by somebody else's taste. A phone on its own key picks
the same two paragraphs with an argument instead of a header, there being no
Worker in between. The one thing the mean
paragraph is told to leave alone is what somebody was born as; everything else
about them is fair game. The report prints `stas:`
so a scan that came back savage is explicable from the thing people paste.

## Minimal Cloudflare quota: the Worker still never touches the bytes

The free plan gives **10 ms CPU per request** and 100k requests/day. Requests
aren't the problem — a scan is one. CPU is, and only if we *deserialize* the
image: waiting on the upstream call is wall time, which doesn't count.

So the envelope is pre-encoded once per isolate and the bill is streamed
between its halves. The Worker never parses a body and never holds the bill:

```ts
// apps/api/src/scan-body.ts — the prompt and schema, cut in two at the bill
const [prefix, suffix] = JSON.stringify(buildScanRequestBody(SENTINEL)).split(SENTINEL);
// apps/api/src/index.ts — PREFIX, then the caller's bytes, then SUFFIX
body: wrapPayload(c.req.raw.body, (err) => { refusal.err = err; }, tone, medium),
```

The rules that follow from it:

- **The Worker composes the request body; the client parses the response.** The
  streamed envelope keeps the CPU cost to one table lookup per byte.
- **That lookup is the security boundary, not a content-type nicety.** The
  caller's bytes land inside a JSON string, so a body carrying a `"` or a `\`
  closes that string and writes its own `contents` — the arbitrary request this
  endpoint exists not to forward. Base64 has neither character, so `wrapPayload`
  rejects every byte outside its alphabet and the hole closes outright.
  `scan-body.test.ts` is mostly attempts to get a second field past it. **A typed
  bill travels base64 for this one reason** and no other: it keeps the caller's
  *bytes* out of the request even while the caller's words reach the model.
- **The client never names the destination.** URL, model and key are Worker-side
  constants. A client-supplied URL would make this an open proxy to anywhere
  with our key attached.
- **Downscale to ≤1024px long edge, JPEG ~0.7, target ≤200 KB**, encoded to
  base64 in the browser. Vision models don't read a receipt better above that.
  The Worker caps the body at `MAX_IMAGE_BYTES` (400 kB — that with room to
  spare), refusing on `content-length` before a byte is streamed anywhere, and
  counting again as it streams for the caller whose header lied. A typed bill has
  a cap of its own, two orders of magnitude below it (`MAX_TEXT_BYTES`): a body
  sent as text does not get to spend the image allowance.
- **One request per reading**, typed or photographed. No automatic retry — a retry doubles both our
  requests and the shared daily Gemini quota. A failure says so and leaves the
  control enabled — the retry is the same button, not a second one.
- **Auth authenticates a *secret*, not a membership** — the existing
  `bearerToken` + `sha256Hex` check against the group row, which is what lets a
  quick split scan with a credential of its own (below). It is a speed bump:
  what actually bounds the spend is the budget below.
- **Whoever is paying for the scan is the id in the path.** A group, or — for
  a quick split — the phone, which carries an id and a secret shaped like a
  group's and introduces the pair with an empty `POST …/ops` before each scan
  (`lib/quick.ts`, ADR-0035). One per phone rather than one per bill, because
  a stable caller is the unit the budget counts, and that path parameter is
  what it keys on.

`sw.js` needs nothing: it ignores non-GET and cross-origin, and never caches
`/api/*`.

## What the scan costs

This is the one endpoint in the app that spends money, so it is the one with a
budget. Three buckets, and they answer different questions — `SCAN_LIMITS` in
`packages/core/src/scan.ts` holds the numbers, because both ends need them. A
bill typed in spends them exactly as a photographed one does, being the same
question to the same model:

| bucket | limit | what it is |
|---|---|---|
| **caller** | 10/hour, 30/day | the `:id` a scan is billed to — a group, shared by everyone in it, or one phone's own credential, which is what a quick split and the demo group both scan under |
| **client** | 20/hour, 50/day | the address, HMAC'd. Loose enough for a table of friends behind one restaurant wifi |
| **global** | 700/hour, 4300/day | the bill — sized to spend the Cloud credit over two months, against real use of tens of scans a day |

**Measured, not estimated** (one real call through this envelope):
a scan is ~2,740 input tokens — ~1,530 of prompt and schema, the rest the image
— and a few hundred out. At `gemini-3.1-flash-lite`'s $0.25/$1.50 per million
that is **about $11 per 10,000 scans**, and the day cap above is what spends the
Cloud credit over roughly two months rather than anything derived from a price.

**Don't move `GEMINI_MODEL` down to save money.** The Flash-Lite line gets
dearer each generation (2.5 at $0.10/$0.40, 3.1 at $0.25/$1.50), but 2.5 is too
weak on real receipts, and on the feature whose whole job is reading numbers
off paper a wrong total costs more than the model does.

The tip jar's **$5 ≈ 4,000 scans** (`TIP_USD_MINOR`, `web/lib/tip.ts`) is the
measured figure rounded down — $5 buys more like 4,400. It understates on
purpose: a donation ask is the one screen that must not overstate what the
money buys. It moves with the model; the day cap does not derive from it.

**Only the global cap bounds what the owner pays.** A credential costs one
unauthenticated request to mint, by design, so the caller bucket is politeness:
it stops a phone double-tapping through the shared budget, and a caller who
doesn't want it simply brings another id. The client bucket is a gate, because
an address is expensive to rotate. The global one cannot be escaped by minting
anything, and its **hourly sub-cap is the part worth keeping**: without it a
burst eats the day at 06:00 and the app is dark until midnight.

**Turnstile is what makes the cheap credential survivable.** Every scan carries
a token (`X-Turnstile-Token`), verified server-side before the image is
streamed anywhere: a fresh id buys nothing without a fresh token, and a token
costs a real browser. It **fails closed** — no valid token is a refusal that
says so, because failing open makes the check optional for precisely the people
who would want it to be.

One token is spent per scan, but it is not minted at the press: a token is
single-use and good for a few minutes, so the challenge runs while a scan
control is merely on screen (`warmTurnstile`, called by `ScanPair` on mount and
again each time the button comes back from a scan) and is usually waiting by
the time anybody photographs anything. `turnstileToken` **takes** it, so the
slot is empty behind it and no two scans can send the same one; one older than
`WARM_TTL_MS` is dropped and minted again at the press. A warm gives up the
moment Cloudflare wants a tap — a checkbox floating over the Items tab, asked
for by nobody, is worse than the second it saves — and a warm that fails is
silent, because the press mints again and *that* is where a blocked browser is
named. The refusal is **two sentences, not one**
(`copy.scan.unverified`): a script this phone could not load is the person's
network and worth a retry, while a token the Worker rejected is this
deployment's secret disagreeing with its site key, where retrying is the only
thing that cannot help. Said identically, the second sends the wrong person
looking.

The widget is **Managed**, and Managed does sometimes challenge a real person:
a "verify you are human" box, which they tap, after which the scan runs. The
owner keeps that friction: the global cap bounds the bill either way, and what
Turnstile buys is that one script cannot spend everybody's day. It is why the host sits
**on screen** (`.turnstile`, above the bottom bar) rather than parked
off it: a challenge nobody can reach is a scan that waits out its own timeout.

**The phone refuses before it uploads.** `turnstileToken()` throwing ends the
scan in `scanReceipt` rather than sending a tokenless request for the Worker to
refuse — the Worker would refuse it, but only after the phone had downscaled
and pushed 200 KB over whatever signal it has. The server is still the
authority: a deployment with no `TURNSTILE_SECRET_KEY` also has no site key in
its build, so nothing is asked for and nothing is refused.

**The phone keeps its own copy of the caller bucket** (`lib/scan/budget.ts`,
one log per caller in the device record), so a scan already over budget is
refused before the photo is downscaled and the request is never spent. It is
advice: the Worker counts again and decides, and wiping it reaches only the
bucket that was politeness anyway.

**Counted, booked, then spent** — in that order. A call that hangs, or a photo
the model refuses, has still been paid for, so `recordScan` runs before the
upstream request rather than after. Rows live 24h (`scan_hits`,
[data-model.md](data-model.md#d1-schema)); the prune rides in the same batch as
the insert because that is the same round trip and the only moment that
reliably happens once per scan.

**The address is never stored.** `HMAC(ip, SCAN_IP_SALT)`, truncated to 16 hex
— a bare `sha256` of an IP is an IP with extra steps, since four billion of
them is minutes of rainbow table. The salt is a Worker secret
([hosting.md](hosting.md#deploying)), so a leaked row is noise to anyone
without it, and rotating it only resets buckets that live a day.

**Nothing says any of this on screen until it refuses.** A counter nobody is
near is fat ([standing-instructions](standing-instructions.md#interface)), and
the two sentences say the whole of it when it matters: `copy.scan.limit.you`
for a bucket you spent, `copy.scan.limit.global` for one somebody else did.
They are deliberately not `copy.scan.busy` — waiting a minute fixes an
overloaded Gemini and does nothing at all about a spent budget.

**Both secrets are optional, and a deployment without them is unlimited.** No `TURNSTILE_SECRET_KEY` and the Worker checks no token; no
`SCAN_IP_SALT` and the client bucket is absent rather than shared. That is what
lets someone self-host without a Turnstile account (SELFHOSTING.md).

The pair that has to agree is the site key and `TURNSTILE_SECRET_KEY`: a build
sending no token to a Worker demanding one refuses every scan. **The widget's
domain list has to name the hostname people actually open** — production is
`bida.bid`, not the `workers.dev` name the Worker is called after
([hosting.md](hosting.md#deploying)) — or the widget refuses the origin on the
phone and no request is ever made. So the site key
is **committed, in `.github/workflows/deploy.yml`** — it is public by nature,
it only works on the domains its widget names, and a repo variable somebody
forgets to set is exactly the disagreement that breaks scanning silently.
Turning Turnstile on is then: deploy a build carrying the site key, *then* set
the Worker secret. Never the other way round.

## Trust, and what we're accepting

Deliberate, for a group of friends under fifty people:

- **One key, shared globally.** Anyone with the app URL and a group secret
  spends it, and a secret costs one request to mint. What that buys is confined
  twice over: the Worker owns the envelope, so nobody can put their own *request*
  on our key, and the budget above caps what having bills read can cost.
- **A typed bill puts a caller's own words in front of that key** — a call the
  owner made knowingly ([The envelope, and who owns it](#the-envelope-and-who-owns-it)).
  The prompt, the schema, the model and the destination stay ours, so what comes
  back is a bill-shaped object and not a general-purpose answer; the budget and
  Turnstile are untouched. Read the paragraph under **The envelope** before
  widening what a caller may send.
- **The bill still leaves the phone readable.** Op bodies are sealed
  ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)), so a receipt
  on its way to Google is **the one thing in the app that doesn't** — a place,
  a date, a card's last four — and that is as true of one typed out as of one
  photographed. `/about` names it as the exception rather than
  burying it in a clause. It is not training data: Vertex does not train on
  what it reads.
- **A brought key is the exception to that exception.** `/advanced` takes an AI
  Studio key, and the free tier of that API *is* used to improve Google's
  products. So the path that keeps the photo away from our server is the one
  where Google may train on it, and `/advanced` says so in as many words —
  `/about` only points there, rather than repeating it. The inversion is worth
  re-reading before editing either sentence.
- **Terms can change overnight.** If they do, scanning 404s and the button
  hides. The app is unaffected.

Training survives only on a brought free-tier key, where the person chose the
payer. The photo is not stored at all
([product.md](product.md#deliberately-not-in-the-mvp)).

## Gotchas

- **Turnstile cannot be verified by a browser you automate.** Playwright is
  detected — headless renders no widget at all, headful renders the checkbox
  and then fails `600010` when nothing clicks it — so neither outcome says
  anything about whether real people get through, and neither means the
  deployment is broken. **If you change the widget, a human has to test it.**
- **A driven scan spends the budget too.** `pnpm drive`'s `receipt <name>`
  stubs the round trip to Gemini, not `lib/scan/budget.ts`, so an eleventh scan
  on one phone is refused by the app itself with `copy.scan.limit.you`. That is
  correct and worth recognising before it reads as a broken driver; `forget`
  is a factory-fresh phone and a fresh budget.
- **Our 429 and Gemini's mean opposite things.** "Come back in a minute" fixes
  an overloaded model and does nothing about a spent budget, so the Worker adds
  a `scope` field and the phone reads it — a 429 with no `scope` is Google's.
- **`fetch` resolves when the response *headers* arrive, not when the request
  body finishes.** A streamed request body that errors after that point
  resolves the promise rather than rejecting it, so the `catch` around the
  upstream call never runs and a refused image answers **200**. Whatever a
  streaming body needs to report has to be read from a flag on both paths, not
  caught — which is what `refusal` in the scan handler is.
- **A refusal still opens the upstream connection.** The alphabet check happens
  mid-stream, so by the time a bad body is found Gemini already has our prefix;
  refusing truncates the request, and what upstream receives is an unterminated
  JSON string and never the caller's bytes. Unavoidable while the image streams
  rather than being read, and harmless — a truncated request is not a request.
- `gemini-2.5-flash` is **404 for new keys**, and Google's error names the
  replacement. If `3.1-flash-lite` ever goes the same way, try the current
  `-latest` alias before assuming the free tier is gone. A 503 on the same key
  at the same moment is overload, not a verdict on the model.
