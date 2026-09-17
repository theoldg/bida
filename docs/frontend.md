# Frontend

*For: anyone writing UI, routing, or PWA code.*

Next.js App Router with `output: 'export'`, TypeScript, Tailwind, Dexie.
Components are hand-rolled — no shadcn, no Radix
([ADR-0008](decisions/0008-hand-rolled-interface.md)). **The whole app is
client-side**: no SSR, no server actions, no Next route handlers. The Worker's
API is reached with `fetch`.

## Routing

Only static routes exist — a static export can't generate a page per group id.
Each screen is its own route, with the group id (never the secret) in the query
string ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).
`lib/group-link.ts`'s `route` object is the one place URLs are built.

| Route | Purpose |
|---|---|
| `/` · `/new` | Groups list, unless a **launch** reopens the group you were last in (`lib/launch.ts`) — the app's name, the light/dark toggle ([ADR-0007](decisions/0007-a-screen-is-a-route.md)), and a row menu holding the invite link and "Forget group" · name, currency and everyone in the group, then which of them you are |
| `/g?id=[&tab=]` | The group: ledger / balances tabs — back from balances is the ledger, not the groups list, since the two tabs are one screen. Settling lives under the balances; the invite link, People, Rates, History and "Forget group" are one top-bar menu (`components/group-menu.tsx`) |
| `/g/entry?id=&e=[&via=]` | One entry — expense, income or transfer. The id is looked up in both tables ([ADR-0010](decisions/0010-what-an-entry-is.md)). `via=history\|members\|rates\|balances` is the screen that linked in from beside it, and is where back goes. On a scanned expense each person's row opens onto what they had (`receiptBreakdown`) |
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
| `/about` | The source link first, then who can edit, whether it works offline, where to complain, and what the server can see. The one screen the app spends on itself, off the quiet line at the foot of the groups list. No pitch: whoever is here already has the app. One client island in an otherwise static page — the whole of "Works offline" (`AboutOffline`, the same `lib/install.ts` state as the nudge on the groups list), because the sentence itself changes once the phone already did it, not just the offer under it. Privacy *shows* one stored row rather than asserting anything, so it is only honest while op bodies reach the server sealed ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)) and changes in the same commit as that does. The receipt-scan exception is repeated here, but the copy that has to be read is `copy.scan.terms`, on the scan screen itself |
| `/diag` | The flight recorder's readout. Linked from nowhere — long-press the app's name on the groups list ([below](#the-flight-recorder-and-diag)) |
| `/join#<groupId>.<secret>` | Invite landing: saves the secret, pulls, then opens the group. A phone that has never said who it is goes on to `/g/claim` — but by `useClaimGate` below, not by this screen, so the same link opened again by someone already in the group just opens it. A fragment with a group id and no secret — and any `/g` screen for a group this phone doesn't hold — shows `KeylessLink` instead of "Bad link": that is the browser bar's address, so it says so and draws the group menu with "Copy invite link" lit. Both failures share its layout and print the link they are about — what was pasted, if it came by **Paste link** (`lib/failed-link.ts`). |
| `/paste` | **Paste link** with nothing on the clipboard: *Nothing to paste*, in "Bad link"'s layout, with the button to paste again, since copying the invite and coming back lands here. Pasting nothing twice says so under it |
| `/install` | iOS only: why the home-screen app, and how. Also where the icon first opens, taking in the groups and names it carries. Off the iOS tab's banner, atop the groups list or a group's ledger |

**Every `/g` route requires a claimed identity**, via `useClaimGate`
(`lib/hooks.ts`), which sends a phone that hasn't answered "who are you" to
`/g/claim`. An unclaimed device has no honest `actor` to sign an op with, and
every screen under `/g` writes one — so it is an illegal state, not a case to
accommodate. It used to be gated on `/g` alone, and the rest are reachable
without passing through it (a bookmark, the join flow's back arrow, a link
beside a settle-up row): People then offered a trash button on every name, and
the removal it wrote was signed by the person being removed.

**Every `/g` route validates its id.** They all read the group out of the query
string, and a link naming a group this phone doesn't have — a stale bookmark, a
URL shared to somebody who never joined — used to leave the sub-screens holding
a back arrow and nothing else, or spinning forever on `useGroupData(undefined)`.
Each, `/g` included, renders `BadLink` (`components/chrome.tsx`), which says
what a proper invite link is, under a bar with no title.

**Back goes up, not back.** A screen's `back` is one of two things and the
device's button agrees with both (`lib/back-button.ts`,
[ADR-0007](decisions/0007-a-screen-is-a-route.md)). A path names a parent, and
`goUp` (`lib/nav.ts`) unwinds the history to it instead of pushing — the button
needs no help here, because with only descending pushing the browser's own back
*is* the arrow; it is taken over only where the arrow skips a level. `{ ask }`
is a screen that would lose typed work: it answers *may I leave?* before
anything is cancelled, and a no cancels the press with the dialog as the whole
of the answer — nothing navigates in its place. An
entry is the one screen whose parent isn't fixed: the history feed, the two
"can't remove this yet" lists and the balances tab's settle-up rows link in from
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
  `undefined` from a live read means *not answered yet*, not *empty* — the two
  used to render the same blank. A list screen shows `SkeletonRows` in that
  window and its empty state only once the read has answered.
- Writes go through `lib/db/commands/` — one function per user intent, each
  building an op, appending it and materialising it in one transaction
  (`append.ts`). **Components never write to Dexie directly.** The rule that an
  op carries only what changed is `patch.ts`, once, for both entry editors: it
  was written out at each of them and the two copies drifted.
- Device-local, never-synced state (who "you" are, theme, whether the install
  nudge is folded, the last group opened, and the scan credential a quick split
  photographs with — [ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md))
  is in the `device` store. Two screens read
  `lastOpenedGroupId`, which `/g` sets on every visit (`setLastOpenedGroup`):
  `/new` defaults a fresh group's currency to that group's rather than always
  EUR, and `/` reopens the group itself on a launch (`lib/launch.ts`) — nearly
  everyone is in one group at a time, and the list was a screen passed through
  on the way to it. A *launch* and not every arrival: the back arrow out of a
  group must not be turned around, so the resume happens once per running copy
  of the app (a module flag) and only on a fresh `navigate` — never on a reload
  or a back/forward traversal. A group forgotten, archived or gone stays on the
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
  scanned bill is worth what its lines add up to, and the payers editor
  reading `amountText` on its own is how it came to call one €0.00. With no
  amount at all the door onto that screen doesn't open: there is nothing to
  divide between payers, so the tap reddens the amount field instead — the
  same red Save gives it, held until something asks for it.
- **A draft carries the id its entry will be written under** (`newEntryId`,
  read through `splitSeed`). The leftover minor unit goes by `tiebreakSeed`,
  which is the entry's id — so a form pricing its rows under a placeholder
  showed the cent on one person's row and wrote it to another's, an arithmetic
  right both times that still disagreed with the screen that asked. `addExpense`
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
  screen has exactly one act and an underlined word in the corner read as
  optional; a save failure is said above it. The kind chip moved
  the other way, onto the top bar — centred on the bar itself (`TopBar`'s `mid`
  slot), not wedged between the title and the edge, which is what the `capped`
  title is for — and gives the amount the space it used to float over.
- **Save is never disabled, and nothing reads as wrong before a tap says so.**
  A grey button gave no reason for the two gaps every empty form starts in —
  no amount, no title — and a structural one (`blocker`: a missing rate, a
  removed member, an unbalanced payer split) used to render the moment it
  became true, before the user had done anything to earn a red line. Tapping
  Save while `!checkEntry(...).ready` sets the form's own `attemptedSave`
  instead of saving; every red state is gated on it, so a fresh screen shows
  none of them. `amountMissing`/`titleMissing` *flash* their field red rather
  than adding a caption — a word doesn't fit next to the hero figure and reads
  oddly in a number field — counted per field so a repeat refusal replays
  ([design-system.md](design-system.md#a-dialog-is-ours-and-its-button-says-the-act)).
  That flash is the only thing that reports a missing amount: the split editor
  used to answer "Enter an amount to split" in its footer, which was the same
  fact in a second place, and `splitFooter` now returns `null` for a zero
  total. `blocker` is a sentence about a relationship the form can't fix by
  typing into the field it's next to, so it keeps its spot above the split
  editor, behind the same flag; `receiptBlocker` stays in the split's footer,
  its "Scan a receipt" half behind the flag for the same reason — an untouched
  Items tab has no bill yet — while the bill-nobody-has-assigned half, and
  the split's other complaints, follow an edit and stay live. Nothing
  is focused or scrolled to: the form is one screen.
- **A press already spending the draft is the form's own `saving` flag.**
  `checkEntry` answers whether the entry *may* be saved, which is a question
  about the form and not about whether a save is in flight — so two taps landing
  before `router.replace` did both went through, recording a transfer twice for
  twice the money. Every other button in the app that writes already held one.
  `pnpm entries` presses Save twice.
- **The invite link is `components/invite.tsx`**, written once for the People
  screen's top bar, the groups list's row menu and the group's own menu. `navigator.clipboard.writeText` rejects on an insecure
  context or a denied permission, and used to reject into nothing — an
  inert-looking button, and the link shown nowhere else. A refusal puts the
  link on screen to be read (`InviteFallback`,
  [ADR-0003](decisions/0003-link-only-access.md)). A copy that works says so
  where it was asked for: the People bar's own button flips to a check for a
  second and a half, and so does the group menu's kebab (`MenuButton`'s
  `confirmed`) — the menu card closes on the tap, so without it the one action
  in the app with no visible result had no result at all.
- **Asking is `components/dialog.tsx`, never `prompt()`/`confirm()`/`<select>`**
  — `ConfirmDialog`, `PromptDialog` and `ChoiceDialog`, which is every picker in
  the app, behind a `.field > .pick` button or a chip. `<input type="date">` is
  the one native control left
  ([ADR-0008](decisions/0008-hand-rolled-interface.md)).
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
- **"Which one is you?" is one screen, `components/who-picker.tsx`**, ending
  both ways into a group: joining, and creating one — including a group of one,
  because the answer is written into every op and a screen that sometimes skips
  the question is a screen you cannot learn. Picking is never a write — the
  button is, whether it claims an identity (ADR-0003) or creates the group with
  that name as its actor. The button answers to the tick and to nothing else; a
  name still being typed moves neither. Filing one *does*: the row it adds is
  ticked as it arrives, because a name typed into the list you are picking
  yourself out of is the pick. The tick is a check mark **and** `aria-pressed`:
  a shape is not a sentence, and without it the only thing naming the pick was
  the button at the foot of the screen.
- History wording is assembled once, in `lib/history-copy.ts` (`describe`),
  from `copy.history`. One revision usually moved several fields — an entry is
  saved whole — and then it returns no sentence about any one of them, but a
  labelled was/now line for each; it reads the fold either side of the revision,
  not just the fields that moved ([sync.md](sync.md#history-ui)). It must be
  **total** — it runs inside a render over every patch the log holds, so one
  throw is a white screen, not a missing line. People are listed **by name**,
  not in the order they are stored: an id is a hash of the name (ADR-0034), so
  sorting by it put a was/now pair in two unrelated orders.
- **The history screen reads the deleted entries too.** Both its subject links
  and its title come from maps built over every entry the group has ever had —
  half the reason to open it is one that is gone, and the alive-only lists
  titled every one of those "Transfer".

## A live read can die

Dexie's `liveQuery` swallows two error names — `DatabaseClosedError` and
`AbortError` — rather than delivering them. It means to ignore a query it
superseded itself; it also ignores one the *browser* killed, and those arrive
by the same door. An installed Android app is frozen when backgrounded and its
in-flight IndexedDB transactions are aborted; Chrome force-closes the
connection under storage pressure. Either way nothing is emitted — no value, no
error — and the subscription is then **dead**: the querier is never run again,
not even by a write to the table it reads. A screen reads "no value yet" as
"still loading", so the app sat on its skeleton rows until it was killed and
relaunched, silently.

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
through holds it, and every read everywhere waits — the owner's `/diag`
showed every read hanging at once and all of them clearing in the same
millisecond a minute later. No page can break another's lock, so three
things limit it. This copy never opens a write while hidden
([sync.md](sync.md)), so it cannot be the one frozen holding it. `useLive`
remembers each read's last answer by name and deps for the life of the page,
so a screen opened during the wait shows that instead of skeleton rows — while
still counting as waiting, so the notice stands. And the last probe, and the
notice's button, open a fresh connection (`db.reopen`), the one lever a page
has on a stuck backend of its own. `/diag`'s `copies:` line names every copy
the service worker can see, and whether it is hidden.

`ReadErrorBoundary` (app/layout.tsx) catches the rest. `dexie-react-hooks`
reports a failed read by throwing during render, and the app had no boundary at
all, so every error `liveQuery` did *not* swallow took the tree to a white
screen.

`pnpm stall` drives both halves in a browser; `lib/db/live.test.ts` pins the
Dexie behaviour itself, so an upgrade that fixes it tells us.

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
now is the reason somebody has the screen open, and recording only on
completion is how that would have been the one line missing. And the timeline
is ordered by when things **started**, not when they ended, so a long `rebuild`
prints above the read it was blocking rather than below it.

Its Copy button sticks to the top of the scroll rather than sitting in a
`Foot`. The bottom of an installed app is where the system navigation bar is,
and `env(safe-area-inset-bottom)` reads 0 on Android often enough that a foot
there is a button with its lower half cut off — which is what happened. The
top is also where it belongs: the screen is opened in order to copy, and the
report under it is hundreds of lines.

A `screen:` line sits above the timeline: the layout viewport, the visible one,
the height the shell actually took, and what the browser admits the system bars
cover. They are one number on a phone that is behaving, and when they are not,
the difference is the strip at the foot of every screen that gets reported as
"the tabs are gone" (see [Gotchas](#gotchas)).

A `home screen` block follows, for the iOS hand-off ([ios.md](ios.md#a-in-detail)),
whose every step is off the screen by the time anyone looks. An inline script
in the layout writes each load's URL to localStorage before Next runs, and keeps
the storage's first load apart forever — on iOS the icon's storage is its own,
so that line is the URL the icon opened, and each load says which manifest its
head got. `/install` and `keepCarried` add `note`s beside them. Secrets are masked (`hideSecrets`); ids are not.

Read it at **`/diag`** — long-press the app's name on the groups list. It is
linked from nowhere; a diagnostics screen earns no room in a menu a person
reads. The previous session is kept in `localStorage` (not a table — this has
to work on the launch where IndexedDB is the broken thing), because the launch
that hung is the launch you killed the app to escape.

It also carries the app's one hidden setting, **Staś mode** — the switch that
makes a scan insult whoever sent it a photo that isn't a receipt
([receipt-scanning.md](receipt-scanning.md#staś-mode)). It is here rather than
on a settings screen because finding it should cost a long-press, and because
the report prints its state beside everything else this phone is doing.

**`/diag` must never wait on the database.** It is opened *because* the
database is not answering. Everything that can block is raced against a 2s
patience window and the timeline, which needs no database at all, prints either
way. The first version asked Dexie for row counts and sat on "Reading…"
forever; `pnpm stall` now fails if that comes back.

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
describes the entry the person is not looking at: `/g/payers` asked "Who
received it" and then said "Ana didn't pay" under her name. Every sentence on
that screen is voiced now, as are the history's payer lines.

## One navigation

At most one nav bar, at the bottom: **Ledger · Balances** inside a group, and
none outside one. The groups list carries its starts below the list instead
of in it: **New group** and **Quick split** as two centred `.starttile`
squares — with **Paste link** a third on an iOS home-screen app, which iOS
never hands a tapped invite (it opens in Safari, whose storage is not the
app's), so the link has to come in by clipboard; only a `/join` URL from this
origin joins, and one from another deployment says which server it belongs to
rather than "Bad link", one with no password, from anywhere, opens that
group's screen, and an empty clipboard goes to `/paste` (`readPastedLink`,
`usePasteLink`) — (`.homepair`, which takes the `margin-top: auto` in a full-height
`.homescroll` to settle at the foot of a short list, and `position: sticky;
bottom: 0` to stay there — floating ungrounded over the rows, as the FABs do —
once a long one would otherwise scroll it out of reach), with nothing under them — **About bida**
is an icon in the top bar, left of the theme toggle. `Tabs` was deleted
from `components/`; don't bring it back. A screen needing more destinations puts
them behind a top-bar icon, not a second row — three icons is the ceiling.

## A screen comes back where you left it

The app scrolls inside a div — one `.scroll` per screen — so the browser's own
restoration, which knows only about the document, restored nothing: the
fortieth entry of a ledger, opened and backed out of, put you at the top of the
list. `lib/scroll-memory.ts` keeps one offset per route in memory (the query
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
The column adds up to the net printed above the list. Rows involving neither
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
is `"default"` so the page starts below the status bar (Gotcha below).
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

`public/sw.js` precaches the whole export — routes, hashed `/_next/static/`
chunks, *and* the `.txt` RSC payloads Next fetches on every in-app tap —
registered from `components/register-sw.tsx`. **It does not cache `/api/*`** —
Dexie is the offline data layer, and a second cache over the same data gives
you two disagreeing sources of truth.

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
outlive what a person thinks of as quitting, so waiting meant killing Safari
over and over to get a deploy. `activate` keeps the **previous** build's cache
and writes down which pages were open (in memory and in the `bida-legacy`
cache, since the browser stops idle workers): those pages keep being served
their own build, so their next tap can't mix an old router with a new payload.
Everything older is deleted.

On the page side, `lib/update.ts` hears `controllerchange` and reloads — at
once if the page hasn't been touched since it loaded, otherwise the next time it
comes back to the foreground, never while hidden (`beforeunload` can't ask about
a half-typed expense then). It also re-checks `sw.js` on every resume: an
installed app is resumed far more often than it is launched. In between,
`components/update.tsx` offers a Reload at the foot of the groups list, **only in
the installed app** — a tab has the browser's own, and the install nudge shows on
exactly the phones this doesn't. So an update lands on the second look at the
app, not after a relaunch. `offline-check` holds three pages open across a
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
holds typed text locally and re-reads the model only on outside change — don't
go back to `value={bare(parseMinor(text))}`, which ate the caret and erased a half-typed
"12.".

`GroupedInput` is the caret-and-grouping half on its own, and the rate dialog
types into one: a rate is the other figure here with thousands in it, and it
was the last field that didn't group them. What may be typed is its `sanitize`
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

- **Never `black-translucent` on iOS 26.** The home-screen app is drawn from
  the top of the screen but laid out a status bar shorter (WebKit bug 301108):
  a strip at the bottom no CSS or JS reaches, and a system blur over the top
  bar. `"default"` puts the page below the bar and avoids both.
- **iOS never sends `contextmenu` for a touch hold**, in any browser — only
  Android and a right click do. `useHold` (`components/long-press.tsx`) times
  the hold from pointer events and answers whichever comes first; the finger's
  later `contextmenu` and lifting click are swallowed on `document`, because
  they land on the menu's veil, which closes on either. A right click proves
  nothing about it; `pnpm entries` holds with touch.
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
  That is why the worker no longer waits (see [PWA](#pwa)).
- **`caches.match` searches every cache in the origin, not yours.** And there
  is always another one to find: `controllerchange` fires *before* the new
  worker's `activate` handler runs, so a page reloading onto the new build is
  answered while the previous build's cache is still there. Unscoped,
  the new worker served that reload an old shell — or, worse, an old `/g.txt`,
  whose client references name chunks this build doesn't have. The screen then
  drew with pieces of it missing (the bottom nav among them) and stayed that
  way until the app was launched again, because the router keeps the payload it
  was handed. Every read goes through `lookup()`, which opens `CACHE_NAME` — or,
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
  white icons on a paper bar. Hence one colour in both places, ink, so the
  white icons the app asks for always have an ink bar under them. A colour
  probe settles which layer paints what: give the manifest's two colours and
  the meta tag values nothing else uses, reinstall, and read the screen —
  splash is `background_color`, status bar is `theme_color`.
- **A press tint is only as tall as the element it is on.** Padding that spaces a row of tappables belongs on the tappables, not on the bar around them: held by the parent, the touch feedback is a short band floating inside a taller bar, which reads as a tap that half landed.
- **Anything floating above the dock rises with `--nav-foot`**, never a fixed `bottom`. The dock's foot is the home-indicator inset (34px installed on an iPhone, 0 in a browser or headless check), so a fixed 78px FAB looked right everywhere but sat flush on the tabs of the iOS PWA.
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
  groups list. Reported on an installed phone after tapping Reload for a new
  build, never on a launch, and never reproduced in a browser these checks can
  drive. **How to recognise it:** everything else is right, the FAB is exactly
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
  card is centred in what is left rather than behind the keys — without it the
  rate pair's own fields and Save were under them. `.foot` pays it too, for the
  screens that still pin an act; the entry form stopped pinning Save and lets
  it scroll instead. **An act that scrolls has to be scrolled to**: the four
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
  viewports is a keyboard only while something has the caret, and measuring it
  at load on a browser that reports the two differently made permanent padding
  at the foot of every list out of a keyboard nobody had opened.
- **A press that closes the keyboard is a press that never lands.** A button
  tapped while a field has the caret blurs it on `mousedown`; the keyboard
  retracts, the visual viewport grows, the page reflows — and the `click` misses,
  because the button has moved out from under a thumb that hasn't lifted. It
  reads as a button needing two taps, and it took Create, the scan pair, Save,
  Continue, the back arrow, the split tabs and every icon button beside a field. `keepsFocus`
  (`components/bits.tsx`) is the whole fix: `preventDefault` on `mousedown`, so
  the field keeps focus and nothing moves. Spread it on anything pressable that
  shares a screen with a field. Tab and Enter are untouched — a keyboard never
  moves the layout out from under itself.
- **`scrollTo({ behavior: "smooth" })` is not smooth everywhere.** It glided
  on iOS and jumped on Android, and has no end event to wait on either, so a
  scroll the app has to wait for is driven by hand, frame by frame (`glide`,
  `lib/seek.ts`). Reduced motion still puts it in place at once.
- **A sticky `<thead>` needs a scrollport to stick to.** In a wrapper that only
  scrolls sideways — `overflow-x: auto` makes it the nearest scroll container in
  *both* axes — `position: sticky; top: 0` is inert while the page scrolls past
  it, and looks implemented. The wrapper must own the vertical scroll too, with
  `border-collapse: separate`, or the collapsed border belongs to the table and
  slides out from under the frozen row.
- **Only a real `<dialog>` gets focus for free — and it spends it without
  asking.** `Dialog` calls `showModal()`, so the platform keeps Tab inside and
  makes the screen behind inert, but it also focuses the first focusable
  descendant when nothing in the card claims focus. In a dialog whose first
  control is a field that is the field, keyboard and all: taking
  `data-autofocus` off the rate editor's field changed nothing on a phone.
  `Dialog` therefore parks focus on the card itself unless an
  `input[data-autofocus]` asks for it, which only `PromptDialog` does. `RowMenu` is a card anchored to the row — or the button
  (`MenuButton`) — it was opened from and cannot be one, so it does that by hand: it focuses its first item once it
  has been positioned — a `visibility: hidden` element cannot take focus, and
  `preventScroll`, because a scroll is what closes it — and hands focus back to
  the row on the way out. Without that the long-press menu opened with the
  caret still on the row behind its own veil.
- **A revision's `changes` are only the fields that actually differed.** Saving
  an expense in a new currency at the same rate writes `currency` and no amount
  field at all, so history copy must never read one field because a sibling
  changed.
- **A cancelled back press leaves the browser counting from the entry the
  press was heading for**, not from the screen still on show — for the rest of
  that task, and on a real phone for longer than that. So `history.go(-1)`
  moved *two*: an expense's button reached the groups list, and a group's ran
  off the start of the history, where a traversal that lands nowhere is
  silently dropped and the press appears to do nothing. Hence both halves of
  the fix: don't cancel a press the browser is already getting right, and when
  you must, name the destination entry (`traverseTo`) instead of counting to
  it. A count is only ever as right as the browser's idea of where you are.
  Deferring to a macrotask is not enough on its own, though it is still needed
  — a traversal started while the cancellation unwinds is refused outright.
- **Safari's Navigation API is not Chrome's.** `userInitiated` is true for any
  navigation begun while a tap is handled, so the app's own `router.back()`
  looked like the device button and the leave guard asked "discard?" of Done
  (hence `goBack`, enforced by `rules-check`). And `traverseTo` joins one still
  pending for the same key, so a traversal WebKit dropped without rejecting
  swallowed every later press: `goUp` replaces when no `navigate` follows.
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
  silently undoes the first — which is how a tab switch lost the tab it had
  just set. `patch()` reads `getDraft(groupId)` itself, so a handler may.
