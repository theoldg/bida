# Browser checks

*For: anyone writing, fixing or reading a browser check. Part of the
[testing](testing.md) docs, which say how `pnpm verify` runs them on GitHub at
every push, and why nothing waits on them but the pusher. What each check is
*for* is its own section; [Writing a check that holds](#writing-a-check-that-holds)
is what every one of them has had to learn.*

## `scripts/lib/harness.mjs` — what the browser checks share

A build, a server that speaks the static export's dialect, a phone-shaped
browser, a pass/fail tally that owns the exit code — and fails a check that
reported nothing — and a seeded group, so the
next check costs a dozen lines:

```js
import { onePhone, newGroup } from "./lib/harness.mjs";

// Built, served on port 0 (two checks can't collide), one phone; page errors fail.
const { base, close, browser, page, report, finish } = await onePhone();

const g = await newGroup(page, base, { name: "Trip", me: "Theo", members: ["Marie"] });
report(await page.getByText("Trip").count() > 0, "the group exists");
await browser.close(); close(); finish();
```

`serveExport({ intercept })` gets first refusal on every request — that is how
checks/offline drops an asset and forges a service-worker revision, which is
what lets one run cover both a deploy that must fail to install and a good one
taken from the groups list with a second tab still open on the old worker.
`serveWorker()` is the other server: `wrangler dev` with a throwaway D1, so the
static export and the sync API answer on one origin the way production does. It
costs ~10s of boot, so reach for it only when a check needs two phones to
actually sync. `pick(page, opener, row)` opens one of the app's own dialogs and
takes a row out of it; every picker in the app is one
([ADR-0008](decisions/0008-hand-rolled-interface.md)). `readStore`,
`readDevice`, `putDevice` and `untilDevice` read and write the phone's IndexedDB
directly, for what no screen shows; wait on an app write with `untilDevice`,
never a pause.

Every context `newPhone` makes waits `PATIENCE` — 30s — rather than playwright's
default, and it is the ceiling these checks give their own waits too: a loaded
machine is never the one a smaller number was written on. `settle(page, ms)` is
the other half — a pause the *page* keeps, for the few places that have to
out-wait one of the app's own timers.

## `pnpm verify entries` — the form is wired to the commands

The command tests prove an income's sign reaches the balances and that a
transfer edit writes only what changed. They cannot prove the *form* reaches
those commands — a Save stuck disabled, a segmented control writing the wrong
field, a detail screen that can't find a settlement by id
([ADR-0010](decisions/0010-what-an-entry-is.md)). This adds each of the
three kinds through the real UI, edits them, and reads the history back. It
also drives an entry's own rate end to end with no feed behind it — a new
currency opening the dialog by itself, the two directions of the field moving
together, the next entry borrowing the group's last rate without asking, and
correcting one entry's rate from its screen moving that entry and no other
([ADR-0005](decisions/0005-money-and-currency.md)). And it presses Save twice
from the keyboard, since a `click()` waits for a settled screen in between and
so cannot reproduce a double write. It holds rows with real touch, too, since a right
click is not what an iPhone sends: a hold opens one menu that its own lifting
click and Android's `contextmenu` leave open, and a tap, a scroll, a tap just
after and Enter all still navigate. The held finger then **slides onto an item
without lifting** and is answered, which is the gesture the browser reads as a
scroll and drops on the floor; a finger that only drifts chooses nothing. And a
menu item is tapped **without a click** — pointer and touch events dispatched
by hand, because that is the tap iOS sometimes sends and Chromium never does
([touch-and-viewport.md](touch-and-viewport.md#a-touch-is-not-a-click)) — while a lift that slides off the item
first still chooses nothing. Then the tap every *other* phone sends, whole,
which asks **where that tap's own `mousedown` landed** rather than whether the
dialog it opened survived: a dialog's card is centred, so a menu halfway down
the screen drops the stray press harmlessly on the card and would hide the bug.

A tap on the Record card's figure is read back off the clipboard, which must
hold the bare number ([import-export.md](import-export.md#the-clipboard)).
It also opens the two screens that carry the in-memory draft with no draft to
carry — which is what a reload, a restored tab or a kept link is — and holds
them to going back to the ledger rather than waiting for one that is never
coming, and opens all four of the form's screens on a group this phone hasn't
got. `pnpm rules` already fails a `/g` page that renders no `BadLink`; a grep
cannot see whether an unknown id *reaches* that branch or the blank frame
beside it ([navigation.md](navigation.md#routing)).

**Wait on state, not on a URL:** a save navigates before Dexie has redrawn, so
every assertion here follows a `waitForFunction` on the row count. Skipping
that is what makes a check like this flake.

## `pnpm verify keyboard` — a form under a phone keyboard

Four screens ask for people in the same add row (`components/name-adder.tsx`), and each ends on the act those
people are for — Create, "Continue as …", the scan pair, "Change who you are" —
docked under the scroller (`.whodock`), which pays the keyboard's strip as its
own padding ([touch-and-viewport.md](touch-and-viewport.md#the-screen-and-the-keyboard-over-it)).
Lose that padding, or put the act back inside the scroller, and the button sits
under the keys on a phone nobody in this repo is holding.

There is no keyboard in a headless browser, so one is faked where the app reads
it — `visualViewport.height` — and everything after that is the app's own:
`gapOf` calls the gap a keyboard, `--kb` is paid, and the scroll is the one
`components/viewport.tsx` makes. The assertion is what a thumb cares about, the
field *and* the act still above the top of the keys. The list is ten people
deep on every screen on purpose: three fit above a keyboard whatever the scroll
does, and a check that passes with the fix deleted is worse than none — with
the dock's `--kb` padding gone, all five assertions fail.

The confirm key is the other half, and it needs no faking — a headless browser
presses Enter like any other. It walks the columns the fix is really for,
the split editor's "as amounts" and "as parts" and `/g/payers`, one press per person down a
column of ten, and asserts what a thumb would notice: every row reached, each
one once, and the last of them folding the keyboard rather than wrapping round
to the top. The two assertions that keep the chains apart are the other ones
worth having — the entry form's note folds rather than diving into the column
underneath, and the add row, which is a `<form>`, still files the name and
hands the caret back ([entry.md](entry.md#the-keyboards-chain)).

## `pnpm verify stall` — a read of this phone's database that dies

It holds the defect no screen can report: an installed Android app hanging on
its skeleton rows, indefinitely, with nothing in the console
([live-reads.md](live-reads.md#a-live-read-can-die)).

`indexedDB.open` is stubbed to return a request that never fires an event —
what a wedged backing store or a blocked upgrade does, and what nothing in
Dexie times out against. The skeleton is expected, and then the notice over it
is. Measured against the app with the watchdog taken out, the second assertion
fails, which is what makes it a check rather than a screenshot.

It also opens `/diag` while the database is still wedged and fails unless the
readout names what never came back. A diagnostics screen that hangs on the
fault it reports is worse than none.

Then the database is deleted from another connection — a browser reclaiming
storage, from inside the page. A smoke test, for the property (a forced close
must not strand the app on rows no longer there), not the mechanism: it passes
with the `close` handler removed too.

Then a second tab holds a readwrite transaction open over every store — the
lock a frozen copy keeps. A screen already read must show its remembered
answer rather than skeleton rows (it fails with that taken out), the notice
must still stand and then leave once the lock goes, and `/diag` must list the
other copy.

Last, the other side of that: this copy must never be the one holding it. A
page told it is hidden opens a group, and the `device` write that navigation
makes must not land until the page is seen again — it fails both ways with the
gate taken out (`lib/db/visible.ts`). Headless Chromium calls every page
visible however the tabs are arranged, so `visibilityState` is overridden in
the page rather than a second tab brought forward; the navigation it lies to is
a real one.

## `pnpm verify demo` — the demo group, and the key it must not have

The seed's arithmetic is core's own (`demo.test.ts`: the balances clear to zero
under `settle`, every amount is a positive integer minor unit, any permutation
folds identically). What this check asks is what the seed cannot: that
`/demo` first asks which of the four you are — nobody preselected — and the
answer lands on a populated ledger rather than an empty state, that the balances do not cancel, that the mark is at its head, that the
cantina tab opens onto the bill it was itemised from, that **Copy invite link**
refuses out loud, that an entry added there is not "waiting" offline, and that
clearing a demo somebody has added an entry to takes the whole group off the phone while the address lays the shipped story
down again — entry for entry, and without the one that was added. A demo
address copied from any `/g` screen opens the demo on a second, fresh phone
rather than "bad link", and does not re-seed it on the phone that cleared it;
a cleared demo asks again who you are, a re-seeded one keeps the answer. The dialog
that offers it has to name this server's own `/demo`, host and all: the host is
the browser's to supply, so an unwired one would read as a bare path.

It then says this phone holds an older build's seed — a `demoSeed` of its own
invention, written straight into the device record — and reopens the address,
which has to erase what is there and write the new story rather than hand back
the old one ([navigation.md](navigation.md#routing)). The visit after that must
rewrite nothing: a re-seed on every open would throw away a demo somebody was
still reading.

It also photographs a receipt there, with the network watched: the demo scans
under this phone's own credential, and its own id must appear in no request at
all ([sync.md](sync.md#the-demo-group-has-no-key)).

It also sits on the ledger for fourteen seconds and asks for the stall notice,
which costs the check its slowest assertion and is worth it: a group with no
key row is the demo's defining property, and a read answering `undefined` for
it would raise the notice over a drawn screen
([live-reads.md](live-reads.md#a-live-read-can-die)).

The assertion worth having is the quiet one: `groupKeys` stays empty
([sync.md](sync.md#the-demo-group-has-no-key)). A key row there is the single
change that would start pushing tourists into a D1 that gets no further resets,
and nothing else would notice, because the demo would carry on looking perfect.

## `pnpm verify homescreen` — the invite that rides onto the home screen

One step of this cannot be checked anywhere but an iPhone: which URL WebKit
writes into the bookmark when someone taps Add to Home Screen
([ios.md](ios.md#a-in-detail)). Everything on either side of
that step can be, and all of it looks fine in jsdom — so the check wears an
iPhone's user agent and drives both ends.

The tab end: a join that is not stopped to ask about installing; no page's
HTML carrying a manifest; the banner — on the groups list, and at a ledger's head — the first landing on a `/install` whose
fragment is every group the tab holds and who it is in each, the top of the
list first; the claim list's "Have the app?" card holding the group's link;
every page's head — `/`, a group, its members, not only the tutorial — holding
exactly one manifest, a `blob:` whose `start_url` is `/install#` those same
groups and whose URLs are all absolute (a blob has no base to resolve a
relative one against); and a browser that installs by itself — Android — given
the one static manifest.

It also asks Chromium's own install machinery what it would take, over CDP's
`Page.getAppManifest` — the same question Safari asks WebKit when the share
sheet opens, and it is answered from the DOM as it stands rather than from what
was in the head at load. Chromium is not WebKit and cannot say what iOS
bookmarks, but it is a second implementation of the same parse and the only one
that can be run here. A deliberately relative `start_url` follows, and must come
back refused: every URL in a blob manifest has to be absolute, because a blob
has no base to resolve against, and that is the one mistake this approach
invites — without that control the green above would mean nothing.

**A head that predates a change** is checked as a pair, because the reload that
mends it is gated on the shell being precached ([ios.md](ios.md#a-in-detail)):
a warm phone's stale head is mended by a row tap on the list, and a phone with
no service worker at all — a first visit, mid-precache — keeps its stale head
through the same tap. Both count document requests, and the move is a row tap
rather than the back arrow on purpose: the arrow *traverses* (`lib/nav.ts`),
and a cross-document traversal rebuilds the head by itself, which would pass
with the reload switched off.

The app end (`asInstalledApp`): a launch on one invite nobody has named hands
it to `/join`; a launch whose secrets are already on the phone doesn't — the
icon is a door into the app, not into one group forever; one carrying several
saves them all, lands on the list and has claimed the member the tab was in
each; and one named group skips `/join` and is claimed too. The keys and names
are read out of IndexedDB rather than off a screen: no sync API stands behind
this check, so a group whose key just arrived has no ops to draw a row with —
which is also the slow phone's first launch held still, where the list must
say it is fetching them rather than that there are none. Every frame of three
launches — the newcomer's, a reopen, several groups — is sampled from the
first: none may show the tutorial (`/install` is its route too), no screen at
all, or a pressable control while `/install` stands in; the newcomer and the
reopen never show the list either.

**The in-app browser**, last: a webview joins under a banner naming the app,
unfolding to the button to press and the link to paste as text (iOS) or an
`intent:` link (Android), each carrying its groups and who it is in each, which a tab opens straight into. Then the half that matters more: the
home-screen app, Brave and DuckDuckGo each draw *no* banner
([ios.md](ios.md#the-in-app-browser--a-one-off-visit)).

It needs no server beyond the static export: what it asserts is which URL each end reaches.

## `pnpm verify offline` — the built app with the network cut

An offline-first data layer is not enough: if the precache misses the payloads
Next fetches on every tap, a phone with no signal gets a wall of
`1:"$Sreact.fragment"`. So this seeds a group online, lets the service worker
install, pulls the plug, and walks every screen, saving an expense on the way
([pwa.md](pwa.md)). Then the deploys, on levers the server holds: one arriving
over a dying signal with an asset missing must fail to install rather than
activate with holes; one arriving by itself is taken at once only by a page
untouched on the groups list — a page in use is offered the reload, an
untouched group stays put, and a resumed one reloads only after a long absence,
played out by moving the page's clock; a second deploy must not delete the
cache a page that never reloaded still runs on; and a page whose build has left
the cache is refused a stranger's payload and keeps its `?id=`.

## `pnpm verify nav` — where the back arrow goes, and what it leaves behind

The arrow's destination is the half the other checks already stumble over on
their way somewhere else. This one watches **the shape of the history behind
it** — whether the screens you left are still there — which is what the device's
back button reads on the next press. Every assertion
here reads `navigation.entries()` rather than `location`
([ADR-0007](decisions/0007-a-screen-is-a-route.md), `lib/nav.ts`).

Each section is a move a thumb makes: the walk in, every door into a group
pushed from `/` so the list stays under the ledger; the balance card and the
arrow back off balances; an entry opened off the ledger, and the Save that
returns to it; the tip jar's form, unwinding past the tip screen too; the quick
split, pushed onto the list; a cold load with nothing behind it, where the arrow
puts the parent in this screen's place; the press guard on a half-typed form,
cancelled outright, the dialog its whole answer; the dialog the platform shuts
with no `cancel`, and the taps it was given as `/diag` records them; a
`history.go` that never moves, the card coming down and the act happening
anyway; Discard one entry above a cold ledger; and the ledger's position, left
with a row cut by the top edge and required back to the pixel after the arrow,
the device's back and a Save that lands a row above it — watched from the frame
the saved row is drawn, since it then glides to it, and the figure rolls only
then — while a tap in from the list opens at the top. Beside the cold load, the
press no traversal can carry: a launch's reopened ledger and a cold one each
climb to the list on a close request with no tap first, and a screen above them
doesn't. **Escape stands in for Android's button** there, being a close request
too. Then a back press the instant an entry opens on a CPU throttled sixfold,
which a handler in a passive effect sends past the ledger to the list. Last,
Delete on an entry: up to history, or to a ledger folding its row out though the
read came first (traversal held 80ms).

**A device back press is `page.goBack()`**, which Chromium reports
`userInitiated` and `cancelable` — the pair the guard reads. A keyboard
shortcut is not: headless Chromium binds none, and `Alt+ArrowLeft` fires no
`navigate` event at all, which makes a guard check written with it pass by
never pressing anything.

**And that press is not awaited.** A cancelled press never lands, so
`await page.goBack()` would sit out the navigation ceiling. What is awaited is
the dialog.

The waits are on the history itself: `window.__shape()` goes in through the
context, so the wait for a shape and the reading of it are one function and
cannot drift, and every assertion is a condition rather than a pause. The one
exception is the guard's second half, where the assertion is that the screen
did *not* move — a cancelled press has nothing to announce, so that one takes a
`settle` ([above](#scriptslibharnessmjs--what-the-browser-checks-share)). The
group is built once, by the section that walks in through `/new`, and every
other section stands on it.

## `pnpm verify search` — where the search bar is, and the list under it

What a search finds is unit-tested (`lib/ledger.test.ts`), and so is how much
of the bar a scroll brings out (`lib/ledger-search.test.ts`). This holds what
neither reaches, the bar's every state on a real screen
([frontend.md](frontend.md#the-ledgers-search)): away at the head and half out half a bar
short of the base state; in the column over results; back at the base state when cleared; home
again when let go of empty, but not when a drag is what let go; kept for the
way back from a result and blank on a tap in; drawn where the list is put
back from the first frame of a way back from an entry; and a list too short
to scroll lent the room, again on the way back. The moves are **recorded frame by frame, not sampled** — a
fling must draw the bar part-way, a cleared search must never, a first letter
must bare no head while a slowed list catches up — since each is over in a
dozen frames. With the rate limit taken out, both fling assertions fail.

## Writing a check that holds

What every check has had to learn. `pnpm check` doesn't run these, so a screen
change that moves a control goes in green and is found here on GitHub: when you
move a control, change its role, or change where a save lands, grep these
scripts for it in the same commit.

**Find a control by what it is, not what it says.** Copy is settled by ear, one
word at a time, so a selector naming the words has an expiry date: name the
icon, the class, the role, and leave the wording to `copy.ts`. Where a name is
unavoidable — `getByLabel` on `/new` is "Name", the placeholder "Group name" —
remember a role's `name` is a substring match (`{ name: "Edit" }` also finds
"Edited once · by Luke"; take `exact: true`), and that `copy.ts` types its
apostrophes (`/Marie.s amount/`, not `"Marie's amount"`). A strict-mode
violation is the driver saying what a screen reader would find: two controls
with one accessible name, which is a bug in the screen. Scope a row's click to
the row (`.rows .row` filtered by the member's name), or `.first()` seeds a
"co-sponsored" expense that quietly has one payer and still looks plausible. A
skeleton row is `.rows .row` too, outliving the ledger's arrival by 120ms in
`SkeletonVeil`: count `.rows .row:not(.skelrow)`; and `/` holds hidden resume
frames, so a locator there wants `:visible`.

**Wait for the thing, never a pause.** `waitForTimeout(400)` is a bet placed on
a machine running one check. Wait for the address after a tap, the row in
`device` the screen writes, the class a flash takes — `PATIENCE` as the ceiling
— and for the state the assertions expect, not for two samples agreeing, which
is quiescence and not the answer. `waitForSelector` waits for *visible*, which a
`<link>` never is: anything in the head wants `{ state: "attached" }`, after a
wait for the page to have parsed it. The router draws the next screen before it
commits the URL, so a step that reads the stack or presses Back waits for the
URL too. The rate dialog opens a moment after the currency pick, once the
look-up behind it fails. The one honest pause is the window for proving that
*nothing* happened. **A wait that swallows its timeout must ask for a state
that comes**, or it sits out the ceiling and passes: three once cost 90s a run.

**The app has its own clock, and a starved machine can overrun it.**
`SWALLOWED_MS` ([navigation.md](navigation.md#keeping-the-devices-back-honest))
costs at worst a duplicate entry, never a wrong screen — so a check asserting
where a repair *landed* is safe, and one asserting the **shape of the stack**
across a repair can go red on a busy machine and green alone; say which you are
writing. Don't tap on straight after a Back that traverses: wait for
`navigation.currentEntry.index` to drop, as `pnpm verify offline` does. Don't
sample the "still stuck" moment either — **record it**: §10 of `pnpm verify
nav` hangs a `MutationObserver` before the tap and reads it afterwards.

**Drive the app as a person would.** The app never reloads in normal use, so
anything it keeps in memory (a draft, `lib/draft.ts`) is gone at a `page.goto`:
`goto` is for arriving, and from there, click. Playwright scrolls a row into
view before clicking it, which moves the ledger's remembered position — click a
row wholly in view to leave it intact. A headless browser has no keyboard, so a
press on a button drops the caret (`HoldCaret`): a check wanting it kept fakes
the keyboard as `pnpm verify keyboard` does. The installed app is
`asInstalledApp(page)`, since neither playwright nor CDP can set
`display-mode: standalone`.

**`setOffline` is the page's network, not the browser's.** The `sw.js` update
check goes out anyway, so a lever `checks/offline` holds (a forged revision, a
blocked asset) is read by an install nobody asked for. Put it back before the
navigation that could ask, and serve a forged revision once (`swOnce`).

## Gotchas

- **`/g` is both a file and a directory** in the export, which crashes a naive
  static server with `EISDIR`. The harness handles it — don't hand-roll another.
- **A check that hangs fails after five minutes** (`HUNG_MS`), naming the last
  thing it reported: Playwright's `close` and `bringToFront` take no timeout.
- **Don't edit `apps/web` while a check runs.** Each calls `ensureBuild()`, so
  a queued one rebuilds `out/` under the running ones.
- **One flake is still open**, rare and green alone: `pnpm verify offline` "tap
  a suggested transfer" — the page reaches balances, then is found back on the
  ledger. Not a late Back; its failure prints the history stack, the next clue.
