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
| **This file** | Writing a form, a list or a picker: state, drafts, copy, money fields, rows |
| [navigation.md](navigation.md) | Adding a route, a link, a back arrow, or anything that leaves a screen |
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
  is in the `device` store. Two screens read
  `lastOpenedGroupId`, which `/g` sets on every visit (`setLastOpenedGroup`):
  `/new` defaults a fresh group's currency to that group's rather than always
  EUR, and `/` reopens the group itself on a launch (`lib/launch.ts`) — nearly
  everyone is in one group at a time. A *launch* and not every arrival: the back arrow out of a
  group must not be turned around, so the resume happens once per running copy
  of the app (a module flag), only on a fresh `navigate` — never on a reload or
  a back/forward traversal — and only where the document itself loaded on `/`
  (`startedOnList`): one that loaded on a link has spent its launch on the link,
  and the first press of Back onto the list is a press, not a launch. A group forgotten, archived or gone stays on the
  list, and so does one you backed out of: `/` records itself as this phone's
  place (`leftOnList`, cleared by the next `setLastOpenedGroup`), so a launch
  reopens whichever of list and group was last. `resumeGroupId` is that
  decision, pure and tested. A replace that
  doesn't take releases the list after two seconds rather than leaving the app
  on a skeleton nothing will fill. **The list's frame never paints on a resume**:
  the exported `/` is the list, and IndexedDB answers after first paint, so
  `lib/resume-hint.ts` mirrors the group to resume into localStorage and a
  script before the body marks `<html data-resuming>`, under which `/` shows
  the ledger's skeleton (`LedgerSkeleton`) — the frame `/g` then takes over.
  **A skeleton wears every card it can know without the database**: the
  demo's mark and the folded install or notifications offer
  (`SkeletonBanner`), so the rows never drop when the ledger lands. The mark's
  value names which, decided by the same script and tested against the real
  cards' logic; Chrome's one-tap offer waits on an event and still arrives
  late, as do the sync banner and the new-edits line, which are data. The
  frame goes once the launch decides: hidden is not gone, and its bar's arrow
  would stay registered with the back button.
  *Changing* who you are is not device-local:
  `claimIdentity` writes an `identity` op
  ([ADR-0003](decisions/0003-link-only-access.md)). `setMe` is the
  device-local half; nothing outside `lib/db/device.ts` should call it.
