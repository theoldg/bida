# Testing

*For: anyone touching `packages/core`, or reviewing a screen without a phone.*

```bash
pnpm check        # links · rules · version · typecheck · tests · export build — pre-push, ~30s
pnpm verify       # every browser check against a real build, together, ~50s
pnpm entries      # just the three kinds of entry, end to end
pnpm claim        # a name still being typed, and the button that acts on it
pnpm keyboard     # the act a list of names is typed for, against an open keyboard
pnpm offline      # just every screen with the network cut
pnpm stall        # what a screen does when reading this phone's database stops working
pnpm homescreen   # the invite an iOS icon is added with, both ends of it
pnpm shots        # PNGs into shots/ (gitignored)
pnpm readme-shots # the six pictures in README.md, into docs/media/ (committed)
pnpm drive        # drive the app as text — [drive.md](drive.md)
pnpm run docs     # links resolve, ADRs indexed, claude_corner within size, ~30ms
pnpm run rules    # core is still pure, no browser dialogs crept back, ~30ms
pnpm bump         # the number this deploy will show — [hosting.md](hosting.md#versions)
```

**The browser checks build for themselves.** `ensureBuild()` compares `apps/web`
and `packages/core` against `apps/web/out` and runs the build only when it is
missing or stale — so none of them needs a build step in front of it, and none
of them wastes 25 seconds when nothing has changed. `pnpm verify` does that
build once and then runs all six together (`scripts/verify.mjs`): they share
nothing to collide over, each serving the export on its own port 0, and the
build is the one thing six of them starting at once would have raced on.

