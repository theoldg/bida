# Browser checks

*For: anyone writing, fixing or reading a browser check. Part of the
[testing](testing.md) docs, which say how `pnpm verify` runs them and why
nothing gates them. What each check is *for* is its own section; the Gotchas
are what every one of them has had to learn.*

## `scripts/lib/harness.mjs` — what the browser checks share

A build, a server that speaks the static export's dialect, a phone-shaped
browser, a pass/fail tally that owns the exit code, and a seeded group, so the
next check costs a dozen lines:

```js
import { ensureBuild, serveExport, launch, newPhone, reporter, pick, newGroup }
  from "./lib/harness.mjs";

ensureBuild();
const { base, close } = await serveExport();   // port 0 — two checks can't collide
const browser = await launch();
const page = await (await newPhone(browser)).newPage();
const { report, finish } = reporter(page);     // page errors count as failures

const g = await newGroup(page, base, { name: "Trip", me: "Theo", members: ["Marie"] });
report(await page.getByText("Trip").count() > 0, "the group exists");
await browser.close(); close(); finish();
```

`serveExport({ intercept })` gets first refusal on every request — that is how
offline-check drops an asset and forges a service-worker revision, which is what
lets one run cover both a deploy that must fail to install and a good one taken
from the groups list with a second tab still open on the old worker.
`serveWorker()` is the other server: `wrangler dev` with a throwaway D1, so the
static export and the sync API answer on one origin the way production does. It
costs ~10s of boot, so reach for it only when a check needs two phones to
actually sync.  `pick(page,
opener, row)` opens one of the app's own dialogs and takes a row out of it;
every picker in the app is one ([ADR-0008](decisions/0008-hand-rolled-interface.md)).

Every context `newPhone` makes waits `PATIENCE` — 30s — rather than
playwright's default, and it is the ceiling these checks give their own waits
too: `pnpm verify` runs nine browsers at once, so the machine is never the one
a smaller number was written on. Nothing reaches that ceiling on a machine that
is keeping up. `settle(page, ms)` is the other half — a pause the *page* keeps,
for the few places that have to out-wait one of the app's own timers.

## `pnpm entries` — the form is wired to the commands

The command tests prove an income's sign reaches the balances and that a
transfer edit writes only what changed. They cannot prove the *form* reaches
those commands — a Save stuck disabled, a segmented control writing the wrong
field, a detail screen that can't find a settlement by id
([ADR-0010](decisions/0010-what-an-entry-is.md)). This adds each of the
three kinds through the real UI, edits them, and reads the history back. It
also drives the rate registry end to end — a new currency opening the dialog by
itself, the two directions of the field moving together, and correcting a saved
rate re-valuing an entry already in the ledger
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

## `pnpm claim` — the name that has not been filed yet

The add row lets a name be typed and not yet filed, and only its own plus files
one (`components/name-adder.tsx`). What goes wrong there is never arithmetic: a
blur that must do nothing, a plus that must take the caret rather than file or
sit dead on an empty row and must refuse a name the list already holds, a
refusal that must bloom whichever of the two (the plus, or the field's own
text) is what has to change and must end the moment a key is pressed — taking
the button it had spent back with it — and a screen whose button must not read
intent out of a field nobody has pressed anything on. All of it looks perfect in jsdom.

So the press is made by hand and **held**: `locator.click()` re-resolves the
button and quietly retries a press that missed, and an instant down-up is over
before React has re-rendered, so either shortcut reports a green on a build
where the press and the screen disagree about what is under the finger. Both
doors are walked, because their add rows differ where it matters — on `/new`
the list is state and grows in the same tick, on `/g/claim` it is a Dexie write
that arrives whenever it arrives, and the tick has to follow it there.

The two acts that refuse rather than acting without enough people are checked
here too — `/new`'s Create (an unfiled name, or nobody on the list yet) and a
quick split's scan pair (an unfiled name, or fewer than two people): the plus
blooms over an unfiled name and the placeholder over a list that is simply too
short, the button is spent for the length of the flash, then both come back —
or come back early, because typing ended the flash.

