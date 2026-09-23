# Frontend

*For: anyone writing UI, routing, or PWA code.*

Next.js App Router with `output: 'export'`, TypeScript, Dexie. Components are
hand-rolled — no shadcn, no Radix
([ADR-0008](decisions/0008-hand-rolled-interface.md)) — and so is the CSS: every
class in `globals.css`, over a reset at the head of it, with no framework under
them ([design-system.md](design-system.md)). **The whole app is
client-side**: no SSR, no server actions, no Next route handlers. The Worker's
API is reached with `fetch`.

## Routing

Only static routes exist — a static export can't generate a page per group id.
Each screen is its own route, with the group id (never the secret) in the query
string ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).
`lib/group-link.ts`'s `route` object is the one place URLs are built.

| Route | Purpose |
|---|---|
| `/` · `/new` | Groups list, unless a **launch** reopens the group you were last in (`lib/launch.ts`, whose `arrival` is the one answer to what brought you here) — the app's name, the light/dark toggle ([ADR-0007](decisions/0007-a-screen-is-a-route.md)), and a row menu holding the invite link and "Forget group" · name, currency and everyone in the group, then which of them you are |
| `/g?id=[&tab=]` | The group: ledger / balances tabs — back from balances is the ledger, not the groups list, since the two tabs are one screen. Settling lives under the balances, and a suggested payment opens a card, not a form — two names, the arrow, the figure, `Cancel`/`Record` — because every figure on it is the app's (`SettleDialog`, `app/g/page.tsx`); the invite link, People, Rates, History and "Forget group" are one top-bar menu (`components/group-menu.tsx`) |
| `/g/entry?id=&e=[&via=]` | One entry — expense, income or transfer. The id is looked up in both tables ([ADR-0010](decisions/0010-what-an-entry-is.md)). The bar carries the kind and the date; under it the entry's own title, sized to the largest step that says it in one line (`FitTitle`), and the figure ([design-system.md](design-system.md#the-bar-is-furniture)), so the kind needs no chip of its own. `via=history\|members\|rates\|balances` is the screen that linked in from beside it, and is where back goes. The split card lists only the people in the split — an outsider's absence is the whole message. On a scanned expense each person's row opens onto what they had (`receiptBreakdown`) |
| `/g/entry/edit?id=[&e=][&kind=][&via=][&from=&to=&amount=&title=]` | Add or edit any of the three: one form, a kind chip, and the split inline ([ADR-0010](decisions/0010-what-an-entry-is.md)). Settle-up is the only caller that sends `title` — "Reimbursement" — so a blank transfer stays untitled. Saving unwinds to `formParent`: the entry it was editing, or the screen `via` names |
| `/g/scan?id=` | Scan first, decide after: a drawing of what a photo becomes, and the control that takes one, reached from the camera above the ledger's "+". Fills a blank expense draft and hands it to `/g/entry/edit` with `replace`, so back from the form is the ledger ([receipt-scanning.md](receipt-scanning.md)) |
| `/g/entry/items?id=[&e=]` | The who-had-what grid: who was there across the top, the bill's lines down the side, running totals below. Writes a `receipt` split ([ADR-0016](decisions/0016-receipts.md)), and is reached from the form's Items tab — never navigated to by a scan ([receipt-scanning.md](receipt-scanning.md)) |
| `/g/tip?id=` | The tip jar, off a FAB on the balances tab: what a scan costs, Buy Me a Coffee, and an ordinary expense to record what you gave ([product.md](product.md#the-mvp)) |
| `/g/payers?id=` | Who *put the money in* (or took it in), for co-sponsored entries ([ADR-0010](decisions/0010-what-an-entry-is.md)) |
| `/g/history?id=[&e=][&via=]` | Version history, whole-group or per-entry. Per-entry carries the entry's own `via` so the chain back stays exact |
| `/g/rates?id=` | The group's exchange registry: one row per currency it spends in, each opening the rate dialog — which only ever edits the number, since deleting a rate is on the row's long-press menu, as it is for an entry. Adding a currency here is the same dialog the entry form opens by itself ([ADR-0005](decisions/0005-money-and-currency.md)) |
| `/g/members?id=` | People: the member list, its check mark saying which of them this phone is, a trash button on everyone else. Adding is the last row of the list; changing identity is a button under it. Removing and changing identity each ask in a dialog ([ADR-0008](decisions/0008-hand-rolled-interface.md)) |
| `/g/claim?id=` | The last step of joining: pick who you are, then a button into the group — the same picker `/new` ends on. In an iOS tab, a card under it holds the link to paste into the home-screen app (`UseInApp`, [ios.md](ios.md#gclaim--have-the-app)) |
| `/quick` · `/quick/items` · `/quick/result` | A bill split with people who are **not** a group ([ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md)): the drawing of what a scan becomes, who is splitting, and the camera · the who-had-what grid · the answer, handed over as text. No group id anywhere — it appends no op, asks nobody who they are, and lives in the draft store until it is left |
| `/demo` | The demo group: creates it, or reopens the one on the phone, and `replace`s into its ledger. Idempotent because its id is the constant `DEMO_GROUP_ID` (`core/demo.ts`); `demoStamp()` fingerprints the seed, so an older build's demo is erased and re-seeded. **Linked from nowhere in the app** — it is a group somebody sends you to. It differs from an ordinary group only where it has no key ([sync.md](sync.md#the-demo-group-has-no-key)): a permanent mark atop the ledger (`components/demo.tsx`), **no install offer** under it ([ios.md](ios.md#the-card--the-groups-list-and-the-ledger)), **Copy invite link** refusing out loud, and **Clear the demo** in place of Forget group — `eraseGroupLocally`, not `forgetGroup`, since a hidden demo with no link is dead data; its dialog prints the address (`useHost`) that re-seeds it. Scanning, export and the tip jar all work ([product.md](product.md#the-mvp)) — the camera on this phone's own scan credential (`useScanAs`) |
| `/about` | Source link, who can edit, offline, where to complain, what the server can see, and the hosted service's one disclaimer (a one-person project that cannot restore a lost link). Off the quiet line at the foot of the groups list; no pitch. "Works offline" is its one client island (`AboutOffline`, `lib/install.ts`). Privacy *shows* one stored row, so it is only honest while op bodies reach the server sealed ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)) — change it in the same commit as that. Its two exceptions (receipt photo, Tricount fetch) are repeated here, but the binding copy is `copy.scan.terms` and `copy.importData.fineprint`. The build's version sits in the top bar's corner ([hosting.md](hosting.md#versions)) |
| `/g/export?id=` | The group as a spreadsheet, in text, for a browser that cannot hand over a file — `/diag`'s layout, because it is the same act. Reached only from the last rung of `lib/export.ts`; it rebuilds the CSV itself rather than being handed it, since a route cannot carry a file and a readout that empties on reload is the drawer state [ADR-0007](decisions/0007-a-screen-is-a-route.md) removed. Being an ordinary route it can also just be opened, so the sentence over the text asks `fileHandoff()` rather than asserting that this browser can't save one ([below](#getting-a-group-off-the-phone)) |
| `/import` | A Splitwise (or bida) CSV as a **new** group ([below](#bringing-a-group-onto-the-phone)). Off the groups list's kebab, not from inside a group: what it makes *is* a group, and merging a file into one that already has entries would mean deciding which row is which entry, which the file carries no ids to decide. Pick a file or paste a Tricount link, read, look at the plan, then the `/g/claim` picker over the source's own people — with no add row, since a name with no column in the file has no balance to be |
| `/delete-my-data` | Deleting a whole group from the server, for everybody in it ([below](#deleting-a-group)). Linked from nowhere: `/about` prints the address for somebody to type, which is the first of this screen's frictions. It is the address somebody reaches for anyway when they want a service to forget them |
| `/diag` | The flight recorder's readout. Linked from nowhere — long-press the app's name on the groups list ([below](#the-flight-recorder-and-diag)) |
| `/join#<groupId>.<secret>` | Invite landing: saves the secret, pulls, then hands the group to `/`, which pushes it (`handOverToGroup`, `lib/launch.ts`) — a link tapped in a chat opens a browser one history entry deep, so this screen gives its entry to the groups list rather than to the group, and the device's back button climbs the app instead of leaving for the chat. A phone that has never said who it is goes on to `/g/claim` — but by `useClaimGate` below, not by this screen, so the same link opened again by someone already in the group just opens it. A fragment with a group id and no secret — and any `/g` screen for a group this phone doesn't hold — shows `KeylessLink` instead of "Bad link": that is the browser bar's address, so it says so and draws the group menu with "Copy invite link" lit. Both failures share its layout and print the link they are about — what was pasted, if it came by **Paste link** (`lib/failed-link.ts`). Everything else is the waiting screen, prerendered in the static export (wordmark and *Joining…* from first byte); only its body waits for the key |
| `/install` | iOS only: why the home-screen app, and how. Also where the icon first opens, taking in the groups and names it carries. Off the iOS tab's banner, atop the groups list or a group's ledger |

**Every `/g` route requires a claimed identity**, via `useClaimGate`
(`lib/hooks.ts`), which sends a phone that hasn't answered "who are you" to
`/g/claim`. An unclaimed device has no honest `actor` to sign an op with, and
every screen under `/g` writes one — so it is an illegal state, not a case to
accommodate. Gate every `/g` route, not just `/g`: the others are reachable
directly (a bookmark, a back arrow, a settle-up link), and an ungated one signs
ops as nobody.

**Every `/g` route validates its id.** They all read the group out of the query
string, and a link naming a group this phone doesn't have — a stale bookmark, a
URL shared to somebody who never joined — must not spin forever on
`useGroupData(undefined)`. Each, `/g` included, renders `BadLink` (`components/chrome.tsx`), which says
what a proper invite link is, under a bar with no title. `pnpm rules` fails a
`/g` page that renders none: `data.group` is `undefined` while the read is in
flight and again when there is no such group, so a screen that forgets to ask
which of the two it has is a blank that never fills.

**A screen whose draft has gone hands back rather than waiting.** The entry
form's two detours — `/g/payers` and `/g/entry/items` — edit one side of a
draft that lives in memory and nowhere else (`lib/draft.ts`), so a reload, a
bookmark or a forward press onto an entry already saved arrives with nothing
to edit. Each `replace`s to the group's ledger, where the form was opened
from, as the quick split's own two screens do to `/quick`.

**A path that is no route** gets `app/not-found.tsx` — the export's
`out/404.html`, which is what the Worker serves for anything it hasn't got
(`not_found_handling`, `apps/api/wrangler.toml`). It says `BadLinkNotice`, the
same sentence `/join` says about a link that opens nothing, over a bar back to
the groups list: this app is pasted links, and a chat client wrapping a long
one so half of it arrives is the ordinary way here.

**Back goes up, not back.** A screen's `back` is one of two things and the
device's button agrees with both (`lib/back-button.ts`,
[ADR-0007](decisions/0007-a-screen-is-a-route.md)). A path names a parent, and
`goUp` (`lib/nav.ts`) unwinds the history to it instead of pushing — the button
needs no help here, because with only descending pushing the browser's own back
*is* the arrow; it is taken over only where the arrow skips a level. `{ ask }`
is a screen that would lose typed work: it answers *may I leave?* before
anything is cancelled, and a no cancels the press with the dialog as the whole
of the answer — nothing navigates in its place. **Cancelling a press is not
free**: it spends the document's history-action activation, which is also what
lets the dialog it opens refuse the *next* close request, and what the browser
requires before it will mark a traversal cancelable at all. So a run of back
presses with no tap between them degrades — the dialog is shut by a press the
app cannot hear about without `Dialog`'s `close` listener (Gotchas), and
eventually a press arrives uncancelable and leaves for good. That last one is
the degradation ADR-0007 names, and it is **accepted behaviour, not a bug to
fix**: on `/new` and `/quick` it costs what was typed, and a page that could
refuse indefinitely is the trap the metering exists to prevent. Any tap in the
page refills it. An
entry is the one screen whose parent isn't fixed: the history feed, the two
"can't remove this yet" lists and the balances tab's tip jar link in from
beside it, so they pass `via=` and `entryParent` (`lib/group-link.ts`) sends back
there instead of to the group. The entry form carries the same `via` — through
who-had-what and back — so **saving** unwinds to wherever the form was opened
from (`formParent`) rather than dropping everyone on the ledger. A
`<Link>` to an ancestor or a sibling must `replace`; only descending pushes.

**The group secret lives in the URL fragment**, which browsers never send to a
server ([ADR-0004](decisions/0004-static-export-and-offline.md)). Never move
it into a path or query string "for convenience". The id alone is fine — it
confers nothing without the secret.

## State

- **Dexie is the store.** Read with **`useLive`** (`lib/db/live.ts`), never
  `useLiveQuery` directly (`pnpm run rules` fails one) — see
  [A live read can die](#a-live-read-can-die).
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
  on a skeleton nothing will fill.
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
  takes the id rather than minting one. `pnpm entries` holds it.
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
  why the entry isn't ready — from a draft and the group's rates, with no React
  in it, so the arithmetic behind that button is a test suite rather than a
  screen to mount. The form reads its answers and writes none of them.
- **Save is the last row of the form, and the kind is the top of it.** One
  full-width `.btn-lg` ([design-system.md](design-system.md)), because the
  screen has exactly one act; a save failure is said above it. The kind chip is
  centred on the top bar (`TopBar`'s `mid` slot, beside a `capped` title).
- **Save is never disabled, and nothing reads as wrong before a tap says so.**
  A grey button gives no reason, and a red line before any tap is unearned.
  Tapping
  Save while `!checkEntry(...).ready` sets the form's own `attemptedSave`
  instead of saving; every red state is gated on it, so a fresh screen shows
  none of them. `amountMissing`/`titleMissing` *flash* their field red rather
  than adding a caption — a word doesn't fit next to the hero figure and reads
  oddly in a number field — counted per field so a repeat refusal replays
  ([design-system.md](design-system.md#a-dialog-is-ours-and-its-button-says-the-act)).
  That flash is the only thing that reports a missing amount — `splitFooter`
  returns `null` for a zero total. `blocker` (a missing rate, a removed member,
  an unbalanced payer split) is a sentence about a relationship the form can't fix by
  typing into the field it's next to, so it keeps its spot above the split
  editor, behind the same flag; `receiptBlocker` stays in the split's footer,
  its "Scan a receipt" half behind the flag for the same reason — an untouched
  Items tab has no bill yet — while the bill-nobody-has-assigned half, and
  the split's other complaints, follow an edit and stay live. Nothing
  is focused or scrolled to: the form is one screen.
- **A press already spending the draft is the form's own `saving` flag.**
  `checkEntry` answers whether the entry *may* be saved, which is a question
  about the form, not whether a save is in flight; without the flag a double
  tap before `router.replace` records the entry twice. `pnpm entries` presses
  Save twice.
- **The invite link is `components/invite.tsx`**, written once for the People
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
  amount → note → fold, and the split editor's "as amounts" runs first person →
  … → last person → fold, started by the tap that picks a row. `walkFields`
  (`components/viewport.tsx`) is the whole of it, hung on `.scroll` because the
  next field is rarely a sibling; it walks that screen's fields in the order
  they are laid out and puts the caret at the *end* of what is already in one
  (entered at character nought, a typed "5" turns "12.00" into "512.00"). It
  steps over what has no caret to take — a date spinner, an amount a scanned
  bill owns, a tab's fields not drawn (`landsOn`) — and an IME's Enter is a
  candidate being picked, never a field being finished. **A field inside a
  `<form>` is left alone**, because its Enter is already spoken for and is a
  better answer than either of these: the add row files the name and hands the
  caret back, a dialog submits its card. Four fields ask for `"next"`: the entry
  form's amount, `/new`'s group name, and each row but the last of the two
  columns — the split editor's "as amounts" and `/g/payers`. `pnpm keyboard`
  walks both columns ([testing.md](testing.md)).
- **Asking is `components/dialog.tsx`, never `prompt()`/`confirm()`/`<select>`**
  — `ConfirmDialog`, `PromptDialog` and `ChoiceDialog`, which is every picker in
  the app, behind a `.field > .pick` button or a chip. `<input type="date">` is
  the one native control left
  ([ADR-0008](decisions/0008-hand-rolled-interface.md)).
- **The currency picker offers the group's own currencies first** — the base
  one, then whatever the ledger is written in, most spent-in first, then the
  short common list (`lib/currencies.ts`, `currencyChoices`). A trip spends in
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
  says the opposite of what is true. **The plus is never dead** — a control
  that looks like a button and answers nothing reads as a broken app — and on
  an empty row it does not refuse either: it takes the caret, and the next
  press of that same button files what gets typed. The one press of it that
  says no is a name the list already holds, which blooms that name, since
  editing it is the fix — **one name, one person** (`core/names.ts`), said
  under the row in words as it is typed and pointed at by the refusal, on every
  list including the one you are picking yourself out of, where the name you
  typed is a row one tap above. **A screen's refusal blooms whatever has to
  change**, so Create over an unfiled name points at the plus that would file
  it and Create over a list too short to go on with reddens the placeholder,
  which is the only thing that ever does. **A keystroke ends any flash on the
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
  clear that the act the list ends on comes up with it, per the `--kb` Gotcha
  below. `pnpm claim` holds all of it ([testing.md](testing.md)).
- **"Which one are you?" is one screen, `components/who-picker.tsx`**, ending
  both ways into a group: joining, and creating one — including a group of one,
  (on `/g/claim` the bar says "Join {group}" and the question is the body's
  title — `.question`, centred and a size above the bar, because it is the
  first thing a new joiner reads; `/new` still asks it in the bar),
  because the answer is written into every op and a screen that sometimes skips
  the question is a screen you cannot learn. Picking is never a write — the
  button is, whether it claims an identity (ADR-0003) or creates the group with
  that name as its actor. The button answers to the tick and to nothing else; a
  name still being typed moves neither. Filing one *does*: the row it adds is
  ticked as it arrives, because a name typed into the list you are picking
  yourself out of is the pick. The tick is a check mark **and** `aria-pressed`:
  a shape is not a sentence, and without it the only thing naming the pick was
  the button at the foot of the screen. That button sits **under the list, and
  sticks** (`.whodock`): under the last name while the list fits, so it reads
  as the next step after the tap that lit it up, and stopped at the foot of the
  scroller once it doesn't — a group of twenty scrolls under it, and on
  `/g/claim` it stops above the "Have the app?" dock rather than over it.
- History wording is assembled once, in `lib/history-copy.ts` (`describe`),
  from `copy.history`. One revision usually moved several fields — an entry is
  saved whole — and then it returns no sentence about any one of them, but a
  labelled was/now line for each; it reads the fold either side of the revision,
  not just the fields that moved ([sync.md](sync.md#history-ui)). It must be
  **total** — it runs inside a render over every patch the log holds, so one
  throw is a white screen, not a missing line. People are listed **by name**,
  not in the order they are stored: an id is a hash of the name (ADR-0034), so
  sorting by it puts a was/now pair in two unrelated orders.
- **The history screen reads the deleted entries too.** Both its subject links
  and its title come from maps built over every entry the group has ever had —
  half the reason to open it is one that is gone. So a deleted entry's own
  history backs up to whoever linked to the entry (`historyParent`), never to
  the entry's "gone" screen. Its line is `components/revision.tsx`, shared with the ledger.
- **The ledger's new-changes line** (`components/new-edits.tsx`) sits under the
  you-owe card, drawn as a date line: "4 new changes", unfolding onto those revisions, capped
  at four with "More in history" under them. New is an op numbered past `groupKeys.seenSeq`
  whose stamp is another phone's, your own laptop included. Unfolding marks
  them seen and keeps them up; so does leaving the ledger by any route. The
  first pull sets the mark at the cursor, so a joined group opens with nothing
  new, and the mark is device-local, never an op.

## A live read can die

Dexie's `liveQuery` swallows two error names — `DatabaseClosedError` and
`AbortError` — rather than delivering them. It means to ignore a query it
superseded itself; it also ignores one the *browser* killed, and those arrive
by the same door. An installed Android app is frozen when backgrounded and its
in-flight IndexedDB transactions are aborted; Chrome force-closes the
connection under storage pressure. Either way nothing is emitted — no value, no
error — and the subscription is then **dead**: the querier is never run again,
not even by a write to the table it reads. A screen reads "no value yet" as
"still loading", so the app sits on its skeleton rows until relaunched.

`lib/db/live.ts` is why **every live read goes through `useLive`**. A dead
subscription cannot be revived, so three things make a new one: the connection
closing (`db.on('close')`), the app returning to the foreground, and a read
that has returned nothing for 6s — twice, and then the notice in `Screen` says
so and offers the retry. `db.on('blocked')` feeds the same notice a different
sentence: an upgrade held open by another copy of the app never resolves on its
own, because `indexedDB.open` has no timeout and Dexie's handler only logs.

**A read can also be alive and queued.** An IndexedDB lock belongs to the
origin, not to the page: a readwrite transaction that another copy of the app
(a forgotten tab, a window left behind by an update) was frozen half way
through holds it, and every read of those stores waits, in every copy.

**The lock is per store, and that is the whole diagnosis.** Which reads hang
names the transaction holding it, because no two writes here take the same
scope: `device` alone is `updateDevice`, `ops`+`groupKeys`+`device` is the sync
commit, every entity table is `rebuild`, and all of it at once is `appendOps`.
A groups list on skeleton rows while the op log counts fine is an
`updateDevice` lock: every list and group screen reads `device`. `/diag`'s
`stores:` line names which stores are waiting.

No page can break another's lock, so three things limit it. **A hidden copy
touches the database at all** — neither half, because either one frozen
mid-transaction strands a lock the whole origin then queues behind.

*Writes* wait for the front: `whenVisible` in `lib/db/visible.ts`. What must *not* wait is a
write holding something that exists nowhere else: `saveGroupKey` stores an
invite's secret, and a tab killed while parked would lose the group.

*Reads* answer from memory: the gate in `useLive`'s querier. This half is the
one nothing in the app asks for, because **Dexie asks for it**. Every write
broadcasts itself to every other copy on the origin
(`BroadcastChannel('x-storagemutated-1')` → `propagateLocally` →
`signalSubscribersNow`) and each re-runs the queriers that read the tables that
moved — so the copy in front of you makes a *backgrounded* copy open a readonly
transaction across half the schema every time you save. On Android that is not
a race but a certainty: a tab and the installed app cannot both be in the
foreground, so one is always freezable and the other pokes it on every write,
and the next `appendOps` queues behind readonly locks nobody will ever release.
A hidden querier therefore returns its `remembered` answer and opens nothing;
Dexie sees a querier that observed no table, stops signalling it, and coming
back to the front bumps `epoch` and starts every read again for real. The
watchdog is held shut with it — a background page has nobody waiting on it, and
its last probe would `reopen()` the connection.

`useLive` remembers each read's last answer by
name and deps for the life of the page, so a screen opened during the wait
shows that instead of skeleton rows — while still counting as waiting, so the
notice stands. And the last probe, and the notice's button, open a fresh
connection (`db.reopen`), the one lever a page has on a stuck backend of its
own. `/diag`'s `copies:` line names every copy the service worker can see, and
whether it is hidden.

`ReadErrorBoundary` (app/layout.tsx) catches the rest. `dexie-react-hooks`
reports a failed read by throwing during render; without a boundary every error
`liveQuery` does *not* swallow is a white screen.

**A querier must never resolve `undefined`.** That is the one value `useLive`
cannot read, because it is how `useLiveQuery` says "no answer yet": a read that
legitimately has nothing to report has to say `null` — a group with no key row
(the demo, permanently) would otherwise be a read that never answers.
`pnpm demo` waits out the watchdog to hold that one.

`pnpm stall` drives both halves in a browser; `lib/db/live.test.ts` pins the
Dexie behaviour itself, so an upgrade that fixes it tells us.

## Bringing a group onto the phone

**Import a group**, in the groups list's kebab above About, is the other
direction: somebody else's ledger read into a new group. The kebab is the whole
of the entry point.

**Two sources, one readout.** A CSV in the shape
[data-model.md](data-model.md#the-group-as-a-spreadsheet) describes, chosen as
a file — or **a Tricount link**, fetched. Both land in the same `ImportPlan`,
and past that moment the screen cannot tell which it was. There is no box to
paste CSV text into.

**Three steps, and the source is read on the first.** Pick or fetch, look at
what was found, say which of those people you are. Reading writes
nothing — `core/import.ts` and `core/tricount.ts` both hand back a plan — so
the people, the currency, the counts and the rows that will be left out are all
on screen before an op exists. Once a plan is up it is the screen, and the two ways in
collapse to one button back to them, with what was typed still in place.

**Fetching a link says what it costs, under the button.** *Sent through bida's
server, unencrypted. Not stored.* — centred under the button, and one of the
two things in the app that leave the phone readable, because the browser cannot
call bunq itself. `/about` names both in its privacy section, this one in
`about.privacy.import`; it is the same admission it makes about a receipt
photo, in the same place a person can still change their mind
(`apps/api/src/index.ts`).

Five pieces, each in the layer that owns it:

| | |
| --- | --- |
| `core/import.ts` | Rows to a plan, and every refusal. Pure, and takes `dayToTimestamp` the way `export.ts` takes `formatDay`. `checkStated` is the plan-against-stated-balances check, shared with the reader below |
| `core/tricount.ts` | A tricount's JSON to the same plan ([data-model.md](data-model.md#reading-a-tricount-back)). Pure for the same reason, and it fetches nothing |
| `lib/import/csv.ts` | The bytes: an RFC 4180 state machine, the size guard, and the group name off the filename. A dialect is a parsing decision about somebody else's file, not domain arithmetic, so it is not in core — and it is not a dependency, since a library that auto-detects the delimiter is working against a reader whose whole rule is to refuse rather than guess. `parseCsv` is one swappable function if that changes |
| `lib/import/tricount.ts` | The link: the key out of whatever was pasted, a throwaway RSA public key the handshake wants, and one POST to `/api/tricount`. The private half is dropped where it is made, since nothing in that protocol signs anything |
| `lib/db/commands/import.ts` | The plan as **one `appendOps` batch** under one actor: a hundred rows are not a hundred things somebody did a millisecond apart, and one batch is also the only atomic shape |

**A refusal is whole-source, and says what to fix.** Every code in
`ImportRefusalCode` has a sentence in `copy.importData.refused`, interpolating
the `line` (1-based, as a spreadsheet counts, blank lines included) and the one
fact that code carries; the tricount codes name the entry instead, which is
what a person sees when they open it. The refusals are the most-read words the
feature has, which is why they are in `copy.ts` and the `ImportError` messages
are terse developer strings ([ADR-0033](decisions/0033-every-word-in-one-file.md)).
Three sentences beside them are not refusals of a ledger at all and say so:
that was not a Tricount link, this phone is offline, and **Tricount is not
answering** — the last one saying plainly that bida reads tricounts the way
Tricount's own app does and that this can stop working without warning.

The group's **name** is asked either way, prefilled and editable: a tricount
states its title, and a file can only be guessed at from its filename, since
both exporters name the file after the group and a mail client may have renamed
it since.

## Deleting a group

`/delete-my-data` is the app's answer to "take my data off your server", and the
only screen that destroys anything. It takes an **invite link**, not a group id
or a row on the list: holding the link is the whole of authority
([ADR-0003](decisions/0003-link-only-access.md)), so it is also the authority to
end the group, and asking for it means the screen works from a phone that was
never in that group.

The link is used to pull the whole log and open it, so what stands on screen
before the button is the real group, named, counted and dated
(`lib/db/erase.ts`). Then four deliberate frictions: typing the address to get
here, finding the link, typing the group's name, and a dialog that names the
group again. What is deleted is the server's copy, for everybody, plus this
phone's.

**The other phones learn from the 410.** Their next sync erases the group there
too and drops it off their list, wherever the app happened to be standing; the
group screen and `/join` say it was deleted, and `/g/claim` sends them back to
the list ([sync.md](sync.md#deleting-a-group)).

**Not linked from anywhere.** A screen whose job is deleting other people's
data has no business one tap from a ledger, so `/about` writes the address out
unlinked (`AboutDelete`, naming the host the app was opened from, since the dev
Worker holds its own groups), and the screen itself names the gentler thing
most people are actually after — Export data — before it asks for a link.

## Getting a group off the phone

**Export data**, above Forget group in the group menu, hands over one CSV in
Splitwise's export shape — the only format anything else imports, Tricount
included, whose import *is* "import from Splitwise". The file is
`core/export.ts`; `lib/export.ts` is the part with a platform in it.

There is no format question and no JSON: a data dump is what `/diag` is for,
and `application/json` is not a file type the share sheet carries.

**Three rungs, and only *unavailability* descends** (`handoffPlan`, taking its
facts as arguments so the table can be stated and tested):

| | | When |
|---|---|---|
| 1 | `navigator.share` with a file | Wherever `canShare` takes one. The only way out of an iOS home-screen app, and the nicest anywhere: the sheet holds Save to Files, Mail and every messaging app, and it comes back to bida |
| 2 | `<a download>` | Everywhere except an iOS home-screen app — there a download is not unsupported but *hostile*, replacing the app with a full-screen "Open in …" that has no way back ([ios.md](ios.md#the-problem)). An iOS tab is fine |
| 3 | `/g/export` | Neither of the above exists |

A cancelled share sheet is **not** a failed one: it throws `AbortError`, means
"no thanks", and answering it with a fallback screen is the app insisting.
Only a share that never opened descends, because it leaves the phone exactly
where an absent sheet would have.

**Nothing says "Saved."** No rung can know: the share sheet doesn't report
which destination was picked and a download has no completion event. A
confirmation would be a guess on every platform, so the only outcome with
anything to add is the one that has a screen.

This narrows the "copying, not `navigator.share`" rule in `useInviteLink` —
that was about a *link*, where the clipboard is the destination and the sheet
is a detour. A file has no clipboard.

## The clipboard

Four screens hand a string over — the invite link, a quick split, the CSV,
the `/diag` report — and every one of them was written for a clipboard that
**refuses**: `writeText` rejects on an insecure context or a denied
permission, and the answer is to put the text on screen to be read instead
(`InviteFallback`, and the same shape on the other three).

A browser can also have **no clipboard at all** (in-app browsers such as
Messenger's). `navigator.clipboard` is then `undefined`, so
`navigator.clipboard.writeText(…)` throws before there is a promise to reject,
and a rejection handler does not catch it. The way out of an in-app browser
(`components/embedded.tsx`) copies the link on arrival and renders *outside*
`ReadErrorBoundary`, so there it is Next's "Application error".

So writing goes through **one door**, `lib/clipboard.ts`, where a missing
clipboard is the same *no* as a refused one — the shape every caller already
had. `hasClipboard()` is for the control that should say something else
without one: `CopyLink` drops the button and says *Hold to copy* over the
selectable link, rather than answering a press with nothing. Reading has its
own door for its own reasons (`lib/paste.ts`, whose calls are all already
inside the `try` that awaits them). `rules-check` holds the pair, because it
costs a line to lose and is invisible until it is somebody else's phone.

## The flight recorder, and `/diag`

`lib/diag.ts` records what the app spends its time on, always, into a bounded
array — a debug flag records nothing on the launch that goes wrong, which is
the only launch worth recording. Timed spans around the four things that can
make a screen wait: `db.open`, each live read by name, `rebuild`, and
`sync.pushpull` (plus `heal`), and each write — `sync.commit`, `append`,
`device.write` — since a write queued behind a lock is what every read then
queues behind; `sw.controllerchange` marks an update. One clock for all of them, because the question
is never "was this slow" but "what was it waiting for", and that is always an
overlap.

Two properties do the work, and `lib/diag.test.ts` holds both. A span that has
**not finished** still prints, marked `STILL RUNNING` — a read hanging right
now is why the screen is open. And the timeline is ordered by when things
**started**, not when they ended, so a long `rebuild` sits above the read it
was blocking rather than below it.

**The report reads newest first — the head, then this page, then the pages
before it, then the home-screen hand-off.** It is pasted from a phone into a
chat box that will not take all of it, so what just went wrong has to be in the
part that survives being cut short; the same reason the `menus and dialogs` block is in
the head. Only the *printing* is turned round. `timeline()` still orders by
when things started, so the overlap above is intact and the timestamps say
which span contains which.

**Back presses and dialogs are in it**, because neither can be watched with a
cable: a thumb on a system button in an installed app, and what decides the
outcome — whether the browser made the press cancelable, whether the document
still had an interaction to spend — is gone by the time anyone opens this
screen. One `back.press` line per traversal names what was done with it
(`ours`, `ASKED`, `let through`, `swap`) beside the event's own `cancelable`
and `active`; `dialog.open` and `dialog.gone` bracket each dialog, and
`dialog.gone` says whether it was `dismissed` or `SHUT BY THE PLATFORM`
(see [Gotchas](#gotchas)). What a thumb did to the card between those two is
the `menus and dialogs` block below.

Its Copy button sticks to the top of the scroll rather than sitting in a
`Foot`: `env(safe-area-inset-bottom)` reads 0 on Android often enough that a
foot button sits half under the system navigation bar.

The report opens with `version:` (`lib/version.ts`), because every other line in
it describes a phone and none of them say which build that phone was running
([hosting.md](hosting.md#versions)).

A `screen:` line sits above the timeline: the layout viewport, the visible one,
the height the shell actually took, and what the browser admits the system bars
cover. They are one number on a phone that is behaving, and when they are not,
the difference is the strip at the foot of every screen that gets reported as
"the tabs are gone" (see [Gotchas](#gotchas)).

A **`menus and dialogs`** block sits in the head, not down in the timeline
where its lines are written: one per overlay that has closed, from every page
kept, holding every press, lift, cancel and click the phone sent while it was
open, where each landed, what the hold's guard did with it, every step the
keyboard took under it, and which way it went out (`lib/press-trace.ts`). It is
in the head so it survives a paste being cut short.

It exists because "the menu answered on the second press" and "it refused a
bunch of taps" reproduce only on a phone, and every explanation for one is a
different line in that sequence: a click that never came, one swallowed, one
landing on the veil or the scrim, a `pointercancel` where a lift should be, a
card that grew or moved under the finger, or one that closed with no press
behind it.

**A dialog's parts are named apart from each other**, because that is the whole
question a refused tap asks: `pointerdown@btn1` lifting on `card` is the card
having moved out from under the finger, and Chrome sends no `click` when the
press and the lift have no target in common. `row` rather than `card` is a
press that reached the button's row and not the button — a disabled one takes
no pointer events at all — and `kb 404->0` is what moved things
(`--kb`, components/viewport.tsx). Back presses are noted inline as well as in
the timeline, so a thumb alternating between the system button and the card
reads in one line.

Each press also carries **where the card was against what was on screen** —
`card 320-520 visible 0-437 of 841` — which is the one thing no event says. A
modal `<dialog>` is laid out in the layout viewport and the strip a keyboard
covers is paid out of it as padding, so a card drawn while that payment is
wrong is centred over the keys and a tap aimed at its buttons never reaches the
page at all. It is written once and then only when it changes, because the same
numbers under every tap of a run are what would hide the one tap they were
different for.

**Both ends of a long sequence are kept, and the middle is counted**
(`…27 more…`): the taps that matter are the first that went wrong and the last,
which worked.

A `home screen` block follows, for the iOS hand-off ([ios.md](ios.md#a-in-detail)),
whose every step is off the screen by the time anyone looks. An inline script
in the layout writes each load's URL to localStorage before Next runs, and keeps
the storage's first load apart forever — on iOS the icon's storage is its own,
so that line is the URL the icon opened, and each load says which manifest its
head got. `/install` and `keepCarried` add `note`s beside them. Secrets are masked (`hideSecrets`); ids are not.

Read it at **`/diag`** — long-press the app's name on the groups list. It is
linked from nowhere; a diagnostics screen earns no room in a menu a person
reads. The last five pages' timelines are kept in `localStorage`, each under
its address (not a table — this has to work on the launch where IndexedDB is
the broken thing), because the launch that hung is the launch you killed the
app to escape, and a paste's `/join` is a page of its own beside the list.

It also carries the app's one hidden setting, **Staś mode** — the switch that
makes a scan insult whoever sent it a photo that isn't a receipt
([receipt-scanning.md](receipt-scanning.md#staś-mode)). It is here rather than
on a settings screen because finding it should cost a long-press, and because
the report prints its state beside everything else this phone is doing.

**`/diag` must never wait on the database.** It is opened *because* the
database is not answering. Everything that can block is raced against a 2s
patience window and the timeline, which needs no database at all, prints either
way; `pnpm stall` fails if it waits. **The window is one window for the whole
report: start every blocking question before awaiting any of them**, or each
line waits out its own two seconds after the one above. A new line in
`collect()` goes up with the others.

## Every word, in `lib/copy.ts`

Screens import `copy` and hold no literal a person can read — `aria-label`,
`placeholder` and `title` included; `pnpm run rules` fails a build that types
one back in ([ADR-0033](decisions/0033-every-word-in-one-file.md)). Say it once
and say it short: the screen already shows the amount, the name and the button,
so the sentence beside them carries only what they can't. No em dashes in copy,
ever (the owner: they read as machine-written); `copy.none`'s lone dash, a
blank figure, is the one exception, and `rules` enforces both halves.

A string whose wording depends on which way the entry runs is `Voiced<T>` —
`{ expense, income }`, keyed by the entry's kind. Money going out is *paid* and
money coming in is *received*, and a screen that switches only its title
describes the entry the person is not looking at. Every sentence on
`/g/payers` is voiced, as are the history's payer lines.

## One navigation

At most one nav bar, at the bottom: **Ledger · Balances** inside a group, and
none outside one. The groups list carries its starts below the list instead
of in it: **New group** and **Quick split** as two centred `.starttile`
squares — with **Paste link** a third on an iOS home-screen app, which iOS
never hands a tapped invite (it opens in Safari, whose storage is not the
app's), so the link has to come in by clipboard; only a `/join` URL from this
origin joins, and one from another deployment says which server it belongs to
rather than "Bad link", one with no password, from anywhere, opens that
group's screen, and an empty read opens a box to paste into
by hand — at once, since on iOS asking the clipboard again is another Paste
bubble to tap rather than a free retry ([ios.md](ios.md#gotchas)). The box is the same routing on what lands in it
(`readPastedLink`, `usePasteLink`, `lib/paste.ts`) — (`.homepair`, which takes the `margin-top: auto` in a full-height
`.homescroll` to settle at the foot of a short list, and `position: sticky;
bottom: 0` to stay there — floating ungrounded over the rows, as the FABs do —
once a long one would otherwise scroll it out of reach), with nothing under them — the
light/dark switch and **About bida** are the two items in the top bar's kebab
(`HomeMenu`), the same card the group screen's opens. `Tabs` was deleted
from `components/`; don't bring it back. A screen needing more destinations puts
them behind a top-bar icon, not a second row — three icons is the ceiling.

## A screen comes back where you left it

The app scrolls inside a div — one `.scroll` per screen — so the browser's own
restoration, which knows only about the document, restores nothing.
`lib/scroll-memory.ts` keeps one offset per route in memory (the query
included: `?id=` is which group, `?tab=` is which list), and `Scroll` puts it
back on the way in. It aims at the furthest point the content has reached and
stays unfinished until the real one exists, because the rows arrive from Dexie
after the frame draws; it records nothing until that lands, the finger takes
over, or a second and a bit passes, since every position on the way there is
shorter than the target and saving one would walk the list towards the top.

## Your own money, pulled out of the group's

Always on, not a setting ([ADR-0007](decisions/0007-a-screen-is-a-route.md)),
and it changes rendering only — never data or what syncs. Every row carries a
signed, coloured effect: what you put in for that entry minus what you owe for
it (`myEffect` in `lib/entry-kind.ts`, one subtraction for all three kinds).
The column adds up to the net printed above the list, on one line — words
left, figure right, the figure sized to its own length in CSS alone (`.mysum`
in `globals.css`), so a seven-digit sum shrinks rather than wraps. Rows involving neither
your money nor your share drop to `opacity: .58`; the rest are plain rows, with
no wash or coloured edge. What it looks like and why:
[design-system.md](design-system.md#your-own-rows-are-highlighted).

## PWA

`public/manifest.webmanifest` is linked by a script at the top of `app/layout.tsx`'s head, not by metadata — an iOS tab gets a different one there ([ios.md](ios.md#a-in-detail)): maskable icons,
`display: standalone`, and one ink `theme_color`/`background_color` — the
status bar and the splash screen, which is why they are ink rather than paper
and why `viewport.themeColor` repeats the same value rather than tracking the
theme (Gotcha below). The
three PNGs are rasterised from `design/brand/logo.svg` by `pnpm icons`, which
also copies that file to `public/logo.svg` for the top-bar mark to point at —
run it when the logo changes rather than editing any of the four; the maskable
one insets the artwork to 72% on its own ground so a circular launcher crop
can't clip it. iOS ignores
manifest `display` entirely; `appleWebApp.statusBarStyle` is its lever, and it
is `"default"` so the page starts below the status bar (Gotcha below). The strip
that leaves above the page is painted from **body's background**, so at phone
width body wears the shell's own `--card` (the dev build, its green bar): iOS 26
lays a scrim under the status bar, and a seam there is an edge for it to reveal
(Gotcha below).
`viewport-fit: cover` stays for the home indicator and a landscape notch, which
is why the `env(safe-area-inset-*)` padding matters.

Installing is also what makes the browser grant `navigator.storage.persist()`
(`lib/persist.ts`, called from `saveGroupKey` and on every start once the phone
holds a group, because the answer changes once the app looks established).
Without it IndexedDB is evictable ([architecture.md](architecture.md#gotchas)),
so the app asks to be installed too. `lib/install.ts` captures
`beforeinstallprompt` at module load — it fires once, early, and only that
object can open the install sheet later — and reduces the situation to
`installed | ready | manual | none`; iOS has no such event, hence `manual`.
`components/install.tsx` puts the nudge at the foot of the groups list, only
once there is a group worth coming back to. **It folds, it does not dismiss** —
persisting storage is worth the standing ask, and installing is what ends it:
the offer becomes `installed` and the nudge disappears on its own. The title is
its disclosure, and `installNudgeCollapsed` on the device record remembers the
fold. On the `manual` branch (an iOS tab) the nudge gives way to `InstallBanner` at
the top of the list — and, folded on every visit, atop each group's ledger — the list's remembered on the same flag, both linking to `/install`: the
seven days are WebKit's, every iOS browser is one, and a warning that true
belongs first ([ios.md](ios.md)).

**A link to this app is nearly always sent in a chat**, so `metadata` in the
layout also carries Open Graph and Twitter tags for the card a chat app draws. They are
static and say nothing about the group, which they could not anyway: the secret
is in the fragment and never leaves the phone. `metadataBase` is pinned to
`https://bida.bid` because a crawler has no page to resolve a relative URL
against and the build is byte-identical on both Workers
([hosting.md](hosting.md#dev-and-production)). **There must be no `og:url`** —
as a root-level default every route claims to be the site root, and Messenger
on iOS then delivers an invite as the bare origin, path and fragment gone.
Left out, a scraper uses the URL it fetched.

`public/sw.js` precaches the whole export — routes, hashed `/_next/static/`
chunks, *and* the `.txt` RSC payloads Next fetches on every in-app tap —
registered from `components/register-sw.tsx`. **It does not cache `/api/*`** —
Dexie is the offline data layer, and a second cache over the same data gives
you two disagreeing sources of truth.

**A payload URL asked for as a *page* is redirected to the page.** When the
router's fetch of `/g/claim.txt?id=…` fails, Next hands that URL to the browser
as a plain navigation — and served literally it is a screenful of
`1:"$Sreact.fragment"` where a screen should be. `sw.js` redirects those back to
the route, carrying the `?id=` and dropping `_rsc`. A redirect, not the route's
shell served in place: the app runs at the address it was asked for, and
`/g.txt` is not a route — back arrows are paths (`lib/nav.ts`), and so is
`reloadCostsNothing`. So does the Worker (`apps/api/src/payload.ts`), because a
service worker only sees a page it controls and this one does not claim a first
visit: the iPhone that has just tapped an invite is on its first load, has no
worker yet, and is on its way to `/g/claim`
([ios.md](ios.md), [hosting.md](hosting.md#deploying)). The two hold one rule —
nothing else in the export ends in `.txt` — so a real `.txt` asset would need a
carve-out in both.

Everything precached is served cache-first, so a launch and every tap after it
paint without waiting on the network. The list and the cache name are stamped in
after the build by `apps/web/scripts/precache.mjs` — nothing to drift, no
`CACHE_VERSION` to bump — and the three things that make cache-first safe are
[ADR-0004](decisions/0004-static-export-and-offline.md). Run `node
scripts/offline-check.mjs` after touching either file: it walks every screen
with the network cut, then installs a deploy over a half-dead network, and a good one
across three open pages.

**A new build is taken as soon as it is safe, by itself.** `sw.js` calls
`skipWaiting` the moment the whole build is precached, rather than waiting for
the last client of the origin to close — on iOS Safari tabs and the browser
outlive what a person thinks of as quitting. `activate` writes down **which build each open
window is running** (in memory and in the `bida-legacy` cache, since the browser
stops idle workers) and keeps every cache still spoken for: those pages go on
being served their own build, so their next tap can't mix an old router with a
new payload. A cache nothing is on is deleted, so the cost is one kept shell per
window somebody left open, and a window that closes takes its cache with it.
Keeping only the newest other cache is not enough: two deploys later a page
further back is served a stranger's `/g.txt`.

Every window open when `activate` runs is written down, because none of them can
be on this build — which build they *are* on is the guess, and `null` is the
honest answer when nothing can answer for one: a cache evicted under it, or a
first build with nothing before it. Such a window is then **refused a payload**
rather than handed this build's. Next answers a build id that is not its own by
navigating to the *response's* URL, and a response out of a cache carries its
cache key, which for a payload is a bare path — one file answers every `?id=` —
so the group id is lost on the way. Refused, the router falls back to the URL
*it* asked for, and the redirect above turns that back into the route; the cost
is that the window's next tap is a full load rather than a routed one (Gotcha
below).

**The app reloads itself on the groups list and nowhere else.** `lib/update.ts`
hears `controllerchange` and waits for the front door — at once if the page is
there already and nobody has touched it, otherwise the first time the app is
resumed onto it, never while hidden. A reload in the installed app is a
relaunch, splash and all, and one on a ledger reads as a crash; on the two forms
it would throw away a draft that lives only in memory (`lib/draft.ts`). `reloadCostsNothing` is the one list of screens that hold
nothing only this page has, and the iOS carry reload — which cannot wait for a
list a newcomer never passes — is its other caller ([ios.md](ios.md#a-in-detail)).
`lib/update.ts` also re-checks `sw.js` on every resume (an installed app is
resumed far more often than it is launched) and records when
`navigator.serviceWorker.ready` resolves (`shellIsWarm`) — the only flag that
says the precache is done, since a worker that never claims a first visit leaves
`controller` null for the whole of that page's life. In between,
`components/update.tsx` offers a Reload at the foot of the groups list, **only in
the installed app** — a tab has the browser's own, and the install nudge shows on
exactly the phones this doesn't. `offline-check` holds three pages open across a
deploy: untouched, in use, and on a group.

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
debit left, credit right), drawn inline on `/g`'s Balances tab. Everything else
is ordinary markup; what more than one screen draws lives in
`components/chrome.tsx` (the frame, plus `Blank` for a screen still waiting on
Dexie, `Foot` for its one pinned act, `Banner`, `Failure`) and
`components/bits.tsx` (`Avatar` — a *group's* initials — `Card`, `KV`,
`GhostRow`).

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
so the static export ships the full line and the browser narrows it.

## Gotchas

- **A cached response's URL is its cache key, not the one that was asked for.**
  Next reads `res.url` off every payload whose build id isn't its own and
  navigates there, so a payload served from the precache — keyed by path —
  sends a phone to a `/g` screen with no group on it. Whatever must
  survive such a hand-off has to ride on the request, not the response.
- **Never `black-translucent` on iOS 26.** The home-screen app is drawn from
  the top of the screen but laid out a status bar shorter (WebKit bug 301108):
  a strip at the bottom no CSS or JS reaches, and a system blur over the top
  bar. `"default"` puts the page below the bar and avoids both.
- **iOS 26 dims the top of the page under the status bar, and nothing turns it
  off.** A scrim for the clock's sake, drawn over the first strip of content
  whatever `statusBarStyle` says — `black-translucent` only gives it more to
  cover. What *is* ours is what it falls on: the strip above the page is body's
  background, so where that differs from the bar under it the scrim has an edge
  to reveal and reads as a band rather than a vignette. Matching the two at
  phone width is the whole fix (`.app`, globals.css).
- **Two navigations asked for in one tick are folded into the last one.** A
  screen that wants to both give its history entry away and push another on top
  cannot: `router.replace` then `router.push` leaves only the push, whatever it
  is deferred by. It takes two screens, one commit each — which is why `/join`
  replaces itself with the list and the list does the pushing.
- **iOS never sends `contextmenu` for a touch hold**, in any browser — only
  Android and a right click do. `useHold` (`components/long-press.tsx`) times
  the hold from pointer events and answers whichever comes first; the finger's
  later `contextmenu` and lifting click are swallowed on `document`, because
  they land on the menu's veil, which closes on either. A right click proves
  nothing about it; `pnpm entries` holds with touch.
- **A finger that opened a menu and then moves is not scrolling**, and the
  browser has already decided it is: pans are allowed everywhere
  (`touch-action: pan-x pan-y` on `html, body`), so sliding off the held row
  hands the touch to the scroller, which fires `pointercancel` and **dispatches
  no click at all** — yet that slide is the thumb reaching for the card the
  hold just opened. `heldFinger` refuses the scroll
  (`touchmove`, non-passive, for as long as the finger is down), washes the
  item under it, and clicks that item on the lift. It must have travelled
  `SLOP_PX` first, because the card is only a few px clear of the row and a
  resting finger's drift is not a choice.
- **A tap can arrive on iOS with no click in it.** The whole press lands on
  the element — `pointerdown`, `pointerup`, `touchstart`, `touchend`, no
  `pointercancel`, nothing swallowed — and WebKit simply dispatches no `click`.
  The same tap a second later is answered normally, so it reads as a control
  that works every other time rather than one that is broken. It is not the
  callout, the selection handles or the double-tap wait: `user-select`,
  `-webkit-touch-callout` and `touch-action` have all three off already
  (`globals.css`). **So a touch gesture that must not be missed cannot be built
  on `click`** — but nor can it simply be moved off it. A row menu's items wait
  `CLICK_GRACE_MS` for the click and answer the `pointerup` only if none comes
  (`components/row-menu.tsx`), asking `elementFromPoint` where that lift
  actually landed, since a touch's `pointerup` goes to whatever its
  `pointerdown` went to however far the finger has moved. `clickGuard`
  (`lib/click-guard.ts`) eats a click that turns up after that, because by then
  the card is gone and it would land on the row underneath. `pnpm entries`
  sends the clickless tap by hand; a real one in Chromium always brings its
  click.
- **`click` is the *last* event of a touch, and acting earlier leaves the rest
  of it to land on what you drew.** Answer a `pointerup` outright and Android
  still delivers `touchend`, `mousedown` and `mouseup` onto the changed screen.
  `Dialog` light-dismisses on `mousedown` (a drag off the card is not a tap
  outside it), so a stray one lands on a just-opened confirm dialog's scrim
  and closes it — Delete and Forget then do nothing, depending on the row's
  position. iOS is immune: the tap that brings no click brings no compatibility
  mouse events either. `clickGuard` guards `click` and `contextmenu` and
  nothing else; the `/diag` trace stops when the card unmounts, so it cannot
  see this. `pnpm entries` asks where that `mousedown` landed, not whether the
  dialog survived — mid-screen it lands on the card and survives regardless.
- **A read that never answers is indistinguishable from a slow one.** Both are
  `undefined`, and nothing in Dexie times out — not `indexedDB.open`, and not a
  `liveQuery` whose error was swallowed. Every screen that draws a skeleton
  needs something that eventually stops believing it
  ([A live read can die](#a-live-read-can-die)).
- **The theme is a hydration mismatch on purpose.** `<ThemeScript />` sets
  `data-theme` on `<html>` before paint, but the export is prerendered light,
  so React finds an attribute it did not write and says so. `<html>` carries
  `suppressHydrationWarning` for exactly that; removing it brings the console
  error back, and "fixing" the mismatch instead means a flash of paper white
  on every dark-mode launch.
- `output: 'export'` disallows route handlers, `next/image` optimisation, ISR,
  middleware and dynamic params. Needing one is a change to ADR-0004.
- **A waiting service worker waits on the whole origin, not on your app.** One
  forgotten tab on the same domain pins the old build for as long as it lives,
  and on iOS Safari even killing the browser rarely clears it — while an
  incognito window shows the new build and makes it look like a deploy problem.
  That is why the worker does not wait (see [PWA](#pwa)).
- **`caches.match` searches every cache in the origin, not yours.** And there
  is always another one to find: `controllerchange` fires *before* the new
  worker's `activate` handler runs, so a page reloading onto the new build is
  answered while the previous build's cache is still there. Unscoped, the new
  worker can serve that reload an old shell or an old `/g.txt` naming chunks
  this build doesn't have — a screen with pieces missing until relaunch, since
  the router keeps the payload it was handed. Every read goes through `lookup()`, which opens `CACHE_NAME` — or,
  for a page still running the previous build, that build's cache; `offline-check` plants a cache the precache never heard of and fails
  on anything but a 404.
- **A page left on the old build breaks on its next tap.** It fetches the new
  build's `/g.txt`, Next refuses a payload from a build it didn't boot with and
  navigates to the bare route, dropping the query string — where the group id
  lives. The screen lands on "No group" with no bottom nav. So `sw.js` serves
  such a page its own build's cache until it reloads (`previousFor`), and
  `offline-check` taps through a group on one across a deploy.
- **An installed Android app's status bar is the manifest's `theme_color`, and
  nothing can change it after install.** It is compiled into the app when the
  browser builds it, so it cannot be media-scoped and no meta tag reaches it —
  but `<meta name="theme-color">` *is* still read, for one thing: whether the
  icons drawn on that bar are light or dark. Adaptive theme-color tags
  therefore flip the icons over a bar that cannot follow, and dark mode ends as
  white icons on a paper bar. Hence one colour in both places, ink. To tell
  which layer paints what, give each colour a value nothing else uses,
  reinstall, and read the screen — splash is `background_color`, status bar is
  `theme_color`.
- **A press tint is only as tall as the element it is on.** Padding that spaces a row of tappables belongs on the tappables, not on the bar around them: held by the parent, the touch feedback is a short band floating inside a taller bar, which reads as a tap that half landed.
- **Anything floating above the dock rises with `--nav-foot`**, never a fixed `bottom`. The dock's foot is the home-indicator inset (34px installed on an iPhone, 0 in a browser or headless check), so a fixed offset that looks right in every check sits on the tabs of the iOS PWA.
- `100dvh`, not `100vh`, or iOS Safari's toolbar eats the bottom nav.
- **The shell takes `height`, not `min-height`.** With `min-height: 100dvh` the
  shell grows past the viewport, the *document* scrolls instead of `.scroll`,
  and the bottom bar sits at the foot of a long page — invisible until you
  scroll. `.app` is `height: 100dvh; max-height: 100%; overflow: hidden`,
  `html, body` too, and every scrolling child of a flex column needs
  `min-height: 0`.
- **A shell taller than the box that clips it loses its last strip, silently.**
  `body` is what clips `.app` (`height: 100%`, `overflow: hidden`), so the two
  have to agree about how tall the screen is — and they are two different
  measurements, `dvh` and a percentage of the initial containing block. A `dvh`
  reported larger than the ICB puts the bottom of the shell below the fold,
  where nothing scrolls: the bottom nav on a group, the about line under the
  groups list. Seen on an installed phone after Reload onto a new build; no
  browser check reproduces it. **How to recognise it:** everything else is right, the FAB is exactly
  where it belongs, and the groups list's start pair has slid *lower* than
  usual — a `position: fixed` FAB is placed against the ICB, so a FAB that has
  not moved while `margin-top: auto` pushes the pair down says the ICB is the
  honest one and `dvh` is not. Hence `max-height: 100%` on `.app`, and `100%`
  rather than `100dvh` wherever else a box is sized to the screen (`.dialog`);
  it costs a browser that agrees nothing at all. The same symptom from the
  other direction — a layout viewport bigger than the screen it is painted on,
  which no CSS can see — is measured instead: `viewport.gap` in the `/diag`
  timeline is how much of the layout viewport is off screen with nobody
  typing.
- **`dvh` does not shrink for the keyboard.** On iOS the keyboard and its
  accessory bar are drawn *over* the layout viewport, so the shell keeps its
  full height and `.scroll` ends behind them — a field scrolled to that edge,
  by us or by the browser on focus, sits under the strip's buttons. The visual
  viewport is what's left: `components/viewport.tsx` writes the covered
  strip to `--kb`, and `.scroll` spends `--kb` plus air as both padding and
  `scroll-padding-bottom`. Padding is what a last row can scroll into;
  scroll-padding is where a field mid-form stops. A dialog sits outside the
  shell and pays the same toll: the scrim spends `--kb` as bottom padding, so a
  card is centred in what is left rather than behind the keys. `.foot` pays it
  too, for the screens that pin an act. **An act that scrolls has to be scrolled to**: the four
  screens that ask for people put Create, "Continue as …", the scan pair or
  "Change who you are" under the add row, so the field asks for that much room
  beneath itself (`--act-below`) and `bringIntoView` spends it. It has to be
  spent in script, because `scrollIntoView`'s `nearest` reads "already in view"
  off the field's own box — a field the browser has just parked above the keys
  is finished as far as it is concerned, `scroll-margin-bottom` and all, and the
  button under it stays behind them. Only ever upward: a keyboard closing must
  not drag the list down to re-hang the field at the bottom of the screen.
  `pnpm keyboard` holds all four ([testing.md](testing.md)). **A gap with nobody typing is not a keyboard** and is
  never paid as one (`lib/viewport.ts`): the difference between the two
  viewports is a keyboard only while something has the caret; otherwise a
  browser that reports the two differently gets permanent padding at the foot
  of every list.
- **A press that closes the keyboard is a press that never lands.** A button
  tapped while a field has the caret blurs it on `mousedown`; the keyboard
  retracts, the visual viewport grows, the page reflows — and the `click` misses,
  because the button has moved out from under a thumb that hasn't lifted. It
  reads as a button needing two taps. `keepsFocus`
  (`components/bits.tsx`) is the whole fix: `preventDefault` on `mousedown`, so
  the field keeps focus and nothing moves. Spread it on anything pressable that
  shares a screen with a field. Tab and Enter are untouched — a keyboard never
  moves the layout out from under itself. **It holds off only while `data-kb`
  says there is a keyboard**: Android's back button closes the keyboard and
  leaves the caret in the field, and holding that focus through the next press
  makes Chrome reopen the keyboard over the tap's answer. In
  that state it blurs the field itself rather than trusting the press to move
  focus — which browser and target both get a say in. The three cases are
  `caretOnPress` (`lib/viewport.ts`), which is where the test is.
- **`scrollTo({ behavior: "smooth" })` is not smooth everywhere.** It glides
  on iOS and jumps on Android, and has no end event to wait on either, so a
  scroll the app has to wait for is driven by hand, frame by frame (`glide`,
  `lib/seek.ts`). Reduced motion still puts it in place at once.
- **A sticky `<thead>` needs a scrollport to stick to.** In a wrapper that only
  scrolls sideways — `overflow-x: auto` makes it the nearest scroll container in
  *both* axes — `position: sticky; top: 0` is inert while the page scrolls past
  it, and looks implemented. The wrapper must own the vertical scroll too, with
  `border-collapse: separate`, or the collapsed border belongs to the table and
  slides out from under the frozen row.
- **A `<dialog>` can be shut by the platform without a word.** `showModal()`
  registers a close watcher, and only a document holding history-action
  activation may refuse a close request: without it no `cancel` fires at all and
  the element simply closes. The back press that opens a discard dialog has just
  spent that activation on cancelling itself, so on Android the very next press
  shuts the dialog silently. `Dialog` therefore listens for `close` as well as
  `cancel` — otherwise the element stays mounted and shut, the screen goes on
  believing its dialog is up, and on `/new` that belief is what every further
  press is answered with: `ask` is already `"discard"`, so setting it renders
  nothing, and the back button and the arrow both go dead with nothing on
  screen. `pnpm nav` drives it.
- **A press and a lift on different elements make no `click` at all.** Chrome
  delivers the `mouseup` to whatever is under the finger by then and fires
  nothing else: there is no click to fall back on, and no event says a tap was
  lost. So anything that moves between `pointerdown` and the lift eats the tap
  in silence — a dialog card recentring as `--kb` steps down while the keyboard
  folds is the one to watch, since opening a dialog blurs the field that raised
  the keyboard. This is why the press recorder names a dialog's buttons apart
  from its card: the two targets side by side are the only evidence there is.
- **Only a real `<dialog>` gets focus for free — and it spends it without
  asking.** `Dialog` calls `showModal()`, so the platform keeps Tab inside and
  makes the screen behind inert, but it also focuses the first focusable
  descendant when nothing in the card claims focus. In a dialog whose first
  control is a field that is the field, keyboard and all, `data-autofocus` or
  not. `Dialog` therefore parks focus on the card itself unless an
  `input[data-autofocus]` asks for it, which only `PromptDialog` does. `RowMenu` is a card anchored to the row — or the button
  (`MenuButton`) — it was opened from and cannot be one, so it does that by hand: it focuses its first item once it
  has been positioned — a `visibility: hidden` element cannot take focus, and
  `preventScroll`, because a scroll is what closes it — and hands focus back to
  the row on the way out.
- **A revision's `changes` are only the fields that actually differed.** Saving
  an expense in a new currency at the same rate writes `currency` and no amount
  field at all, so history copy must never read one field because a sibling
  changed.
- **A cancelled back press leaves the browser counting from the entry the
  press was heading for**, not from the screen still on show — for the rest of
  that task, and on a real phone for longer than that. So `history.go(-1)`
  moves *two* — or off the start of the history, where the traversal is
  silently dropped. Hence: don't cancel a press the browser is already getting right, and where
  you must, take no count at all — put the parent in this screen's place
  (`swap`, `back-button.ts`), which is the only right move there anyway, since
  a press is taken over only where going back would land somewhere else.
  Deferring to a macrotask is not enough on its own, though it is still needed
  — a navigation started while the cancellation unwinds is refused outright.
- **Safari's Navigation API is not Chrome's.** `userInitiated` is true for any
  navigation begun while a tap is handled, so the app's own `router.back()`
  looks like the device button (hence `goBack`, enforced by `rules-check`).
  Which traversal is the app's own is said with a **latch**, spent by the one
  `navigate` it explains — never a window of time, which a slow phone
  overruns. A
  latch is armed only where a traversal is actually coming, since one left
  armed answers the next *real* press as the app's own — **and it is also spent
  by the next press or keystroke anywhere**, because "actually coming" is not
  something the arming code can know (see the next Gotcha). The app's traversal
  arrives long before a hand can move again, so a hand that has moved is proof
  it is not coming. That fails the safe way round: a latch dropped early costs
  a "discard?" nobody needed, one held too long costs the work.
- **`history.go` can be called and simply not move.** From an act tapped inside
  a modal `<dialog>` on Android the traversal is never delivered: no `navigate`
  arrives, nothing changes, and the button looks dead. Worse, each such tap
  arms the latch above, nothing spends it, and the next *real* back press is
  waved through with no guard, losing typed work. Leaving closes any open
  dialog **before** the going rather than with the screen (`closeDialogs`,
  `lib/nav.ts`), which is also what the card being answered deserves. `pnpm
  nav` drives it with `history.go` stubbed to a no-op, which is the whole of
  what the phone does.
- **A *refused* press swallows the next traversal too.** A press this app
  cancels (a dialog opened by the device's back button) leaves Android holding a
  traversal it will not deliver again, so the `history.go` that follows returns
  with nothing moved and no `navigate` to say so. What decides whether it bites
  is **where the screen sits**, not which screen it is: the target has to be
  index 0, which is what a phone that resumed into a group gives the form
  pushed onto its ledger. So the going *checks*: still on the entry it asked
  from 150ms later is a traversal that was swallowed, and the destination takes
  this screen's place instead — a push, which is not the queue that is stuck.
  This is the one clock the file allows, because here it fails the cheap way: a
  traversal that was merely late lands on an entry that is already the
  destination, so overrunning the window costs a duplicate entry and never a
  wrong screen.
- **So every exit has to name somewhere to land, or no check can rescue it.**
  `goUp` has a parent to put in this screen's place; `goBack` reads the entry
  behind off `navigation.entries()` and hands it to the same repair. `rules-check` spells
  out the two-argument shape, so an exit the repair cannot reach fails the gate
  rather than waiting for a phone to find it.
- **Don't clear the work before the going.** The entry form renders from the
  draft, so clearing it first makes a swallowed navigation look like a fresh
  blank entry instead of a screen that did not move. The draft goes when the
  screen does, in the unmount, behind the `leaving` ref below.
- **A screen that asks has to stop asking before it goes.** `mayLeave` is read
  again on the way out, so a guard still saying no answers the app's own
  leaving with a second "discard?". Every screen that leaves this way puts a
  `leaving` ref down first — the entry form included, which must not rely on
  clearing the draft, per the Gotcha above.
- **Don't reach for `traverseTo`.** Naming a history entry by key instead of
  counting back to it is the same move with a worse failure: WebKit folds a
  `traverseTo` into one still pending for the same key and never settles one it
  dropped, so telling a late traversal from a lost one takes a timeout — and a
  slow phone makes that timeout fire on a late one, replacing the entry
  underneath a traversal that then lands. `goUp` reads the entries and calls
  `history.go`, both in one tick and outside any event, where the browser's
  idea of *here* is this screen ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).
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