- **The entry draft is never stored** (`lib/draft.ts`): an in-memory store
  shared by the entry screens, so bouncing to the payers/items routes keeps
  what's typed, and nothing else does. One draft covers all three kinds, which
  is what lets the kind chip change your mind without losing the amount you
  already typed. Leaving asks before discarding, and a reload gets the
  browser's own warning — `seedDraft` records the baseline `isDraftDirty`
  compares against. The payers route asks too, and puts back only the payer
  side: the rest of the draft is not its to throw away. So does who-had-what,
  which has to write a split or merged line through as it happens — its rows
  and the bill's lines are one list — and restores the bill it opened with.
  A **quick split** is this same store, keyed by the phone's scan credential
  rather than by a group, which is what makes the whole of it — bill, grid and
  answer — something leaving throws away
  ([ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
  **What the entry is worth is `draftAmountMinor` and nowhere else** — a
  scanned bill is worth what its lines add up to, whatever `amountText` says. With no
  amount at all the door onto that screen doesn't open: there is nothing to
  divide between payers, so the tap reddens the amount field instead — the
  same red Save gives it, held until something asks for it.
- **A draft carries the id its entry will be written under** (`newEntryId`,
  read through `splitSeed`). The leftover minor unit goes by `tiebreakSeed`,
  which is the entry's id — so a form pricing its rows under a placeholder id
  shows the cent on one row and writes it to another. `addExpense`
  takes the id rather than minting one. `pnpm verify entries` holds it.
- **Each split tab is its own input** (`SplitInputs`, ADR-0010): the editor
  draws and edits the tab showing, `openSplitTab` is the one place a newly
  opened tab is handed a starting point, and `activeSplit` says which spec is
  on screen — the receipt's, on its tab, read off the bill. What a first-time
  tab is handed is `arithmeticSplit`, never the receipt: a scan is an answer of
  its own, in a mode of its own, and does not fill in As parts (ADR-0016).
  Which tab is showing lives on the draft alone; a saved entry carries its
  mode, and that is what reopens it.
- **Whether the entry may be saved is `checkEntry` (`lib/entry-check.ts`)**,
  not the form. It answers the amount, the base figure, the split in force and
  why the entry isn't ready — from a draft and its own rate, with no React
  in it, so the arithmetic behind that button is a test suite rather than a
  screen to mount. The form reads its answers and writes none of them.
- **Save is the last row of the form, and the kind is the top of it.** One
  full-width `.btn-lg` ([design-system.md](design-system.md)), because the
  screen has exactly one act; a save failure is said above it. The kind chip sits
  at the top bar's right, inked — the form's second ink block after Save, spent on
  the one choice that reshapes everything under it, with the picker's ⇕ in it
  ([design-system.md](design-system.md)).
- **Every field's value starts on one column** (`--label-w`), so a label is a
  word or two: an income's payer is "Paid to", since "Received by" won't fit.
  Several payers are the payer picker's first row, "Multiple people ›"; with
  no amount it is greyed, "set the amount first" under it, rather than open a
  screen that divides zero. Once set, the form shows them as chips, largest
  amount first.
- **Save is never disabled, and nothing is red for being empty before a tap.**
  A grey button gives no reason, and an untouched field is not a mistake.
  Tapping Save while `!checkEntry(...).ready` refuses instead of saving: what is
  *missing* blooms, so a fresh screen shows no red. `amountMissing`/`titleMissing` *flash* their field red rather
  than adding a caption — a word doesn't fit next to the hero figure and reads
  oddly in a number field — counted per field so a repeat refusal replays
  ([design-system.md](design-system.md#a-dialog-is-ours-and-its-button-says-the-act)).
  That flash is the only thing that reports a missing amount — `splitFooter`
  returns `null` for a zero total. What is *wrong* is said in words, live, in
  the Save dock over the button, where no scroll hides it: `blocker` (a removed
  member, payers that no longer add up to the amount) and `splitProblem` (the
  split now showing, following its tab). A refused Save flashes them and spends
  the button like any bloom. Typed amounts that do add up are ticked there too
  (`splitTick`), but only while nothing is wrong: the dock holds one line. The dock keeps 9px of its own above its first line, so a
  half-scrolled form never runs into it. An Items tab short of
  its split says nothing in words — its step blooms.
- **A press already spending the draft is the form's own `saving` flag.**
  `checkEntry` answers whether the entry *may* be saved, which is a question
  about the form, not whether a save is in flight; without the flag a double
  tap before `router.replace` records the entry twice. `pnpm verify entries` presses
  Save twice.
- **The invite link is `components/invite.tsx`** (`useCopyLink`), written once for the People
  screen's top bar, the groups list's row menu and the group's own menu. `navigator.clipboard.writeText` rejects on an insecure
  context or a denied permission; a refusal puts the
  link on screen to be read (`InviteFallback`,
  [ADR-0003](decisions/0003-link-only-access.md)). A copy that works says so
  where it was asked for, and **all three places run the same flip**: the thing
  that was there **turns away on its X axis and the check comes up behind it**,
  the transfer arrow's "these traded places" read applied to one cell. On the
  groups list — where the menu card has closed and there is no bar to put a
  glyph in — that cell is the row's own figure (`.grouprow .ramt.copied`); on
  the group's kebab (`MenuButton`'s `confirmed`) and People's top bar
  (`InviteButton`) it is the 18px glyph itself, same timings at a shallower
  perspective (`FlipCheck`, `.flipcheck`). A quick split's hand-over is not a
  link but it is a copy, so it answers the same way from its own button: the
  label turns and the check comes up beside the word behind it, the same flip
  across a whole line (`FlipLabel`, `.flipcheck.line`). A transition and not
  the swap's keyframes, because this reverses itself a second and a half later when
  `invite.copied` lapses and a class going away replays no animation — which is
  also why both faces stay drawn.
- **The confirm key hands the caret on, or folds the keyboard.** A phone
  keyboard's bottom-right key is whatever `enterKeyHint` names it, and the word
  it wears is a promise — so `"next"` is both the opt-in and the instruction,
  and **every other field is the end of its chain and puts the keyboard away**
  (`confirmAct`, `lib/viewport.ts`). That is what makes each column of figures
  a chain of its own rather than a stretch of one long one: the entry form runs
  amount → note → fold, and the split editor's "as amounts" and "as parts" each run first person →
  … → last person → fold, started by a tap on a field. A count of parts is
  typed with the money field's caret and Backspace (`PartsInput`), between − and
  + drawn small and grey; having parts puts you in, none
  takes you out, and a tap on the name toggles. **An "as amounts" row is typed, sharing or
  out**: a figure typed, in with none (the rest — what the typed figures leave,
  divided evenly, its share the field's grey placeholder on a faint rule), or
  not in the split (a zero, as faint). A tap on the name never types: typed and sharing go out, out
  comes back sharing, under the mark that says so — a grey × or + for what the
  tap does, Evenly's ink tick for a row that shares. Typing makes any row
  typed; clearing a typed figure leaves it sharing. Over the total, or with
  nothing left, the sharing rows read a red "?" and the dock names them. On
  `/g/payers` a tap on a name is not a focus either: it clears a figure, hands an
  empty row what is left, and types only when the column is already full or
  over (`tapAmount`, marked by `TapMark`), since a payer has no rest to share.
  The tabs stick to the top of `.scroll` and the everyone box, under the last
  row, to its foot, so a long list keeps both in reach.
  **The everyone box toggles the whole list** (`toggleEveryone`), in every tab but
  Items and only from three people up: everyone in takes everyone out, else it
  brings in whoever is out and leaves the rest — a 2 in parts stays 2, a typed
  amount stays, and in amounts whoever was out joins the rest. `walkFields`
  (`components/viewport.tsx`) is the whole of it, hung on `.scroll` because the
  next field is rarely a sibling; it walks that screen's fields in the order
  they are laid out and puts the caret at the *end* of what is already in one
  (entered at character nought, a typed "5" turns "12.00" into "512.00"). It
  steps over what has no caret to take — a date spinner, an amount a scanned
  bill owns, a tab's fields not drawn (`landsOn`) — and an IME's Enter is a
  candidate being picked, never a field being finished. **A field inside a
  `<form>` is left alone**, because its Enter is already spoken for and is a
  better answer than either of these: the add row files the name and hands the
  caret back, a dialog submits its card. What asks for `"next"`: the entry
  form's amount, `/new`'s group name, and each row but the last of a column of
  figures — the split editor's "as amounts" and "as parts", and `/g/payers`;
  `pnpm verify keyboard` walks each column ([browser-checks.md](browser-checks.md#pnpm-verify-keyboard--a-form-under-a-phone-keyboard)).
- **Asking is `components/dialog.tsx`, never `prompt()`/`confirm()`/`<select>`**
  — `ConfirmDialog`, `PromptDialog`, `NoticeDialog` (read, then Close) and
  `ChoiceDialog`, which is every picker in
  the app, behind a `.field > .pick` button or a chip. `<input type="date">` is
  the one native control left
  ([ADR-0008](decisions/0008-hand-rolled-interface.md)).
- **The currency picker offers the group's own currencies first** — the base
  one, then whatever the ledger is written in, most spent-in first, then the
  short common list (`lib/currencies.ts`, `currencyChoices`), then "Other…" for
  any code — one `CurrencyPicker` in /new and the entry form. A trip spends in
  two or three, and scrolling past seventeen to reach one of them is the whole
  of the annoyance. Names come from `Intl.DisplayNames`, with a small fallback
  map for the codes a trimmed locale build answers bare (ISK, UZS).
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
  typed is a row one tap above. **A screen's refusal blooms whatever has to
  change**, so Create over an unfiled name points at the plus that would file
  it and Create over a list too short to go on with washes the whole row red,
  placeholder and plus included. **A keystroke ends any flash on the
  row** rather than letting it run out — typing is the fix landing, and a
  placeholder just typed over cannot carry a refusal — and it tells whoever
  owns that flash, so Create un-greys with it (`lib/refusal.ts`; a flash cut
  short fires no `animationend`). The plus is never spent by a flash the way
  Create is: the next press of it has to file.
  A screen's own button never *files* what is in the field — an unfiled name is
  unfiled, whatever else is pressed — but the two that leave the screen with
  the list behind them **refuse** rather than going on without the name:
  `/new`'s Create, which writes the group in one go, and the quick split's scan
  pair, whose photograph opens a grid of the people on the list and nobody
  else. Both bloom the plus and are spent for the length of that flash, the
  entry form's refusal exactly (`lib/refusal.ts`). Create is never grey either:
  a blank group name is the entry form's blank title over again, so it blooms
  the Name field the same way instead of holding the button dead, and a press
  missing both blooms both at once. The picker's Continue is the
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
- History wording is assembled once, in `lib/history-copy.ts` (`describe`),
  from `copy.history`. One revision usually moved several fields — an entry is
  saved whole — and then it returns no sentence about any one of them, but a
  labelled was/now line for each; it reads the fold either side of the revision,
  not just the fields that moved, and where a list moved it says so as rows
  (`lib/history-rows.ts`, drawn by `components/revision.tsx`, the sixth and
  later folded behind "Show N more") — [sync.md](sync.md#history-ui). It must
  be **total** — it runs inside a render over every patch the log holds, so one
  throw is a white screen, not a missing line. People are listed **by name**,
  not in the order they are stored: an id is a hash of the name (ADR-0034), so
  sorting by it puts a was/now pair in two unrelated orders.
- **The history screen reads the deleted entries too.** Both its subject links
  and its title come from maps built over every entry the group has ever had —
  half the reason to open it is one that is gone. A deleted entry's line ("Dinner
  · deleted") opens the entry itself, and its own history backs up to it. Its
  line is `components/revision.tsx`, shared with the ledger.
- **A deleted entry keeps its screen** (ADR-0031): drawn as it was, at the rates
  it was saved at, from `useGroupData`'s `withTombstones`. Drawn as it was, it
  read as live, so the state leads: the bar says "Deleted expense", and an
  inverted band above the title says "Deleted by {name}", and holds
  **Restore** — which asks nothing and turns the screen back into the live
  entry in place. The trash and Edit are gone. What else it brings back, a
  removed person or a cleared rate, is named under the band before the press
  (`restoreEntryDrafts`). Deleting still leaves for the ledger, and the screen
  never turns into its deleted self on the way: the live read lands before the
  navigation does on a phone, so from the answer on it keeps drawing the entry
  as it was. "Gone" is only
  an id this phone has never had.
- **The ledger's search** (`components/ledger-search.tsx`) is a bar under the
  top bar, placed by one rule: held — the caret in it, or a query typed — it
  is out whole, and otherwise it is where the scroll puts it (`shownAt`,
  lib/ledger-search.ts). Two doors bring it out: the scroll, a pixel of it for each
  pixel the rows travel over the last bar's height before the base state —
  no faster than the whole bar in 180ms, so a fling gets a slide — and
  **Search** in
  the group menu, which puts the caret in it and glides the list to the
  search's *base state* — the whole ledger with its first row directly under
  the bar, which is also where clearing a search returns (`searchBase`; a list
  too short to scroll there is lent the room once the bar is out, until it is back at its head). The
  caret pins nothing: a drag on the list lets go of the field, and let go of
  empty any other way at the base state, the list glides back to its head. Every word
  typed must be found somewhere on a row (`searchLedger`, lib/ledger.ts): in
  its title, its payers or its participants; as the whole of its currency or
  kind; or as a number in either of its figures. Results are sectioned by the
  best place a word was found, in that order, under lines drawn like date
  lines; within a section more words there comes first, then recency. A
  transfer's title is its two names and its note. A query is kept for the way
  back from a result, like the ledger's position.
- **The ledger's new-changes line** (`components/new-edits.tsx`) sits under the
  you-owe card, drawn as a date line in full-ink text, with a chevron at its
  right edge that swings into a cross as it opens, because folding it clears it:
  "4 new changes", unfolding onto every one of those revisions and nothing
  else — no cap, since there is no link on to the rest. New is `unseenRevisions`
  (`core/history.ts`): an op numbered past `groupKeys.seenSeq` whose stamp is
  another phone's, your own laptop included, less a device claiming a name.
  **Showing it is seeing it**: the line stays up for as long
  as the ledger is open, and the next navigation away marks all of it seen —
  the catch-up is optional, so it is offered once rather than on every visit.
  Folding it back after unfolding is done with it: it fades and folds away
  like a deleted row (`foldAway`), and only a later change brings it back.
  What waits on a group nobody opens ages out after a week (`CATCH_UP_MS`)
  rather than sitting on the groups list forever. The groups list is ordered
  by when each group last changed — its newest op, an edit or a delete as much
  as a new entry — never by its latest entry's date. It leads
  a row's meta with the same count, reading the log only for a group whose
  cursor is past its mark. The first pull sets the mark at the cursor, so a
  joined group opens with nothing new, and the mark is device-local, never an
  op.

## Every word, in `lib/copy.ts`

Screens import `copy` and hold no literal a person can read — `aria-label`,
`placeholder` and `title` included; `pnpm run rules` fails a build that types
one back in ([ADR-0033](decisions/0033-every-word-in-one-file.md)). Say it once
and say it short: the screen already shows the amount, the name and the button,
so the sentence beside them carries only what they can't. No em dashes in copy,
ever (the owner: they read as machine-written); `copy.none`'s lone dash, a
blank figure, is the one exception, and `rules` enforces both halves.

Dates are words too: `lib/format.ts` spells them from `copy.time` (English
names, a 24-hour clock), never `Intl.DateTimeFormat`, or a French phone reads
"sam. 5 avril" under "Yesterday". Money still follows the phone's locale.

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
right so the digits stand in columns. Everything else
is ordinary markup; what more than one screen draws lives in
`components/chrome.tsx` (the frame, plus `Blank` for a screen still waiting on
Dexie, `Foot` for its one pinned act, `Banner`, `Failure`) and
`components/bits.tsx` (`Avatar` — a *group's* initials on a little receipt — `Card`, `KV`).

**Core says what is wrong; the screen says it in money.** `validateSplit` and
`validatePayers` return `problem` (`"under"`, `"over"`, `"empty"`…) and
`diffMinor`; `shortfallText` in `lib/format.ts` writes "€15.00 left to split".
Never print core's `message` for an amount problem — it is deliberately
figure-free.

## A row would rather say less than be cut off

`FitLine` (`components/fit-line.tsx`) takes several wordings of one line,
longest first, and renders the longest that fits its own box — measured on a
canvas in a layout effect, so it is picked before paint and there is no
feedback loop between the text and the box deciding it. `lib/fit.ts` is the
measuring (`fitIndex` is pure and tested); `lib/row-meta.ts` is the editorial
order, which is the part worth arguing about
([design-system.md](design-system.md#a-row-says-less-rather-than-being-cut-off)).
It renders the longest rung when it cannot measure — no canvas, no layout yet —
so the static export ships the full line and the browser narrows it. A `lead`
(the group list's bold "N new changes") rides ahead of every rung, and the
rungs fit in the width it leaves. Every fit re-measures on resize and when the
web font lands, through one `useRefit`.

## Your own money, pulled out of the group's

Always on, not a setting ([ADR-0007](decisions/0007-a-screen-is-a-route.md)),
and it changes rendering only — never data or what syncs. Every row carries a
signed, coloured effect: what you put in for that entry minus what you owe for
it (`myEffect` in `lib/entry-kind.ts`, one subtraction for all three kinds).
The column adds up to the net printed above the list, on the balance card —
words over figure, the figure sized to its own length in CSS alone (`.mysum`
in `globals.css`), so a seven-digit sum shrinks rather than runs under the
chevron. **A changed figure rolls** (`components/rolling-figure.tsx`): each
digit that changed slides one line, up for a bigger figure and down for a
smaller, 800ms apiece and 100ms apart from the left; the rest never move. One
trigger covers a save, a sync and a reopen — the card keeps the net it last
drew per group in localStorage (`lib/roll.ts`, erased with the group) and rolls
from it, a beat after mounting; a group's first view, and reduced motion, just
show the figure. The card's words and colour keep the old sign until the
figure sets off, then fade over the roll, so a settle-up greys as it rolls to
zero. Rows involving neither
your money nor your share drop to `opacity: .58`; the rest are plain rows, with
no wash or coloured edge. An expense or income on the entry screen repeats its row's figure under
the split card, "Your balance", which unfolds to `effectSum` (the same
subtraction) when you both paid and had a share, and marks your name with a
faint `(you)`; a transfer shows neither. What it looks like and why:
[design-system.md](design-system.md#your-own-rows-are-highlighted).

## Gotchas

- **The theme is a hydration mismatch on purpose.** `<ThemeScript />` sets
  `data-theme` on `<html>` before paint, but the export is prerendered light,
  so React finds an attribute it did not write and says so. `<html>` carries
  `suppressHydrationWarning` for exactly that; removing it brings the console
  error back, and "fixing" the mismatch instead means a flash of paper white
  on every dark-mode launch.
- `output: 'export'` disallows route handlers, `next/image` optimisation, ISR,
  middleware and dynamic params. Needing one is a change to ADR-0004.
- **A revision's `changes` are only the fields that actually differed.** Saving
  an expense in a new currency at the same rate writes `currency` and no amount
  field at all, so history copy must never read one field because a sibling
  changed.
- **A controlled input that reformats on every keystroke eats the caret.** If a
  field must reformat as you type, it has to restore the selection itself.
- **An input's `size` attribute is not a character count**, it is characters
  times the font's average advance. A field that hugs its own text sizes from a
  hidden mirror (`.amountsizer`), and the input must then be `width: 100%` or
  the column sizes to `size`'s 20-character default.
- **`bare()` is display text; `minorToDecimalString` is canonical text.** Both
  drop the symbol, but `bare` is `Intl`-grouped, so feeding it to an
  `AmountInput`'s `value` or a draft's `amountText` loses money: `parseMinor`
  throws on "1,234.50" (amount silently 0) and reads JPY "25,000" as **25**.
- **`patch()` on the expense draft must merge against the latest saved draft,
  not the `draft` the current render closed over.** Two `patch()` calls in one
  handler otherwise both merge onto the same stale closure and the second
  silently undoes the first. `patch()` reads `getDraft(groupId)` itself, so a handler may.
- **A `::placeholder` is not rendered while its field has text**, so it is
  *created* when the field goes empty — and a freshly created pseudo-element
  starts any animation still declared on it. Leaving a one-shot animation class
  on a settled field replays it every time the field is emptied. Take the class
  off on `animationend`; `e.pseudoElement` says whether the event came from the
  element or its placeholder.
- **Back from a save, the ledger draws the old net for a frame** — its live
  query answers before the write lands. So a save's roll is usually a change
  arriving while the card is mounted, not one read from `bida.shown`; a check
  waiting for `.rolling` must wait for it, not look once.
