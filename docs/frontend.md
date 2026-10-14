# Frontend

*For: anyone writing UI. Start here, then read the one doc below your task
names — each is a subject of its own, and none needs the others first.*

Next.js App Router with `output: 'export'`, TypeScript, Dexie. Components are
hand-rolled — no shadcn, no Radix
([ADR-0008](decisions/0008-hand-rolled-interface.md)) — and so is the CSS: every
class in `globals.css`, over a reset at the head of it, with no framework under
them ([design-system.md](design-system.md)). **The whole app is
client-side**: no SSR, no server actions, no Next route handlers. The Worker's
API is reached with `fetch`.

| Read | When you are |
|---|---|
| **This file** | Writing a list or a picker: state, copy, money fields, names, search |
| [entry.md](entry.md) | Touching the entry form or the entry screen: the draft, the split editor, Save, the keyboard's chain |
| [history.md](history.md) | Touching what history says, the clock's dot, or a deleted entry's screen |
| [navigation.md](navigation.md) | Adding a route, a link, a back arrow, anything that leaves a screen, or what a launch opens |
| [touch-and-viewport.md](touch-and-viewport.md) | Handling a press, a hold, a dialog, the keyboard, or the height of the screen |
| [live-reads.md](live-reads.md) | Reading from Dexie, or chasing a screen stuck on its skeleton |
| [pwa.md](pwa.md) | Touching the manifest, the service worker, updates or installing |
| [import-export.md](import-export.md) | Moving a group onto or off the phone, deleting one, or using the clipboard |
| [diag.md](diag.md) | Reading or extending `/diag`, the flight recorder |
| [design-system.md](design-system.md) | Deciding what any of it looks like |

## State