It ends on the other half of that question: a phone that has answered it is
never asked again. The invite link is copied out of People and opened a second
time — it must land in the group, not back on the picker, with the groups list
left in the history entry under it, so the device's back button climbs the app
rather than leaving for wherever the link was tapped. Backing out of *that*
group must stay on the list: a document that loaded on `/join` never drew the
list, and its first arrival there must not be read as a launch. Then the app is launched, which
reopens the group last open, while backing out of that one must leave the list
alone — and must be remembered, so the launch after it lands on the list until
the group is opened again (`apps/web/lib/launch.ts`).

## `pnpm keyboard` — a form under a phone keyboard

Four screens ask for people in that same row, and each ends on the act those
people are for — Create, "Continue as …", the scan pair, "Change who you are" —
sitting *below* the row on the scroll. So the scroll that lifts the field over
the keyboard is the same one that can leave the act behind it, and what holds
the two together is a single number, `--act-below`
([touch-and-viewport.md](touch-and-viewport.md#the-screen-and-the-keyboard-over-it)). Nothing else here would notice that number
going stale: a button gains a line, a row gains padding, and the fix is quietly
a few pixels short on a phone nobody in this repo is holding.

There is no keyboard in a headless browser, so one is faked where the app reads
it — `visualViewport.height` — and everything after that is the app's own:
`gapOf` calls the gap a keyboard, `--kb` is paid, and the scroll is the one
`components/viewport.tsx` makes. The assertion is what a thumb cares about, the
field *and* the act still above the top of the keys. The list is ten people
deep on every screen on purpose: three fit above a keyboard whatever the scroll
does, and a check that passes with the fix deleted is worse than none — with
`--act-below` at zero, all five assertions fail.

The confirm key is the other half, and it needs no faking — a headless browser
presses Enter like any other. It walks the two screens the fix is really for,
the split editor's "as amounts" and `/g/payers`, one press per person down a
column of ten, and asserts what a thumb would notice: every row reached, each
one once, and the last of them folding the keyboard rather than wrapping round
to the top. The two assertions that keep the chains apart are the other ones
worth having — the entry form's note folds rather than diving into the column
underneath, and the add row, which is a `<form>`, still files the name and
hands the caret back ([frontend.md](frontend.md#state)).

## `pnpm stall` — a read of this phone's database that dies

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

Then the database is deleted from another connection, which is what a browser
reclaiming storage looks like from inside the page. That half is a smoke test
and says so in the file: it passes with the `close` handler removed too,
because re-opening an absent database happens to wake the reads by itself. It
is there for the property — a forced close must not strand the app on rows that
are no longer there — not for the mechanism.

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

## `pnpm demo` — the demo group, and the key it must not have

The seed's arithmetic is core's own (`demo.test.ts`: the balances clear to zero
under `settle`, every amount is a positive integer minor unit, any permutation
folds identically). What this check asks is what the seed cannot: that
`/demo` lands on a populated ledger rather than a claim gate or an empty
state, that the balances do not cancel, that the mark is at its head, that the
cantina tab opens onto the bill it was itemised from, that **Copy invite link**
refuses out loud, and that clearing a demo somebody has added an entry to
takes the whole group off the phone while the address lays the shipped story
down again — entry for entry, and without the one that was added. A demo
address copied from any `/g` screen opens the demo on a second, fresh phone
rather than "bad link", and does not re-seed it on the phone that cleared it. The dialog
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

## `pnpm homescreen` — the invite that rides onto the home screen

One step of this cannot be checked anywhere but an iPhone: which URL WebKit
writes into the bookmark when someone taps Add to Home Screen
([ios.md](ios.md#a-in-detail)). Everything on either side of
that step can be, and all of it looks fine in jsdom — so the check wears an
iPhone's user agent and drives both ends.

The tab end: a join that is not stopped to ask about installing; no page's
HTML carrying a manifest; the banner — on the groups list, and at a ledger's foot — the first landing on a `/install` whose
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
say it is fetching them rather than that there are none.

**The in-app browser**, last: a webview is turned round rather than joined in,
named, handed the link it arrived with, and writes nothing. Then the half that
matters more — the home-screen app, Brave and DuckDuckGo, whose agents are the
ones a webview's most resembles, each proved *not* refused
([ios.md](ios.md#the-in-app-browser--refused)).

It needs no server beyond the static export: the join screen's own work is
`pnpm claim`'s subject, and what this one asserts is which URL each end reaches.

## `pnpm nav` — where the back arrow goes, and what it leaves behind

The arrow's destination is the half the other checks already stumble over on
their way somewhere else. This one watches **the shape of the history behind
it** — whether the screens you left are still there — which is what the device's
back button reads on the next press. Every assertion
here reads `navigation.entries()` rather than `location`
([ADR-0007](decisions/0007-a-screen-is-a-route.md), `lib/nav.ts`).

Six shapes, each the one a thumb makes: the walk in from the list, where every
door into a group is pushed from `/` so the list stays underneath the ledger;
the balance card, which pushes balances over the ledger, and the arrow on
balances that goes back to it; an entry opened off the ledger, and the Save that
returns to it; the tip jar, whose form has to unwind past the tip screen as
well as itself; a cold load with nothing behind it, where the arrow puts the
parent in this screen's place — the degradation, and the ordinary case of it;
and the press guard on a half-typed form, cancelled outright with the dialog as
the whole of the answer.

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

## `pnpm tricount` — a Tricount link, pasted, all the way to a balanced group

`core/tricount.ts` is tested against the shape exhaustively, and none of those
tests can prove the **wiring**: that the link field is on the import screen,
that the key comes out of what was pasted rather than out of the host, that
WebCrypto makes a key the request carries, and that the plan the reader hands
back builds the group the CSV path would
([data-model.md](data-model.md#reading-a-tricount-back)).

So the fixture is one trip holding both readings that are rules rather than
recoveries — an expense split three ways and a repayment as a `BALANCE` — and
the assertion at the end is the **balances screen**, to the cent, because a
transfer read backwards or an income unflipped shows nowhere else. Then five
refusals, which is where a reader this liberal is most likely to be wrong: not
a link at all, a link that opens nothing, tricount not answering, two
currencies, and an entry whose shares miss by a cent.

**`/api/tricount` is stubbed and everything else is real** — the bargain
`stubScan` makes about Gemini. Tricount publishes no API, so the half that
talks to bunq (`apps/api/src/tricount.ts`) is the half no check can hold. Try a
real link by hand after touching those constants, since nothing here will go
red when bunq moves.

## Gotchas

- **A browser check that asks for a sentence will be rearranged under.** Copy
  is settled by ear here, one word at a time, so a selector naming the words is
  a selector with an expiry date — and nothing runs these on a push. Name what a control
  *is* — its icon, its class, its role — and leave the wording to `copy.ts`.
- **`/g` is both a file and a directory** in the export, so the static server
  must `statSync(p).isFile()` before serving and only then fall through to
  `${file}.html`. Serving the directory hit is an `EISDIR` crash. The harness
  handles it — don't hand-roll another server.
- **A check that needs the installed app has to say so.** The update offer is
  drawn only when `display-mode: standalone` matches, and neither playwright nor
  CDP's media emulation can set that — `asInstalledApp(page)` answers the query
  instead, before the navigation that should see it.
- **Locate by role and id, not by guessed label text.** On `/new` the label is
  "Name"; "Group name" is only the placeholder, so `getByLabel` hangs.
- **Two things must never answer to one accessible name.** A strict-mode
  violation from `getByLabel` is the driver saying what a screen reader would
  find: the same name twice. The add row's button says "Add", so the field
  keeps its own name and the button is reachable by role.
- **Scope row-level clicks to the row.** `getByRole("button", { name: /the
  rest$/i }).first()` hits whichever row is first — filter `.rows .row` by the
  member's name. Getting this wrong seeds a "co-sponsored" expense that quietly
  has one payer, and the shot looks plausible.
- **Nothing gates these, so they rot quietly.** `pnpm check` doesn't run them,
  so a screen change that moves a control or a landing goes in green and is
  found here weeks later. When you move a control, change its role, or change
  where a save lands, grep these scripts for it in the same commit.
- **`page.goto` between screens is a different app.** The app never reloads in
  normal use — every move is one document, back included — so anything the
  browser keeps in memory (where each screen was scrolled,
  `lib/scroll-memory.ts`) is gone the moment a check navigates with `goto`
  instead of pressing what a person would press. A `goto` is for arriving; from
  there, click.
- **`waitForSelector` waits for *visible*, and a `<link>` never is.** Anything
  in the head — the manifest the head's script writes — needs
  `{ state: "attached" }`, or the wait times out and the check reports the app
  broken. Wait at all: `waitForURL` can return before the new page has parsed
  its head, so a manifest read off the landing is a coin toss.
- **A pause is not a wait.** `waitForTimeout(400)` is a bet on how fast the
  machine is, and it was placed on a machine running one check with nothing
  else on it. Wait for the thing itself — the address after a tap, the row in
  `device` the screen writes, the class a flash takes with it — with `PATIENCE`
  as the ceiling. Where what is being out-waited is one of the app's own
  timers, `settle(page, ms)` puts both clocks in the same starved page. The one
  honest pause is the window for proving that *nothing* happened, which has no
  condition to wait for.
- **The app has its own clock, and a starved machine can overrun it.**
  `SWALLOWED_MS` (150ms, `lib/nav.ts`) is how long a going waits before
  deciding its traversal was swallowed and putting the destination in this
  screen's place. On a starved box a traversal that is merely late can land
  after that, and the repair has already replaced: the cost is **one duplicate
  entry, never a wrong screen** — which is why the clock is allowed at all. So
  a check asserting where a repair *landed* is safe, and one asserting the
  **shape of the stack** across a repair is the one that can go red on a busy
  machine and green alone. Say which you are writing. **Nor tap on straight
  away**: a check, unlike a thumb, can push the next screen before the late
  traversal lands, and then it lands on top of that push, taking the page back.
  After a Back that traverses, wait for `navigation.currentEntry.index` to
  drop, as `pnpm offline` does.
- **And a check must not bet on that window either** — a pause sampling the
  "still stuck" moment breaks whenever `SWALLOWED_MS` changes. The stuck moment
  is not worth asserting anyway — in `pnpm nav` §9 `history.go` is stubbed to a no-op, so a traversal
  cannot be what moved the screen, and landing at the destination at all is
  already proof the repair did it. Where the intermediate state genuinely is
  the assertion, **record it instead of sampling it**: §10 hangs a
  `MutationObserver` before the tap and reads the flag afterwards, because the
  repair is quicker than a round trip to ask.
- **A check that hangs fails after five minutes** (`HUNG_MS`, the harness's
  reporter), naming the last thing it reported. Playwright's `close` and
  `bringToFront` take no timeout, and `pnpm offline` under load has hung in its
  teardown for good — before the watchdog, that stalled `pnpm verify` with it.
- **One flake is still open**, rare (none in the last dozen `pnpm verify`s on a
  four-core container), green alone: `pnpm offline` "tap a suggested
  transfer" — the page reaches balances, then is found back on the ledger. Not
  a late Back (the check waits for that now); its failure prints the history
  stack, which is the next clue.
- **Don't edit `apps/web` while `pnpm verify` runs.** Each check calls
  `ensureBuild()` itself, so the ones still queued see stale sources and
  rebuild `out/` under the ones running: a run of red that is none of theirs.
- **Quiet is not done.** A loop that stops when two samples agree has waited
  for quiescence, not the answer: `pnpm offline` read the shell caches that
  way and, on a loaded box, stopped before `activate` had deleted the old one.
  Poll for the state the assertions expect, `PATIENCE` as the ceiling.
- **`setOffline` is the page's network, not the browser's.** The update check
  for `sw.js` goes out anyway — so a lever `offline-check` holds up for one
  section (a forged revision, a blocked asset) is read by an install nobody
  asked for, which then finishes against the server as it is *later*. Put the
  lever back before the navigation that could ask, not when the section reads
  as over — and a forged revision is served once (`swOnce`), since the page's
  own update checks ask too, and under load one lands mid-section.
- **`copy.ts` types its apostrophes.** `getByLabel("Marie's amount")` matches
  nothing against `Marie’s amount` and hangs until the check times out; match
  with a regex (`/Marie.s amount/`) or paste the real character.
