# Receipt scanning

*For: whoever builds or changes the scan. Start here; the table below says
which of the five scan docs your change needs. All of it is built and deployed;
[ADR-0016](decisions/0016-receipts.md) holds the UX rulings.*

Photograph a receipt — or [type its items in](#typing-a-bill-in) — and get the expense
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
the photograph you already took, or [type the items in](#typing-a-bill-in).

| Read | When you are |
|---|---|
| **This file** | Changing how a scan starts, the bill typed by hand, or the control all three screens wear |
| [scan-reading.md](scan-reading.md) | Changing the prompt, what a reading returns, or what the app does with it |
| [who-had-what.md](who-had-what.md) | Changing the grid a bill is divided on, or how extras and discounts spread |
| [scan-worker.md](scan-worker.md) | Touching the Worker's half — the shared key, the envelope, the budget, Turnstile, trust — or a key of the phone's own |
| [scan-bench.md](scan-bench.md) | Measuring a prompt change against 50 strangers' receipts, by hand |

`/g/scan` and `/quick` both have to promise something they can't show, since a
scan's result is on another screen, so they draw it — one drawing,
`components/scan-diagram.tsx`, shared rather than copied: a bill of four lines
and a total — a cantina tab, like the stand-in names — — torn off at both ends, outlineless, so it reads as paper and not
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
are added. Come back to it from the grid and the bill is still held: the dock
is the doors, grey and over the bill (`overBill`), and under them the Items
tab's own button on to the grid.

The words are `copy.scan.diagram`, but the arithmetic isn't: `lib/scan/diagram.ts`
sums the shares from the same lines the left-hand card prints, and picks the
three names by the seed it is given — the group's id, or the quick split's
credential — so one group or one split sees the same faces each time and two
don't see the same ones. Fewer than three names borrows stand-ins.
`diagram.test.ts` checks the shares add up to the picture's total, since
nothing else would notice.

## The shape

```
phone: capture or pick from library → straighten + crop → downscale → base64 (+ a Turnstile token)
  ↓ POST /api/groups/:id/scan   (body = the bill; bearer = group secret)
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

**The scan control's third door is the bill's items by hand**
(`/g/entry/bill`, `/quick/bill`, `components/bill-editor.tsx`): a card per
item — a name over a price and a count (`×3`) — the tip and the total under the last card,
and no model in between. It is for the bill
nobody photographed, and for fixing the one a photograph misread. The door says
**"Type"**, with a bill held or not — short, since three doors share a phone's
width — and the screen opens
on the bill held, folded back to the lines it was printed as and named in the
language the bill is read in. The grid's translate toggle sits on its bar too,
while any line has a second name, and is the same choice (`receiptEnglish`):
it swaps every name still as it opened. **A typed name is the line's only
name** from then, in either reading: a correction that vanished on switching
back to the printed words would be no correction.
**Not on `/g/scan`** (owner's call): that screen is reached by pressing a camera
(`typeIn={false}`).

- **Every line of the bill is a card** and has a kind — **Item**, **Discount**
  or **Charge** ([who-had-what.md](who-had-what.md#tip-charges-and-discounts)),
  picked in a `ChoiceDialog` behind each card's kebab. A discount or a charge
  wears its kind as a chip beside the name; an item, which most lines are, says
  nothing, so the others stand out. A discount or a charge has
  no count and is typed positive, its sign beside the field.
  So a service line read as an item is fixed here, and a bill typed by hand can
  have a voucher. The **tip** sits over the total, off any card, the same field the grid types.
  A card's count survives a change of kind, and an item made a discount and
  back keeps whoever had it, until Done. "Add an item" puts its card after the
  last item, where the bill reopens it, and so does the last item's confirm key.
- **Either price can be typed** with a count above one, which reads "each
  12.00 total 24.00 − ×2 +", the count ending the line (a price alone starts
  under the name): the one typed holds
  and the other follows, in minor units (`lib/scan/manual.ts`). A four-digit
  price ("1 200.00") scrolls in its field at 360px. A count raised is
  more at the same price: a single item's price is a unit price, and a
  printed line opens on its unit price where its count divides it — where it
  doesn't, on the total printed, so no cent moves.
- **Done writes the bill whole**; Back with changes asks first. Whoever had a
  line keeps it through a rename, a new price or a new count (`billFromRows`);
  a line new here has nobody, so the bill is unassigned again until the grid
  gives it somebody ([who-had-what.md](who-had-what.md#the-grid)),
  and the amount follows the bill, charges, discounts and tip included.
  Payers typed as amounts don't follow: what each paid is a fact, so a bill
  that moves under them is refused on the form with Paid by blooming
  ([refusals.md](refusals.md#a-refused-action-points-first)).
- **Done refuses an empty card, a name with no price and a price with no
  name** — said by the line's name where it has one — and with no item cards
  blooms "Add an item": a bill is never cleared here, since another split tab
  is how an expense stops being split by items. Discounts that leave nothing to
  pay bloom too, as `checkScan` refuses such a scan. Done on a bill left as it
  opened writes nothing. On `/quick` Done goes back to
  `/quick`, as a scan stays there.

## What it's made of

`packages/core/src/scan.ts` — the normaliser and `SCAN_LIMITS`, no network ·
`apps/api`'s `scan-limits.ts` — the budget, the client key and Turnstile ·
`apps/web/lib/scan/budget.ts` and `turnstile.ts`, their two halves on the phone
· `apps/api`'s `POST
/api/groups/:id/scan` — the same bearer-token
check as sync, passing through to
`GEMINI_MODEL = "gemini-3.1-flash-lite"` (one constant in `packages/core/src/scan-body.ts`;
the key is the `GEMINI_API_KEY` Worker secret —
[hosting.md](hosting.md#deploying)) and the envelope is
`apps/api/src/scan-body.ts` (an envelope per tone, and the base64 guard
`scan-body.test.ts` attacks) · `apps/web/lib/scan/` — `downscale.ts`,
`response.ts` and `scanReceipt()` ·
`components/bill-editor.tsx` and `lib/scan/manual.ts`, the bill by hand ·
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
A scan that brought lines back stays there as `landed` until the Items tab's
way into the grid is on screen to take it and flash
([refusals.md](refusals.md#not-every-flash-is-a-refusal)): from `/g/scan` it
lands a screen before that button exists.

## Driving it without a phone

`pnpm drive`'s `receipt <name>` hands a phone one of the canned bills in
`scripts/fixtures/receipts/`; the scan button is then pressed like any other
control and everything but the round trip to Gemini really runs. It is the only
way to reach the who-had-what grid outside a real scan —
[drive.md](drive.md) — or through the third door, where the bill is typed in by
hand and no stub is needed.

## Gotchas

- **An Android camera can refuse in silence.** With Chrome's own camera
  permission off, `capture` opens nothing and says nothing. `watchCamera`
  (`lib/scan/camera.ts`) takes a page that never lost focus within 2s, or a
  `cancel` before it did, as that, and says so in a dialog.

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