`pnpm check` is the gate — nothing else stands between an edit and production,
so the three things that gate nothing else are in it. The build, because `next
build` catches what `tsc` cannot (a prerender touching `window`, a
client-boundary mistake, a `precache.mjs` that throws) and the deploy workflow
only rebuilds and ships, so a build that fails there fails on `main`. And
`pnpm run rules`, because a decision in an ADR is one careless import away
from being reversed by someone who never read it: it fails on an import or a
`Date.now()` in `packages/core`, and on a `prompt`/`confirm`/`alert`/`<select>`
in `apps/web` ([ADR-0008](decisions/0008-hand-rolled-interface.md)). The bar for
a fourth rule is in the script: written down as a decision, reversible in one
line, invisible to every test. Style isn't on the list — there is no linter here
on purpose. And the version, because a push to `dev` deploys and a deploy has to
show a new number: the stage fails a tree that differs from what `dev` is serving
and still calls itself the same thing ([hosting.md](hosting.md#versions)). CI
cannot check that one — it clones shallow, with no `dev` to compare against.

**A pass is stamped and not repeated.** The stamp is a hash of every file git
tracks or would track, plus the env files it ignores and the build reads
(`scripts/lib/check-stamp.mjs`), so `pnpm check` then `git push` runs the gate
once — and committing in between does not invalidate it, because the contents
are what is hashed and they did not move. Anything that did move re-runs it;
`pnpm check --force` re-runs it regardless.

**Its six stages run at once** (`scripts/check.mjs`), because none of them
reads what another writes — so the gate costs the slowest one, the build, and
not the sum. Each keeps its output instead of printing it: a pass is six lines
and a digest, a failure spills only the stages that failed and names the
`pnpm run <stage>` that reproduces each alone. Nothing stops at the first
failure, so one run tells you everything that is broken.

The flip side: **the browser checks below gate nothing**, so one can go red and
stay red. `pnpm entries` spent a commit asserting a string the copy had since
recapitalised. Run `pnpm verify` after touching a screen, not only when
something feels wrong.

`packages/core` gets real coverage; the bar is in
[CLAUDE.md](../CLAUDE.md#working-agreements). The web app gets less, and not all
of it is smoke: the command layer, `checkEntry` and the split tabs' own
inputs — where being wrong outside core costs money — are covered in earnest,
the screens are not. The merge rule itself has its own suite (`lib/db/commands/patch.test.ts`),
because reaching it only through a saved entry is how the two entry editors
came to disagree about it. `vitest.config.ts` includes `lib/**` *and* `components/**`, which is why
`sanitizeAmount` and `groupDigits` are exported from `amount-input.tsx` rather
than hidden in it. Rendering isn't tested — `pnpm shots` is what looks at
screens.

## What the core suite guarantees

Not a list of test names — the properties they hold, which is what you'd
otherwise have to read the whole suite to learn:

- **Money never floats.** BigInt internals, half-away-from-zero rounding, ISO
  4217 exponent overrides (JPY 0, TND 3, CLF 4).
- **Every split sums to the total exactly**, all modes, 500 randomised cases
  plus hand-picked edges, and identically on every device (remainders by
  largest fractional part, ties broken by a seeded hash — no clock, no
  iteration order).
- **Any permutation of the same ops folds to the same state**; a late-arriving
  op is detected (`foldForward` → `null`, caller rebuilds).
- **`settleUp` clears every balance to zero**, 300 randomised groups, and uses
  **the fewest transfers possible** — checked against a brute-force minimum
  written a different way, over 2,000 randomised groups of four shapes (a few
  repeated amounts, all different, two amounts, wide random). That differential
  is what caught the search missing pieces that held two people owing the same;
  keep all four shapes if you touch it.
- **HLCs are totally ordered by string comparison**, and a peer's stamp is
  absorbed on receive however far ahead it reads — so a reply to their op
  always sorts after it.
- **Payer and consumer sides both sum to `baseAmountMinor` exactly**, including
  a payer who isn't a participant.
- **An income is exactly the negation of the same entry as an expense**, member
  for member, and is counted apart from spend rather than netted into it.
- **Every declared invariant has a healer that works.** Each entry in
  `core/invariants.ts` detects its state, repairs it in one pass, writes nothing
  on a second run, writes the same repair whatever order the ops arrived in,
  and reaches a fixed point. A registry entry with no violating scenario fails
  the suite, so an invariant whose healer has never run cannot be added.
- **Hostile merges leave no live entry naming a removed member or currency.**
  `integrity.test.ts` folds permutations no single device would write and
  asserts the properties without naming a healer — the layer that catches an
  invariant nobody declared. References that move money are checked for
  liveness; everything else only for existence, because an `identity` claim
  pointing at a removed member is a historical fact history needs.
- **A rate inverts and comes back.** 12 stored significant digits against 6
  shown, so a rate typed as its own inverse round-trips; repricing at the rate
  an entry was saved with is a no-op, and a rate that can't convert leaves the
  entry as it was instead of throwing on a render.

### The pinned fixture

`fixtures.test-helper.ts` builds a four-person Marrakech trip. The numbers
below are the ones it asserts — if `balance.test.ts` fails, this doc is out of
date, not the code.

```
net: ada −244,56  marie +461,65  sam −111,47  theo −105,62   (EUR minor ×100)
total spend 963,14 · transfers theo→marie 105,62 · sam→marie 111,47 · ada→marie 244,56
```

## `scripts/lib/harness.mjs` — what the browser checks share

A build, a server that speaks the static export's dialect, a phone-shaped
browser, a pass/fail tally that owns the exit code, and a seeded group. Written
three times they drifted; written once, the next check costs a dozen lines:

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

## `pnpm shots` — photograph every screen

One browser launch, one PNG per route per theme, no human and no phone. Run it
after building or changing a screen, **not after every edit** — owner's
instruction, [standing-instructions](standing-instructions.md#workflow).

`scripts/shots.mjs`:

1. **Serves the real static export** (`apps/web/out`) rather than `next dev`.
   The export is what ships, and it has quirks `next dev` doesn't.
2. **Seeds a group through the UI** — three members, four expenses and an edit —
   by driving real screens, not poking IndexedDB. Each expense earns its place:
   a plain one, a co-sponsored one, one somebody else paid that you owe a share
   of, and one that leaves you out (the last two are what the personal lens is
   *for*); the edit gives history a revision that isn't a create. It buys a
   harness that fails loudly when a screen it isn't even photographing breaks.
3. **Walks the routes in both themes** via two `newContext()`s with
   `colorScheme` set, 390×844 at `deviceScaleFactor: 2`. Fourteen scenes have no URL
   worth visiting and are reached by driving instead: five dialogs (add member,
   forget group — from the groups list's row menu — delete entry, a transfer
   side's person picker, and the rate editor), `who-had-what` twice, `expense-split-amounts` (a deliberate
   shortfall), `payers`, and the three of a quick split (people, grid, answer)
   — every one of them hangs off an in-memory draft, so its own URL
   photographs an empty frame.

Chromium is at `/opt/pw-browsers/chromium` (override with `CHROMIUM_PATH`);
`playwright-core` is a root devDependency. Never run `playwright install`.

## `pnpm readme-shots` — the six pictures in the README

`scripts/readme-shots.mjs` walks the same UI with the opposite brief. `shots`
leans on states worth catching — a split that doesn't add up, a payer who
overpaid, a server that can't be reached; a stranger deciding whether to open
the app should see none of those, so this one seeds a trip that adds up in
prices a person might actually pay, and photographs two rows of three: the app
a Tricount user already expects (ledger, balances, adding an expense) over the
part they came for (a scan mid-read, the who-had-what grid, and the saved
expense read back line by line).

The scan's bar is a CSS animation on a wall clock, so `waitForTimeout` would
photograph a different fraction on every machine: the request is routed into a
hole and the animation is paused at a fixed progress instead (`freezeScanBar`).
The two after it need a scan that *answers*, which is `stubScan` and the same
canned bill `pnpm drive` uses.

Two differences that are the whole reason it is a second script:

- **It serves the real Worker** (`serveWorker`), not the export. Against a
  static server every push 404s and the ledger wears "Can't reach the server",
  which is the first thing a reader would see. That costs ~10s of `wrangler
  dev` boot, and `settled()` waits for the banner to be gone rather than for a
  timeout.
- **Its output is committed.** `shots/` is gitignored, so a README cannot point
  at it; `docs/media/` is not. Re-run and commit what moves when one of the
  six screens changes.

### Gotchas

- **A shot wears the harness's locale and clock.** Left at Playwright's
  defaults, every entry carried whatever hour the container was at — a
  restaurant bill stamped 00:11, a different silly hour every run. The context
  sets `locale`, `timezoneId` and a resumed `clock.install`, so the trip is
  always photographed at dinner time.
- **`pnpm` skips postinstall scripts by default, which breaks vitest and
  `wrangler dev`.** The root `package.json` carries
  `"pnpm": { "onlyBuiltDependencies": ["esbuild", "workerd"] }`; anything that
  needs to build on install goes in that list or it silently does not.
- **Never probe ciphertext for a short word.** The "nothing readable crossed the
  wire" checks (`core/seal.test.ts`, `lib/db/sync.test.ts`) look for plaintext
  in a sealed body; base64 is 64 symbols, so `"EUR"` turns up in a few hundred
  random characters about once in fifty runs. Probes are seven characters or
  longer, and the exact envelope key set is what actually pins the shape down.
- **`/g` is both a file and a directory** in the export, so the static server
  must `statSync(p).isFile()` before serving and only then fall through to
  `${file}.html`. Serving the directory hit is an `EISDIR` crash. Fixed once, in
  the harness — don't hand-roll a fourth server.
- **A check that needs the installed app has to say so.** The update offer is
  drawn only when `display-mode: standalone` matches, and neither playwright nor
  CDP's media emulation can set that — `asInstalledApp(page)` answers the query
  instead, before the navigation that should see it. Four assertions in
  `offline-check` sat red for a day because the offer they tap had quietly
  become installed-only.
- **Locate by role and id, not by guessed label text.** On `/new` the label is
  "Name"; "Group name" is only the placeholder, so `getByLabel` hangs.
- **Two things must never answer to one accessible name.** The add row's button
  once carried the field's own label, and `getByLabel("Add someone")` died of a
  strict-mode violation — which is the driver saying what a screen reader would
  have found: the same name twice. It says what it does instead — "Add" — so the
  field keeps its own name and the button is reachable by role.
- **Scope row-level clicks to the row.** `getByRole("button", { name: /the
  rest$/i }).first()` hits whichever row is first — filter `.rows .row` by the
  member's name. Getting this wrong seeds a "co-sponsored" expense that quietly
  has one payer, and the shot looks plausible.
- **Screenshots miss the caret** (it blinks), and JetBrains Mono's zero is
  *slashed*. A mark inside a "0" is the font, not a struck-through field.
- **A `::placeholder` is not rendered while its field has text**, so it is
  *created* when the field goes empty — and a freshly created pseudo-element
  starts any animation still declared on it. Leaving a one-shot animation class
  on a settled field replays it every time the field is emptied. Take the class
  off on `animationend`; `e.pseudoElement` says whether the event came from the
  element or its placeholder.
- **Nothing gates these, so they rot quietly.** `pnpm check` doesn't run them,
  so a screen change that moves a control or a landing goes in green and is
  found here weeks later. Three did at once: the multi-payer door became a
  `<button>` held shut until there is an amount, so `getByRole("link")` hung;
  and saving now returns you where you came from — the balances tab, an entry's
  own screen — so a wait for the ledger's rows timed out on a page that had
  none. When you move a control or change where a save lands, grep these
  scripts for it in the same commit.
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
- **`copy.ts` types its apostrophes.** `getByLabel("Marie's amount")` matches
  nothing against `Marie’s amount` and hangs until the check times out; match
  with a regex (`/Marie.s amount/`) or paste the real character.

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
from the keyboard, because one press was landing as two writes and a `click()`
cannot reproduce that — it waits for a settled screen in between, which is
exactly the window the second tap arrives in. It holds rows with real touch, too, since a right
click is not what an iPhone sends: a hold opens one menu that its own lifting
click and Android's `contextmenu` leave open, and a tap, a scroll, a tap just
after and Enter all still navigate.

**Wait on state, not on a URL:** a save navigates before Dexie has redrawn, so
every assertion here follows a `waitForFunction` on the row count. Skipping
that is what makes a check like this flake and then get deleted.

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
group is the press this pair was written for: a document that loaded on `/join`
never drew the list, and its first arrival there was read as a launch, so the
app walked straight back into the group. Then the app is launched, which
reopens the group last open, while backing out of that one must leave the list
alone — and must be remembered, so the launch after it lands on the list until
the group is opened again (`apps/web/lib/launch.ts`).

## `pnpm keyboard` — the act under the add row, against an open keyboard

Four screens ask for people in that same row, and each ends on the act those
people are for — Create, "Continue as …", the scan pair, "Change who you are" —
sitting *below* the row on the scroll. So the scroll that lifts the field over
the keyboard is the same one that can leave the act behind it, and what holds
the two together is a single number, `--act-below`
([frontend.md](frontend.md#gotchas)). Nothing else here would notice that number
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

## `pnpm stall` — a read of this phone's database that dies

The defect it was written for is the one no screen could report: an installed
Android app hanging on its skeleton rows, indefinitely, with nothing in the
console ([frontend.md](frontend.md#a-live-read-can-die)). Two halves.

`indexedDB.open` is stubbed to return a request that never fires an event —
what a wedged backing store or a blocked upgrade does, and what nothing in
Dexie times out against. The skeleton is expected, and then the notice over it
is. Measured against the app with the watchdog taken out, the second assertion
fails, which is what makes it a check rather than a screenshot.

It also opens `/diag` while the database is still wedged and fails unless the
readout names what never came back. A diagnostics screen that hangs on the
fault it reports is worse than none, and that is what the first one did.

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
and a cross-document traversal rebuilds the head by itself, which left the
first of these green with the reload switched off.

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
