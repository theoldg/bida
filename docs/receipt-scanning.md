# Receipt scanning

*For: whoever builds or changes the scan. Start here; the table below says
which of the four scan docs your change needs. All of it is built and deployed;
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

| Read | When you are |
|---|---|
| **This file** | Changing how a scan starts, the typed bill, or the control all three screens wear |
| [scan-reading.md](scan-reading.md) | Changing the prompt, what a reading returns, or what the app does with it |
| [who-had-what.md](who-had-what.md) | Changing the grid a bill is divided on, or how extras and discounts spread |
| [scan-worker.md](scan-worker.md) | Touching the Worker's half — the shared key, the envelope, the budget, Turnstile, trust — or a key of the phone's own |

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
drawing reads as what the control leads to rather than as a caption on it.

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
don't see the same ones. Fewer than three names borrows stand-ins.
`diagram.test.ts` checks the shares add up to the picture's total, since
nothing else would notice.

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

With a key of your own ([scan-worker.md](scan-worker.md#a-key-of-your-own)) the middle two lines are
gone: the phone builds the envelope and POSTs it to Gemini itself, with no
Turnstile token, no bearer and no budget. Everything above and below them is
identical.

The scan ends at [`lib/draft.ts`](../apps/web/lib/draft.ts). That's the whole
integration: a draft is *"not a fact about the world yet"*, which is exactly
what a machine's reading of a crumpled receipt is. You review the form, and
saving appends the op the way it always did — one `actor`, one human, no new op
kinds, no schema change, nothing on the log that nobody looked at.

## Typing a bill in

**The scan control's third door**, on every screen that reads a bill but
`/g/scan`. A box, the
bill pasted or typed into it however it is written, and the same filled draft
comes back. It is for the bill nobody photographed — a receipt that arrived as a chat message
or an email, one already thrown away, one a camera has just failed on twice.

**Not on `/g/scan`** (owner's call): the ledger FAB that opens that
screen is a camera and the screen draws a photograph, so it offers two doors
(`typeIn={false}`). Words go in where the form is already open — the Items tab —
or on `/quick`, which has no form behind it.

It is **in** the box and not beside it (owner's call): a reading is a reading
whichever medium it starts from. What that costs is room: three doors share the
width of a phone, so the door says **"Type"** at the two full-width registers,
where a third of 360 pixels holds ten characters or a pencil and not both. At the
chip register — a bill already read, the control standing among its figures —
the box is sized by its contents and it says "Type it in" in full, the way the
camera's door already says "Scan" in one place and "Rescan" in another
(`copy.scan.typeIn`).

The box itself is rendered by `useReceiptScan`, never by a screen, and rides
`scan.inputs` beside the two hidden file inputs. The hook sits at the screen's
root, where nothing a reading does can move it; owned by the control, it would
be unmounted by its own answer, since the Items tab draws one shape with no
bill and another with one.

Everything after the bytes is shared with a photograph: the same endpoint, the
same bearer, the same Turnstile token, the same three budget buckets, the same
`checkScan`, the same rules about what a reading may overwrite. A typed bill
costs what a photo costs and is counted the same (`parseBillText`,
`web/lib/scan/index.ts`).

**What it is not is the same question.** A till roll and a WhatsApp message are
different documents: the photograph's rules (one multiplied amount per line, a
total required) cannot read "3 chicken at 13, 10 beef at 15", which gives a
per-unit price and states no total. So:

- **Its own prompt** (`scan-body.ts`), about a third shorter than the
  photograph's, with no columns, no printer and no merchant in it. The two are
  held together by the schema and by the conventions neither may disagree about
  — plain decimal, deductions positive, tax only on top, nothing in capitals —
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
  [What a reading is checked against](scan-reading.md#what-a-reading-is-checked-against).
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
`mimeType: "text/plain"`** — which the Worker chooses, never the caller. That
is what lets the guard in
[scan-worker.md](scan-worker.md#minimal-cloudflare-quota-the-worker-still-never-touches-the-bytes) stay the one guard: escaping arbitrary text into a
JSON string as it streamed would need a second, subtler check on the hot path.
A typed bill changes what the model *reads* and never what the request *is*.

**The lede asks for none of this.** "The items and prices, formatted however you
like" — it names what the Items tab needs and no shape at all, so nobody tidies
a bill up for the app (`copy.scan.typeIn`).

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
photograph a bad bill is fixed where it was typed.

**And it is said there and nowhere else.** Whose refusal a reading's is gets
decided once, in the hook: the surface it was started from carries the sentence
and the other carries nothing (`ReceiptScan.refusal`, which is null while the
last reading was typed), so the message never shows twice or outlives the
box. The mirror holds: a
photograph refused before the box was opened belongs to the screen that took it,
and is not repeated over the top of it.

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
switching tabs or stepping out to the payers editor does not restart it, and
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

- **The sweep is an estimate of a real scan, so it moves when the scan does.**
  `sweepSeconds` is three, covering Turnstile, the budget's D1 round trips and
  the model; anything added in front of the model should move it. A bar that
  fills early hands over to the spinner.
- **What the scan waits on, it waits on in parallel.** Resizing the photo is
  CPU and the challenge is a round trip, so `scanReceipt` starts the downscale, the bearer token and
  `turnstileToken` together. The warm
  ([scan-worker.md](scan-worker.md#what-the-scan-costs)) is the other half of the same
  idea — the cheapest round trip is the one that already happened.
- **A screen coming back is not a scan starting.** Scan state in the control's
  `useState` restarts the bar whenever the Items tab unmounts (a tab switch, the
  payers editor). What is durable is the scan, not the control drawing it.
- **Opening a dialog and calling `router.push` in the same tick is not a
  sequence** — the navigation unmounts the dialog before anybody sees it. One
  more reason a scan does not navigate.
- **A refusal on `/g/scan` must not outlive the screen.** The ordinary "+"
  seeds under the same key (so a *successful* scan there is picked up by the
  form) and so shares the `lib/scan/live.ts` entry. `/g/scan` clears its own
  error, and only its error, on the way out.
