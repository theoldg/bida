# Receipt scanning

*For: whoever builds or changes the scan. All of it is built and deployed;
[ADR-0016](decisions/0016-receipts.md) holds the UX rulings.*

Photograph a receipt — or [type it in](#typing-a-bill-in) — and get the expense
form filled in. One model call, one
Worker request, and a form you still have to look at before anything is saved.
Three screens start one: `/g/scan`, the camera above the ledger's "+", which is
the act with nothing else on screen; the form's own "Items" tab, for a
bill you reach for once the expense exists; and `/quick`, where there is no
group at all ([ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
All three call `useReceiptScan` and wear
`ScanPair` (`components/receipt-scan.tsx`), so neither the behaviour nor the
control can drift — one act, three doors, one button cut in three
([design-system.md](design-system.md#palette-roles)): photograph it now, pick
the photograph you already took, or [type it in](#typing-a-bill-in).

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
phone: capture or pick from library → downscale → base64 (+ a Turnstile token)
       — or the typed bill, straight to base64
  ↓ POST /api/groups/:id/scan   (body = the bill; bearer = group secret;
                                 X-Input: text for a typed one)
worker: verify the browser, count the budget, book the scan,
        then wrap the bill in our prompt + schema and add the API key
  ↓
Gemini Flash-Lite on Vertex AI, one key shared by everyone
  ↑ response streamed straight back, untouched
phone: parse → normalizeScan() → write an EntryDraft, and stop
```

With a key of your own ([below](#a-key-of-your-own)) the middle two lines are
gone: the phone builds the envelope and POSTs it to Gemini itself, with no
Turnstile token, no bearer and no budget. Everything above and below them is
identical.

The scan ends at [`lib/draft.ts`](../apps/web/lib/draft.ts). That's the whole
integration: a draft is *"not a fact about the world yet"*, which is exactly
what a machine's reading of a crumpled receipt is. You review the form, and
saving appends the op the way it always did — one `actor`, one human, no new op
kinds, no schema change, nothing on the log that nobody looked at.

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
allows `x-goog-api-key`, which this doc denied until somebody checked
(2026-09-18). That is what makes the section below possible — and it changes
nothing about *our* key, which is shared and therefore never leaves the server.

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

## Typing a bill in

**The scan control's third door**, on every screen that reads a bill but
`/g/scan`. A box, the
bill pasted or typed into it however it is written, and the same filled draft
comes back. It is for the bill nobody photographed — a receipt that arrived as a chat message
or an email, one already thrown away, one a camera has just failed on twice.

**Not on `/g/scan`** (2026-09-20, owner's call): the ledger FAB that opens that
screen is a camera and the screen draws a photograph, so it offers two doors
(`typeIn={false}`). Words go in where the form is already open — the Items tab —
or on `/quick`, which has no form behind it.

It is **in** the box and not beside it (2026-09-19, owner's call). A reading is a
reading whichever medium it starts from, and a door standing outside would have
said typing was a different act — which is exactly what it is not. What that
costs is room: three doors share the width of a phone, so the glyphs went down a
couple of points and the door says **"Type"** at the two full-width registers,
where a third of 360 pixels holds ten characters or a pencil and not both. At the
chip register — a bill already read, the control standing among its figures —
the box is sized by its contents and it says "Type it in" in full, the way the
camera's door already says "Scan" in one place and "Rescan" in another
(`copy.scan.typeIn`).

The box itself is rendered by `useReceiptScan`, never by a screen, and rides
`scan.inputs` beside the two hidden file inputs. The hook sits at the screen's
root, where nothing a reading does can move it; owned by the control, it was
unmounted by its own answer — the Items tab draws one shape when there is no bill
and another when there is, so the box reopened holding what had just been read,
over a bill that had just arrived.

Everything after the bytes is shared with a photograph: the same endpoint, the
same bearer, the same Turnstile token, the same three budget buckets, the same
`checkScan`, the same rules about what a reading may overwrite. A typed bill
costs what a photo costs and is counted the same (`parseBillText`,
`web/lib/scan/index.ts`).

**What it is not is the same question.** A till roll and a WhatsApp message are
different documents, and for a while the typed one was read by the photograph's
rules — shared prompt, one amount per line, every figure already multiplied out,
a total required. That combination cannot read the ordinary case. "3 chicken at
13, 10 beef at 15" gives a per-unit price and a count, and a reader forbidden to
multiply has no legal answer for the line; the bill states no total, and one was
demanded. Four things follow from fixing it:

- **Its own prompt** (`scan-body.ts`), about a third shorter than the
  photograph's, with no columns, no printer and no merchant in it. The two are
  held together by the schema and by the conventions neither may disagree about
  — plain decimal, deductions positive, tax only on top, no title in capitals —
  rather than by shared paragraphs (`apps/api/src/scan-body.test.ts`).
- **A line states its price either way.** `amount` is what the whole line came
  to; `unitAmount` is the price of one, beside a `quantity`. The model fills
  whichever the bill gives and never both, and `lineMinor` does the
  multiplication in integer minor units, where it is tested — asking a model for
  a figure the page does not hold is what makes it invent one. Only the
  multiplied one is written out: `readBill` keeps the model's own string for a
  line the bill priced outright, so `checkScan` can refuse an unreadable one
  and show what arrived. The grid prints it through `priced` (`lib/format.ts`)
  rather than as it came, since "cola 10" beside a multiplied "39.00" is one
  column in two formats — and the string still survives wherever it isn't a
  figure.
- **A missing total is ordinary**, not a refusal. See
  [What a reading is checked against](#what-a-reading-is-checked-against).
- **A line with more numbers than the words explain is a refusal, not a
  guess.** "chicken 2 5 7" gives no word to say which figure is a count and
  which is a price, so the prompt asks the model to name the ambiguous line in
  `error` rather than pick an arrangement — the same refusal path as a bill
  with no prices at all, not a per-line null that `checkScan` would have to
  catch downstream.
- **A label is a clean guess, not a transcript.** "3 chicken skewers at 13"
  then "10 beef at 15" reads as two skewers, not chicken skewers and an
  unqualified beef — the prompt carries a word the second line dropped but the
  first made plain ("Chicken skewer", "Beef skewer"), and turns a generic word
  that plainly names one well-known brand into the brand ("large cola" →
  "Coca-Cola"). It's the one field this prompt improves rather than
  transcribes, and the guess stays scoped to what the line itself makes
  plain — never a dish, brand or detail nothing in the text suggests.

**And almost never a title.** A photographed receipt leads with a merchant's
name; a typed one leads with the food. Asked to name the expense anyway, a model
hands back a description of the list — "Skewers", "Barbecue" — which is not a
name, is worse than the empty field the person is about to type in, and arrives
on the draft as though it had been read off the bill. So the typed prompt asks
for a title only where the text plainly names where the money went, and null is
the expected answer.

**It rides the envelope as base64, in an `inlineData` part with
`mimeType: "text/plain"`** — which the Worker chooses, never the caller. That is
not a detail: it is what lets the guard below stay the guard it already was.
Escaping arbitrary text into a JSON string as it streamed would mean a second,
subtler check on the hot path; base64 reuses the one that is already proved, so
what a typed bill changes is what the model *reads* and never what the request
*is*.

**The lede asks for none of this.** "The items and prices, formatted however you
like" — it names what the Items tab needs and no shape at all, because every
clause about one line each or a total was a clause teaching people to tidy a
bill up for the app (`copy.scan.typeIn`).

**The cap is 4,000 characters** (`BILL_TEXT_MAX`, core/scan.ts), which is about
what the downscaled photo costs in tokens — so typing is never the dearer way to
read a bill — and well clear of any real one: a sixty-line till roll is about
1,800. The dialog counts down only in the last fifth of it, because a counter
nobody is near is fat. The Worker's `MAX_TEXT_BYTES` sits far above that as an
abuse ceiling on bytes, in the same spirit as the push caps; the character count
is the number a person is held to.

**The text is kept, on the draft and on the saved expense** (`receiptText`), for
the reason `receiptItems` is: reopening the box holds what was typed, on this
phone or another, so correcting a misread bill is editing rather than retyping.
A photograph clears it, the way it clears the grid — what is kept has to describe
the bill actually on the draft. Nothing else shows it: the bill's own lines and
each person's copy of them are the reading, and printing the raw text under them
would be the same thing twice.

**The dialog takes its state from the reading, not from itself.**
`scan.live` is the one `LiveScan` the screen behind is also watching, which
is what makes the bar a clock on the reading: close the box mid-read and the
draft still fills; open it again and the bar is where the reading actually is. A
refusal leaves the box standing with the text intact, because unlike a bad
photograph a bad bill is fixed where it was typed — and **closing on it takes it
with you**: the message was read where the fix was, so it doesn't follow you out
and sit under the control on the screen behind, which never rang. Only a typed
reading's; a photograph's refusal belongs to the screen that took it, and the box
merely stood over it.

## The envelope, and who owns it

On the shared path the client sends **the bill and nothing else** — base64 as
the whole body, `text/plain`: the downscaled JPEG, or the typed bill's own UTF-8.
The prompt and the response schema live
in `packages/core/src/scan-body.ts`, because both ends build the same body now;
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
second part, not a destination. **What a typed bill changes, and the owner ruled
on it (2026-09-19):** a caller's own words now reach the model on our key, so the
worst a minted credential buys is no longer only having a picture read. It is
still confined on every side that matters — the schema is ours, so the only thing
that can come back is a bill-shaped object (a title under 40 characters, amounts,
one error sentence); the destination and the model are ours; Turnstile and all
three buckets are unchanged. What weakened is the word *impossible*: a caller
cannot write the request, and can put sentences inside it.

### Staś mode

One of the two things a caller gets to say about the prompt (the other being the
medium above), and it says it by picking
one of two paragraphs core holds. `X-Stas: 1` on the scan request swaps
the refusal wording for the vicious version — send a photo that isn't a
receipt, or one too blurry to read, and it comes back at *you*, not at the
photo. Both paragraphs are in `REFUSAL` (`packages/core/src/scan-body.ts`), both
still have to say plainly what's wrong so the person knows what to re-shoot, and everything
else in the prompt is word for word the same, so a mean scan can't also be a
wrong one (`scan-body.test.ts` checks exactly that). Each tone's envelope is
pre-encoded per isolate like the other, so the second costs two short byte
arrays and no branch on the hot path — four pairs now, the medium having doubled
them, which is still two arrays per envelope and no code path of its own. Both
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
  prompt and the response schema live in `apps/api/src/scan-body.ts`. They used
  to live on the phone, for the CPU reason above — which the streamed envelope
  keeps, at the cost of one table lookup per byte.
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

Nothing changes in `sw.js` — it already ignores non-GET and cross-origin, and
`/api/*` was never cached.

## What the model decides, and what it must not

It reads. It doesn't compute — the one multiplication in the whole reading is
`lineMinor`'s, here, on figures the bill stated. The table below is the
photograph's reading; a typed bill answers the same schema by its own prompt,
and differs in the three places [Typing a bill in](#typing-a-bill-in) names.

| It returns | Type |
|---|---|
| title | string → `description` — the merchant's name, minus the parts that aren't the name ("Bar Zahra - Sarl M. Benali" → "Bar Zahra"), plus two or three words of what was bought where the name alone wouldn't say ("Lidl - barbecue"). Nothing added when the merchant already says it, when the lines are too mixed, or when none are printed: a bare name beats a wrong guess. Cased as a name is written, never in the capitals a till prints ("BAR ZAHRA" → "Bar Zahra"), keeping the casing a brand owns ("IKEA", "H&M") |
| total | plain decimal notation, `parseMinor()`-ready: `"42.50"`, `"1234.50"` — the model normalizes whatever separators the receipt prints, never local code. Only ever a figure the bill itself states: null where it states none, and never added up ([what a reading is checked against](#what-a-reading-is-checked-against)) |
| tip | a separate tip/service-charge line, same normalized notation, or null |
| tax | tax charged *on top of* the lines, same notation, or null — VAT already inside the printed prices, which most European receipts break out near the foot, is not this and would be counted twice |
| discounts | every deduction the receipt prints, one entry each — `{ label, labelEn, amount }`, the amount written **without** a minus sign — a loyalty deduction, a voucher, a two-for-one credit, whether it printed against one item or against the whole bill; empty when it takes nothing off |
| currency | ISO 4217 if legible, else null |
| date | `YYYY-MM-DD` if legible, else null — trusted as printed, no date parser here |
| lineItems | `{ label, labelEn, amount, unitAmount, quantity }[]` — printed label (a label the printer wrapped over several rows is one item), English translation (null if already English), a count only when the bill actually states one (e.g. "2x", a qty column) — never inferred from repeated lines or defaulted to 1 — and **exactly one of the two figures**, in the same normalized notation as `total`. `amount` is what the whole line came to, which is what a till prints and so always the photograph's answer; `unitAmount` is the price of one, which is how somebody typing writes it ("3 chicken at 13 each"), and `lineMinor` multiplies it by the count |
| error | a short, lightly humorous sentence if the photo isn't a receipt or is unreadable (e.g. "Too blurry — I've read tea leaves with better odds."), else null — every other field is null/empty when set. In Staś mode the same sentence, delivered as an insult aimed at the photographer (above) |

`normalizeScan` uses none of `lineItems`, `tip`, `tax` or `discounts`. `/g/entry/items` does —
reached by tapping the Items tab's button — "Assign who had what" on a bill
nobody has been given a line of, "Edit who-had-what" once somebody has —
building the grid that becomes a `receipt` split — its own mode, which is why
no screen has to ask a second field whether a split came off a bill
([ADR-0016](decisions/0016-receipts.md)). The screen is **one scroller**: who
was there, the grid and the running per-person totals pass through it together,
and what is held back is what you are working against — the row of initials
across the top and the column of names down the left, so neither a column nor a
row can go anonymous on a bill that outruns the screen in both directions. The
chips are set once before anything is assigned and the totals are read at the
end, so freezing either costs the grid height it needs more: at eight people on
a 360×640 phone they held 351 of 640 pixels and left the grid 230 — three and a
half lines of a twelve-line bill. Only Done stays put, being the way out.
Column widths are declared in a `<colgroup>` under `table-layout: fixed`, never
measured from the cells: content-derived widths moved every dot on the screen
each time a run was opened.
Everyone starts at the table and **nothing starts assigned**: ticking what you
had is the work, so the grid asks for it rather than handing you a bill already
split evenly to untick your way out of. **A tap on the line itself — the name
and amount — is everybody, or nobody**: the two answers a whole row of a bill
usually wants (a shared bottle; a dish that turns out to be one person's), in
one tap rather than one per column. It overwrites whatever was there, because a
control meaning "all of them" cannot also mean "all of them, except what you
already said", and a second tap puts it back to nobody. It takes a folded run
whole, portions and all — including one somebody is split across, which a
*cell* refuses, since the ambiguity there is which portion the tap meant and a
line has none. Done is never held grey: pressed on a bill
with a line nobody has been given, it refuses — every unassigned line's name and
amount bloom, the grid scrolling to the nearest of them first unless one is
already wholly in view, the button is spent for that travel and the flash, and only then
does the sentence under the grid appear, until the last line has somebody
([design-system.md](design-system.md)). It waits for that press because on
arrival nothing is assigned yet, and a red line printed then scolds a grid for
being untouched.

**×N stops editing the bill after the first press.** That press really does
split a printed "Salad ×2" into portions — there have to be rows before there
is anything to assign — but from then on the same button only opens and closes
a *view* of them (`foldedLine`), and the portions stay in the draft. So folding
can no longer throw away which portion was whose, and it cannot move a cent
either: three portions of 5.67/5.67/5.66 shared two ways do not round like one
17.00 line. A folded run whose portions went to different people wears the
split mark on everyone who had any of it, and a tap on one of those cells opens
the line rather than guessing which portion it meant — the run is scrolled into
view whole and the tapped column is pointed at
([design-system.md](design-system.md)). A run nobody is split across is the
single line it is drawn as, and edits like one: the tap lands on every portion.
A restored draft opens with every run folded, which is the compact reading of
it.

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
the bill — "Beer ×2", "Fries ×1 1/2", "Tagine ×1/3", then the tip and the tax,
muted, below what was ordered. Nothing is ruled or washed anywhere in it: not
between the people, not between a person's items and their extras, because a
name, a figure and a shift to muted ink already say where one thing ends. Each
line carries a printed bill's dotted leader out to its figure. It is the same
reading a quick split ends on (ADR-0035), which differs only in starting with
every row open. Weights and lines come out of one pass, so a row and the lines
under it cannot disagree.

`normalizeScan()` in `packages/core/src/scan.ts` turns the rest into an
`EntryDraft` patch: `total` passes straight through as `amountText` — the
prompt already asks the model for `parseMinor()`-ready notation, so there's no
separator-guessing to do locally. Conversion to minor units stays where it
already is — `parseMinor` on save. The scan asks for no category: an expense
carries a `categoryId`, but nothing in the app makes a category or maps a name
to an id, so the field went out with nowhere to land (Categories is
deferred — [product.md](product.md#deliberately-not-in-the-mvp)). Two prompt lines and a schema property bring it back.

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
photograph and is refused as it always was. A typed bill usually has none — the
person who had already added it up did not need us — and demanding one refused
almost every bill anybody types.

So `checkScan` takes the medium, and reconciles only against a figure the bill
itself stated. Where a typed bill states none, its lines *are* the bill:
`billTotalMinor` sums them with the extras, `normalizeScan` puts that in the
amount field, and the sum is not then checked against itself. That is not a
weaker check but an honest one. The alternative on offer — asking the model for
a total when the page has none — is worse than no check at all: a model told the
lines must equal the total closes the gap by adjusting a line, and a bill that
has been *made* to add up is the one error this function cannot see.

Two conditions of the *phone* are told apart from that, because neither has
anything to do with the photo and the generic message sent people back to
re-shoot a receipt that was fine: a `429`/`503` from Gemini throws
`ScanUnavailableError` ("Gemini is busy"), and — **scanning being the one act in
the app that needs a network** — an offline phone throws `ScanOfflineError`,
checked before the downscale and again on a rejecting `fetch`, which is the
captive portal `navigator.onLine` calls online. The words are `copy.scan.*`
([ADR-0033](decisions/0033-every-word-in-one-file.md)); `scanErrorText` maps
error to sentence. Anything else falls back to the generic message.

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

**Measured, not estimated** (2026-09-18, one real call through this envelope):
a scan is ~2,740 input tokens — ~1,530 of prompt and schema, the rest the image
— and a few hundred out. At `gemini-3.1-flash-lite`'s $0.25/$1.50 per million
that is **about $11 per 10,000 scans**, and the day cap above is what spends the
Cloud credit over roughly two months rather than anything derived from a price.

**Cheaper was tried and cost too much.** The Flash-Lite line gets dearer each
generation — 2.5 at $0.10/$0.40, 3.1 at $0.25/$1.50, 3.5 at $0.30/$2.50 — so
2.5 ran the shared scan for a few hours at roughly a third of the price, and
was sent back: too dumb on real receipts (2026-09-18). On the one feature whose
whole job is reading numbers off paper, a wrong total costs more than the
model does. **The price is not the thing to optimise here**, which is the
reason to read this paragraph before moving `GEMINI_MODEL` down again.

The tip jar's **$5 ≈ 4,000 scans** (`TIP_USD_MINOR`, `web/lib/tip.ts`) is the
measured figure rounded down — $5 buys more like 4,400. It understates on
purpose: a donation ask is the one screen that must not overstate what the
money buys. It moves with the model, and the day cap no longer derives from
it.

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
a "verify you are human" box, which they tap, after which the scan runs. That
friction was weighed against dropping Turnstile — the global cap bounds the
bill either way, so what Turnstile buys is that one script cannot spend
everybody's day — and the owner kept it (2026-09-14). It is why the host sits
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

**Both secrets are optional, and a deployment without them is the old
unlimited one.** No `TURNSTILE_SECRET_KEY` and the Worker checks no token; no
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
- **A typed bill puts a caller's own words in front of that key** — the one thing
  the envelope used to make impossible, and a call the owner made knowingly
  (2026-09-19 — [The envelope, and who owns it](#the-envelope-and-who-owns-it)).
  The prompt, the schema, the model and the destination stay ours, so what comes
  back is a bill-shaped object and not a general-purpose answer; the budget and
  Turnstile are untouched. Read the paragraph under **The envelope** before
  widening what a caller may send.
- **The bill still leaves the phone readable.** Op bodies are sealed
  ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)), so a receipt
  on its way to Google is **the one thing in the app that doesn't** — a place,
  a date, a card's last four — and that is as true of one typed out as of one
  photographed. `/about` names it as the exception rather than
  burying it in a clause. What it is no longer is training data: Vertex does
  not train on what it reads, which is the shared path's one privacy gain from
  moving off AI Studio.
- **A brought key is the exception to that exception.** `/advanced` takes an AI
  Studio key, and the free tier of that API *is* used to improve Google's
  products. So the path that keeps the photo away from our server is the one
  where Google may train on it, and `/advanced` says so in as many words —
  `/about` only points there, rather than repeating it. The inversion is worth
  re-reading before editing either sentence.
- **Terms can change overnight.** If they do, scanning 404s and the button
  hides. The app is unaffected.

**The training problem is fixed** for the shared path, which is what moving to
Vertex bought; it survives only on a brought free-tier key, where the person
chose the payer. The other open question is whether the photo is stored at all,
and the answer is still no
([product.md](product.md#deliberately-not-in-the-mvp)).

## What it's made of

`packages/core/src/scan.ts` — the normaliser, `SCAN_LIMITS` and
`BILL_TEXT_MAX`, no network ·
`apps/api`'s `scan-limits.ts` — the budget, the client key and Turnstile ·
`apps/web/lib/scan/budget.ts` and `turnstile.ts`, their two halves on the phone
· `apps/api`'s `POST
/api/groups/:id/scan` — `X-Input: text` for a typed bill — the same bearer-token
check as sync, passing through to
`GEMINI_MODEL = "gemini-3.1-flash-lite"` (one constant in `packages/core/src/scan-body.ts`;
the key is the `GEMINI_API_KEY` Worker secret —
[hosting.md](hosting.md#deploying)) and the envelope is
`apps/api/src/scan-body.ts` (four pre-encoded envelopes — two tones by two
media — and the base64 guard `scan-body.test.ts` attacks) · `apps/web/lib/scan/` — `downscale.ts`,
`text.ts`, `response.ts`, `scanReceipt()` and `parseBillText()` ·
`components/bill-text-dialog.tsx`, the box a bill is typed into ·
`components/receipt-scan.tsx`, the hook all three scanning screens
share — `/g/scan`, the Items tab on `/g/entry/edit`, and `/quick` — with
the who-had-what grid (`components/who-had-what.tsx`) a tap behind the tab and
the screen after the scan respectively. The control they wear draws the round
trip as a bar filling over the ~3s a scan usually takes, falling back to the
spinner only when the model is slower
([design-system.md](design-system.md#palette-roles)). Where the scan is *up
to* is `lib/scan/live.ts`, a store keyed by group beside the draft rather than
state in the control: the bar is a clock on the scan (a negative
`animation-delay` puts a remounted bar where the scan actually is), so
switching tabs or stepping out to the payers editor no longer restarts it, and
a scan whose draft was discarded on the way out drops its result on arrival.

## Driving it without a phone

`pnpm drive`'s `receipt <name>` hands a phone one of the canned bills in
`scripts/fixtures/receipts/`; the scan button is then pressed like any other
control and everything but the round trip to Gemini really runs. It is the only
way to reach the who-had-what grid outside a real scan —
[drive.md](drive.md). It answers a typed bill too, the stub being on the URL and
not on the medium: `click` the Items tab's third door, `fill` the box, press
**Read it**. What comes back is the fixture rather than a reading of what was
typed, which is the right trade for a driver — the dialog, the bar, the refusal
and the draft it fills are all the app's own.

## Gotchas

- **Turnstile cannot be verified by a browser you automate.** Playwright is
  detected — headless renders no widget at all, headful renders the checkbox
  and then fails `600010` when nothing clicks it — so neither outcome says
  anything about whether real people get through. Two automated failures were
  nearly read as a broken deployment; what settled it was a person scanning a
  receipt on a phone. **If you change the widget, a human has to test it.**
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
- **The sweep is an estimate of a real scan, so it moves when the scan does.**
  It was two seconds, calibrated before Turnstile and the budget existed; those
  put two third-party round trips and two D1 ones in front of the model, so
  `sweepSeconds` is three. A bar that fills early and hands over to the spinner
  is this control admitting it was guessing — the one failure it has.
- **What the scan waits on, it waits on in parallel.** Resizing the photo is
  CPU and the challenge is a round trip; run one after the other they simply
  added up, so `scanReceipt` starts the downscale, the bearer token and
  `turnstileToken` together. The warm above is the other half of the same
  idea — the cheapest round trip is the one that already happened.
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
- **A refusal on `/g/scan` used to outlive the screen that showed it.** The
  ordinary "+" seeds under the exact same key (so a *successful* scan there is
  picked up by the form) and so inherited the same `lib/scan/live.ts` entry —
  leave a failed scan any way but a landing and the next screen opened a
  refusal nobody caused on it, under a scan button that never rang. `/g/scan`
  now clears its own error, and only its error, on the way out.
