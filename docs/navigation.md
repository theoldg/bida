# Navigation

*For: anyone adding a route, a link or a way off a screen. Part of the
[frontend](frontend.md) docs; the argument for a route per screen is
[ADR-0007](decisions/0007-a-screen-is-a-route.md), and `pnpm nav`
([browser-checks.md](browser-checks.md#pnpm-nav--where-the-back-arrow-goes-and-what-it-leaves-behind))
holds what this doc promises.*

Every route, then the rules every screen keeps, then how the device's back
button is kept honest — the part most of the Gotchas are about.

## Routing

Only static routes exist — a static export can't generate a page per group id.
Each screen is its own route, with the group id (never the secret) in the query
string ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).
`lib/group-link.ts`'s `route` object is the one place URLs are built.

| Route | Purpose |
|---|---|
| `/` · `/new` | Groups list, unless a **launch** reopens the group you were last in (`lib/launch.ts`, whose `arrival` is the one answer to what brought you here) — the app's name, the light/dark toggle ([ADR-0007](decisions/0007-a-screen-is-a-route.md)), and a row menu holding the invite link and "Forget group" · name, currency and everyone in the group, then which of them you are |
| `/g?id=` | The group: its ledger, the only screen that leaves it. The invite link, People, Rates, History and "Forget group" are one top-bar menu (`components/group-menu.tsx`). A row's long press offers Edit and Delete; Edit opens the form with `via=ledger`, so saving lands back on the ledger rather than on the entry |
| `/g/balances?id=` | Who is up, who is down, and settling, pushed over the ledger by the balance card at its head, so back is the ledger. Figures share one column as wide as the longest (a subgrid), so every bar ends in the same place. The suggested reimbursements you are in come first, and under them, unless you are square, a folded "How are these worked out?" answers the one thing about settle-up a first-timer reads as a bug (`NotWho`). A suggested payment opens a card, not a form — two names, the arrow, the figure, `Cancel`/`Record` — because every figure on it is the app's (`SettleDialog`) |
| `/g/entry?id=&e=[&via=]` | One entry — expense, income or transfer. The id is looked up in both tables ([ADR-0010](decisions/0010-what-an-entry-is.md)). The bar carries the kind and the date; under it the entry's own title, sized to the largest step that says it in one line (`FitTitle`), and the figure ([design-system.md](design-system.md#the-bar-is-furniture)), so the kind needs no chip of its own. `via=history\|members\|rates\|balances` is the screen that linked in from beside it, and is where back goes. The split card lists only the people in the split — an outsider's absence is the whole message. Deleted, it is the same screen under a band that says so and holds Restore ([frontend.md](frontend.md#state)). On a scanned expense each person's row opens onto what they had (`receiptBreakdown`) |
| `/g/entry/edit?id=[&e=][&kind=][&via=][&from=&to=&amount=&title=]` | Add or edit any of the three: one form, a kind chip, and the split inline ([ADR-0010](decisions/0010-what-an-entry-is.md)). Settle-up is the only caller that sends `title` — "Reimbursement" — so a blank transfer stays untitled. Saving unwinds to `formParent`: the entry it was editing, or the screen `via` names — `via=ledger` skips the entry for the ledger |
| `/g/scan?id=` | Scan first, decide after: a drawing of what a photo becomes, and the control that takes one, reached from the camera above the ledger's "+". Fills a blank expense draft and hands it to `/g/entry/edit` with `replace`, so back from the form is the ledger ([receipt-scanning.md](receipt-scanning.md)) |
| `/g/entry/items?id=[&e=]` | The who-had-what grid: who was there across the top, the bill's lines down the side, running totals below. Writes a `receipt` split ([ADR-0016](decisions/0016-receipts.md)), and is reached from the form's Items tab — never navigated to by a scan ([receipt-scanning.md](receipt-scanning.md)) |
| `/g/tip?id=` | The tip jar, off a FAB on the balances screen: what a scan costs, Buy Me a Coffee, and an ordinary expense to record what you gave ([product.md](product.md#the-mvp)) |
| `/g/payers?id=` | Who *put the money in* (or took it in), for co-sponsored entries ([ADR-0010](decisions/0010-what-an-entry-is.md)) |
| `/g/history?id=[&e=][&via=]` | Version history, whole-group or per-entry. Per-entry is titled Entry history, carries the entry's own `via` so the chain back stays exact, and ends in a "Group history" link rather than a bottom bar |
| `/g/rates?id=` | The group's exchange registry: one row per currency it spends in, each opening the rate dialog — which only ever edits the number, since deleting a rate is on the row's long-press menu, as it is for an entry. Adding a currency here is the same dialog the entry form opens by itself ([ADR-0005](decisions/0005-money-and-currency.md)) |
| `/g/members?id=` | People: the member list, its check mark saying which of them this phone is, a trash button on everyone else. Adding is the last row of the list; changing identity is a button under it. Removing and changing identity each ask in a dialog ([ADR-0008](decisions/0008-hand-rolled-interface.md)) |
| `/g/claim?id=` | The last step of joining: pick who you are, then a button into the group — the same picker `/new` ends on. In an iOS tab, a card under it holds the link to paste into the home-screen app (`UseInApp`, [ios.md](ios.md#gclaim--have-the-app)) |
| `/quick` · `/quick/items` · `/quick/result` | A bill split with people who are **not** a group ([ADR-0035](decisions/0035-a-quick-split-is-a-bill-with-no-group.md)): the drawing of what a scan becomes, who is splitting, and the camera · the who-had-what grid · the answer, handed over as text. No group id anywhere — it appends no op, asks nobody who they are, and lives in the draft store until it is left |
| `/demo` | The demo group: creates it, or reopens the one on the phone, and `replace`s into its ledger. Idempotent because its id is the constant `DEMO_GROUP_ID` (`core/demo.ts`); `demoStamp()` fingerprints the seed, so an older build's demo is erased and re-seeded. **Linked from nowhere in the app** — it is a group somebody sends you to. Since what gets sent is often the address bar, any `/g` screen naming the demo's id on a phone without it goes to `/demo` instead of the bad-link screen (`BadLink`) — unless this phone cleared one, whose ledger draws "no group" before the menu has left (`wantsDemo`). It differs from an ordinary group only where it has no key ([sync.md](sync.md#the-demo-group-has-no-key)): a permanent mark atop the ledger (`components/demo.tsx`), **no install offer** under it ([ios.md](ios.md#the-card--the-groups-list-and-the-ledger)), **Copy invite link** refusing out loud, and **Clear the demo** in place of Forget group — `eraseGroupLocally`, not `forgetGroup`, since a hidden demo with no link is dead data; its dialog prints the address (`useHost`) that re-seeds it. Scanning, export and the tip jar all work ([product.md](product.md#the-mvp)) — the camera on this phone's own scan credential (`useScanAs`) |
| `/about` | Source link, who can edit, offline, where to complain, what the server can see, and the hosted service's one disclaimer (a one-person project that cannot restore a lost link). Off the groups list's kebab (`HomeMenu`); no pitch. Its two client islands are "Works offline" (`AboutOffline`, reading `lib/install.ts`) and the delete address, which names this host (`AboutDelete`). Privacy *shows* one stored row, so it is only honest while op bodies reach the server sealed ([ADR-0036](decisions/0036-the-server-cannot-read-a-group.md)) — change it in the same commit as that. Its two exceptions (receipt photo, Tricount fetch) are repeated here, but the binding copy is `copy.scan.terms` and `copy.importData.fineprint`. The build's version sits in the top bar's corner ([hosting.md](hosting.md#versions)) |
| `/g/export?id=` | The group as a spreadsheet, in text, for a browser that cannot hand over a file — `/diag`'s layout, because it is the same act. Reached only from the last rung of `lib/export.ts`; it rebuilds the CSV itself rather than being handed it, since a route cannot carry a file and a readout that empties on reload is the drawer state [ADR-0007](decisions/0007-a-screen-is-a-route.md) removed. Being an ordinary route it can also just be opened, so the sentence over the text asks `fileHandoff()` rather than asserting that this browser can't save one ([import-export.md](import-export.md#getting-a-group-off-the-phone)) |
| `/import` | A Splitwise (or bida) CSV as a **new** group ([import-export.md](import-export.md#bringing-a-group-onto-the-phone)). Off the groups list's kebab, not from inside a group: what it makes *is* a group, and merging a file into one that already has entries would mean deciding which row is which entry, which the file carries no ids to decide. Pick a file or paste a Tricount link, read, look at the plan, then the `/g/claim` picker over the source's own people — with no add row, since a name with no column in the file has no balance to be |
| `/delete-my-data` | Deleting a whole group from the server, for everybody in it ([import-export.md](import-export.md#deleting-a-group)). Linked from nowhere: `/about` prints the address for somebody to type, which is the first of this screen's frictions. It is the address somebody reaches for anyway when they want a service to forget them |
| `/diag` | The flight recorder's readout. Linked from nowhere — long-press the app's name on the groups list ([diag.md](diag.md)) |
| `/join#<groupId>.<secret>` | Invite landing: saves the secret, pulls, then hands the group to `/`, which pushes it (`handOverToGroup`, `lib/launch.ts`) — a link tapped in a chat opens a browser one history entry deep, so this screen gives its entry to the groups list rather than to the group, and the device's back button climbs the app instead of leaving for the chat. A phone that has never said who it is in this group is pushed straight to `/g/claim` instead, not bounced off the ledger by `useClaimGate`; the same link opened again by someone already in it just opens the group. From the link to the question the phone shows one screen, `JoiningFrame` (`components/joining.tsx`), drawn by `/join`, by the list while it pushes, and by `/g/claim` while its read answers — never the list's or the ledger's skeletons in between. A fragment with a group id and no secret — and any `/g` screen for a group this phone doesn't hold — shows `KeylessLink` instead of "Bad link": that is the browser bar's address, so it says so and draws the group menu with "Copy invite link" lit. Both failures share its layout and print the link they are about — what was pasted, if it came by **Paste link** (`lib/failed-link.ts`). Everything else is the waiting screen, prerendered in the static export (wordmark and *Joining…* from first byte); its one sentence, on what the wait is, holds off for 2.5s, since most joins are done well before and it would only flash |
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
"can't remove this yet" lists and the balances screen's tip jar link in from
beside it, so they pass `via=` and `entryParent` (`lib/group-link.ts`) sends back
there instead of to the group. The entry form carries the same `via` — through
who-had-what and back — so **saving** unwinds to wherever the form was opened
from (`formParent`) rather than dropping everyone on the ledger. A
`<Link>` to an ancestor or a sibling must `replace`; only descending pushes.

**The group secret lives in the URL fragment**, which browsers never send to a
server ([ADR-0004](decisions/0004-static-export-and-offline.md)). Never move
it into a path or query string "for convenience". The id alone is fine — it
confers nothing without the secret.

## One navigation

No nav bar. Inside a group the ledger's balance card is the way to the
balances — the whole card is the button, stacked words over figure with a
chevron — and a push, so Back returns to the ledger. The groups list carries its starts below the list instead
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
included: `?id=` is which group, `?e=` which entry), and `Scroll` puts it
back on the way in. It aims at the furthest point the content has reached and
stays unfinished until the real one exists, because the rows arrive from Dexie
after the frame draws; it records nothing until that lands, the finger takes
over, or a second and a bit passes, since every position on the way there is
shorter than the target and saving one would walk the list towards the top.

## Gotchas

- **A launch cannot put the list under the group it reopens.** Chrome marks
  every same-document entry skippable once a document adds one with no user
  activation, and the device's back (not `history.back()`) skips them; on
  Android the app then closes. A launch has no activation to spend, so pushing
  the group onto the list only worked after a first tap — tried in 1.1.31 and
  removed, and the resume `replace`s
  ([history manipulation intervention](https://github.com/chromium/chromium/blob/main/docs/history_manipulation_intervention.md)).
  Playwright's `goBack()` doesn't skip, so no check here can see it.

- **Two navigations asked for in one tick are folded into the last one.** A
  screen that wants to both give its history entry away and push another on top
  cannot: `router.replace` then `router.push` leaves only the push, whatever it
  is deferred by. It takes two screens, one commit each — which is why `/join`
  replaces itself with the list and the list does the pushing.
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