- **Dexie is the store.** Read with **`useLive`** (`lib/db/live.ts`), never
  `useLiveQuery` directly (`pnpm run rules` fails one) — see
  [A live read can die](live-reads.md#a-live-read-can-die).
  No Redux, no Zustand, no server-state library; adding one is an ADR.
  `undefined` from a live read means *not answered yet*, not *empty*. A list screen shows `SkeletonRows` in that
  window and its empty state only once the read has answered.
- Writes go through `lib/db/commands/` — one function per user intent, each
  building an op, appending it and materialising it in one transaction
  (`append.ts`). **Components never write to Dexie directly.** The rule that an
  op carries only what changed is `patch.ts`, once, for both entry editors.
- Device-local, never-synced state (who "you" are, theme, whether the install
  nudge is folded, the last group opened, and the scan credential a quick split
  photographs with — [ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md))
  is in the `device` store. `/new` defaults a fresh group's currency to the
  last-opened group's, and a launch reopens that group
  ([navigation.md](navigation.md#a-launch-reopens-where-you-were)).
  *Changing* who you are is not device-local:
  `claimIdentity` writes an `identity` op
  ([ADR-0003](decisions/0003-link-only-access.md)). `setMe` is the
  device-local half; nothing outside `lib/db/device.ts` should call it.
## Names

- **Adding people is not a dialog.** `components/name-adder.tsx` is the last row
  of a list of names, built like the rows above it — name on the left, one
  control on the right — because that is what it becomes. **A name is filed by
  pressing the plus on that row, and by nothing else**; Enter is the keyboard's
  way of pressing it. Leaving the field files nothing, so a name can sit in the
  row unfiled — and while one does, the row draws itself as a box
  (`.addrow.editing`), because a row that looks like the committed rows above it
  says the opposite of what is true. The box is drawn around the row, not
  inside it, so nothing — the plus included — moves when it appears. **The plus is never dead** — a control
  that looks like a button and answers nothing reads as a broken app — and on
  an empty row it does not refuse either: it takes the caret, and the next
  press of that same button files what gets typed. The one press of it that
  says no is a name the list already holds, which blooms that name, since
  editing it is the fix — **one name, one person** (`core/names.ts`), said
  under the row in words as it is typed and pointed at by the refusal, on every
  list including the one you are picking yourself out of, where the name you
  typed is a row one tap above. How that row blooms, and why a keystroke ends
  its flash, is [refusals.md](refusals.md#a-refused-action-points-first). The
  plus is never spent by a flash the way Create is: the next press of it has
  to file.
  A screen's own button never *files* what is in the field — an unfiled name is
  unfiled, whatever else is pressed — but the two that leave the screen with
  the list behind them **refuse** rather than going on without the name:
  `/new`'s Create, which writes the group in one go, and the quick split's scan
  pair, whose photograph opens a grid of the people on the list and nobody
  else. Both bloom the plus, the entry form's refusal exactly; a blank group
  name blooms the Name field as a blank title does. The picker's Continue is the
  exception that stays: filing a name there *is* picking it, so a name that has
  only been typed is a question it simply does not read. The row also
  **follows the list down**, as a browser scrolls to a field only as it takes
  focus, and this one never lets go — clear of the keyboard, and far enough
  clear that the act the list ends on comes up with it, per the `--kb` Gotcha in
  [touch-and-viewport.md](touch-and-viewport.md#the-screen-and-the-keyboard-over-it).
- **"Which one are you?" is one screen, `components/who-picker.tsx`**, ending
  both ways into a group: joining, and creating one — including a group of one
  (`/new` and `/import` share `components/create-as.tsx`, which keeps a failed
  write on screen under the button that retries it),
  (the bar says "Join", "Create" or "Import {group}" and the question is the
  body's title — `.question`, centred and a size above the bar, because it is
  the first thing a new joiner reads),
  because the answer is written into every op and a screen that sometimes skips
  the question is a screen you cannot learn. Picking is never a write — the
  button is, whether it claims an identity (ADR-0003) or creates the group with
  that name as its actor. The button answers to the tick and to nothing else; a
  name still being typed moves neither. Filing one *does*: the row it adds is
  ticked as it arrives, because a name typed into the list you are picking
  yourself out of is the pick. The tick is a check mark **and** `aria-pressed`:
  a shape is not a sentence, and without it the only thing naming the pick was
  the button at the foot of the screen. That button sits **under the list,
  docked** (`.whodock`): under the last name while the list fits, so it reads
  as the next step after the tap that lit it up, and at the foot of the screen
  once it doesn't — a group of twenty scrolls above it, and on `/g/claim` the
  "Have the app?" dock follows it.
## The ledger's search

`components/ledger-search.tsx` is a bar under the
  top bar, placed by one rule: held — the caret in it, or a query typed — it
  is out whole, and otherwise it is where the scroll puts it (`shownAt`,
  lib/ledger-search.ts). Two doors bring it out: the scroll, a pixel of it for each
  pixel the rows travel over the last bar's height before the base state —
  no faster than the whole bar in 180ms, so a fling gets a slide — and
  **Search** in the group menu, which puts the caret in it and glides the list
  to the base state (`summonLedgerSearch`); the caret put in a bar the scroll
  has only part out glides there too. An empty ledger's menu has no Search:
  there is no first row to bring under the bar. The
  search's *base state* is the whole ledger with its first row directly under
  the bar, which is also where clearing a search returns (`searchBase`; a list
  too short to scroll there is lent the room once the bar is out, until it is back at its head). The
  caret pins nothing: a drag on the list lets go of the field, and let go of
  empty any other way at the base state, the list glides back to its head —
  unless something took the caret (a menu's first item) or a press is still
  down, since that glide is a scroll and a scroll closes the menu it opened. Every word
  typed must be found somewhere on a row (`searchLedger`, lib/ledger.ts): in
  its title, its payers or its participants; as the whole of its currency or
  kind; or as a number in either of its figures. Results are sectioned by the
  best place a word was found, in that order, under lines drawn like date
  lines; within a section more words there comes first, then recency. The
  field answers each keystroke at once and the list follows when it can
  (`useDeferredValue`), so a keystroke typed mid-search supersedes it. A
  transfer's title is its two names and its note. A query is kept for the way
  back from a result and forgotten by any other arrival, like the ledger's
  position (`openingQuery`), and a way back draws the bar
  where the list is put from its first frame, lending the room first.

## Every word, in `lib/copy.ts`

Screens import `copy` and hold no literal a person can read — `aria-label`,
`placeholder` and `title` included; `pnpm run rules` fails a build that types
one back in ([ADR-0033](decisions/0033-every-word-in-one-file.md)). Say it once
and say it short: the screen already shows the amount, the name and the button,
so the sentence beside them carries only what they can't. No em dashes in copy,
ever (the owner: they read as machine-written); `copy.none`'s lone dash, a
blank figure, is the one exception, and `rules` enforces both halves.

**Polish is `lib/copy-pl.ts`**, translated with the owner a section at a time;
`"???"` is a line not yet done. It is reached only from `/diag`'s Language
switch, which writes `bida.lang` and reloads, since `copy` is picked once as the
app loads. That load is a hydration mismatch: the export is prerendered
in English, so React finds text it did not write (error #418) and renders the
page again on the client; shipping Polish means choosing it before React runs. Every page is a client component (`rules`): a server one is prerendered in English and never drawn again, so no switch reaches it. A Polish sentence can't always take a value English hands it (a name
in another case, a past tense with a gender), so a string that needs a
different argument changes its signature in both files.

Dates are words too: `lib/format.ts` spells them from `copy.time` (the app's
own names, a 24-hour clock, `monthsOf` for a month inside a date), never
`Intl.DateTimeFormat`, or a French phone reads "sam. 5 avril" under
"Yesterday". Money still follows the phone's locale.

A string whose wording depends on which way the entry runs is `Voiced<T>` —
`{ expense, income }`, keyed by the entry's kind. Money going out is *paid* and
money coming in is *received*, and a screen that switches only its title
describes the entry the person is not looking at. Every sentence on
`/g/payers` is voiced, as are the history's payer lines.

## Every money field is `components/amount-input.tsx`

There is exactly one, and **no screen sanitises or formats a typed amount
itself** ([ADR-0005](decisions/0005-money-and-currency.md)).

| Export | For | Value |
|---|---|---|
| `AmountInput` | fields whose model is the typed text | `value` / `onChange(text)` |
| `MinorAmountInput` | fields whose model is minor units | `valueMinor` / `onChangeMinor(n)` |
| `GroupedInput` | the two above, and the rate field | `value` / `onChange(text)` / `sanitize` |
| `sanitizeAmount(raw, currency)` | what may be typed | pure, tested |

A real `<input inputMode="decimal">`. It sanitises as you type (digits, one
separator — "," and "." both accepted — fraction clipped to the currency's
exponent, leading zeros stripped), **restores the caret** across its own
reformatting, and **never autofocuses** — a draft that opens with the keyboard
up hides the rest of the form before you have looked at it. `MinorAmountInput`
holds typed text locally and re-reads the model only on outside change — never
`value={bare(parseMinor(text))}`, which eats the caret and erases a half-typed
"12.".

`GroupedInput` is the caret-and-grouping half on its own, and the rate dialog
types into one: a rate is the other figure here with thousands in it. What may be typed is its `sanitize`
— `sanitizeRate` clips no decimals, `sanitizeAmount` clips to the currency's
exponent. The grouping itself is `groupDigits` in `lib/format.ts`, with
`rateText` for the rates we *print*; both are pure and tested.

The other place with real logic is the **balance bar** (around a centre axis,
debit left, credit right), drawn inline on `/g/balances` beside its figure, set
right so the digits stand in columns. Your row says "(you)" after the name
rather than taking the wash other screens give yours. Everything else
is ordinary markup; what more than one screen draws lives in
`components/chrome.tsx` (the frame, plus `Blank` for a screen still waiting on
Dexie, `Foot` for its one pinned act, `Banner`, `Failure`) and
`components/bits.tsx` (`Avatar` — a *group's* initials on a little receipt — `Card`, `KV`).

**Core says what is wrong; the screen says it in money.** `validateSplit` and
`validatePayers` return `problem` (`"under"`, `"over"`, `"empty"`…) and
`diffMinor`; `shortfallText` in `lib/format.ts` writes "€15.00 left to split".
Never print core's `message` for an amount problem — it is deliberately
figure-free.

## Gotchas

- **Constructing an `Intl.NumberFormat` costs far more than formatting.** One
  per figure was half the script of drawing a long ledger; `formatMinor` keeps
  one per shape. Keep any new `Intl` formatter the same way.

- **The theme is a hydration mismatch on purpose.** `<ThemeScript />` sets
  `data-theme` on `<html>` before paint, but the export is prerendered light,
  so React finds an attribute it did not write and says so. `<html>` carries
  `suppressHydrationWarning` for exactly that; removing it brings the console
  error back, and "fixing" the mismatch instead means a flash of paper white
  on every dark-mode launch.
- `output: 'export'` disallows route handlers, `next/image` optimisation, ISR,
  middleware and dynamic params. Needing one is a change to ADR-0004.
- **An input's `size` attribute is not a character count**, it is characters
  times the font's average advance. A field that hugs its own text sizes from a
  hidden mirror (`.amountsizer`), and the input must then be `width: 100%` or
  the column sizes to `size`'s 20-character default.
- **`bare()` is display text; `minorToDecimalString` is canonical text.** Both
  drop the symbol, but `bare` is `Intl`-grouped, so feeding it to an
  `AmountInput`'s `value` or a draft's `amountText` loses money: `parseMinor`
  throws on "1,234.50" (amount silently 0) and reads JPY "25,000" as **25**.
- **What a frame must draw can't be React state set from an effect.** A
  passive effect runs after the paint and its `setState` commits a frame
  later, so the search bar went missing for two frames on a way back. Write
  it to the DOM in a layout effect or a frame callback. A layout effect runs
  before its parent's and before a later sibling's ref is attached, so one
  reading either waits for the frame callback or finds the element in the DOM.
