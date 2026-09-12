# Testing

*For: anyone touching `packages/core`, or reviewing a screen without a phone.*

```bash
pnpm check       # links · rules · typecheck · tests · export build — pre-push, ~45s
pnpm verify      # every browser check against a real build, ~60s
pnpm entries     # just the three kinds of entry, end to end
pnpm claim       # a name still being typed, and the button that acts on it
pnpm offline     # just every screen with the network cut
pnpm stall       # what a screen does when reading this phone's database stops working
pnpm shots       # PNGs into shots/ (gitignored)
pnpm drive       # drive the app as text, one command at a time — see below
pnpm run docs    # every relative link resolves, every ADR is indexed, ~30ms
pnpm run rules   # core is still pure, no browser dialogs crept back, ~30ms
```

**The browser checks build for themselves.** `ensureBuild()` compares `apps/web`
and `packages/core` against `apps/web/out` and runs the build only when it is
missing or stale — so none of them needs a build step in front of it, and none
of them wastes 25 seconds when nothing has changed.

`pnpm check` is the gate — nothing else stands between an edit and production,
so the two things that gate nothing else are in it. The build, because `next
build` catches what `tsc` cannot (a prerender touching `window`, a
client-boundary mistake, a `precache.mjs` that throws) and the deploy workflow
only rebuilds and ships, so a build that fails there fails on `main`. And
`pnpm run rules`, because a decision in an ADR is one careless import away
from being reversed by someone who never read it: it fails on an import or a
`Date.now()` in `packages/core`, and on a `prompt`/`confirm`/`alert`/`<select>`
in `apps/web` ([ADR-0008](decisions/0008-hand-rolled-interface.md)). The bar for
a fourth rule is in the script: written down as a decision, reversible in one
line, invisible to every test. Style isn't on the list — there is no linter here
on purpose.

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
- **`settleUp` clears every balance to zero**, 300 randomised groups.
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
total spend 963,14 · transfers ada→marie 244,56 · sam→marie 111,47 · theo→marie 105,62
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

### Gotchas

- **`pnpm` skips esbuild's postinstall by default, which breaks vitest.** The
  root `package.json` carries `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }`.
- **Never probe ciphertext for a short word.** The "nothing readable crossed the
  wire" checks (`core/seal.test.ts`, `lib/db/sync.test.ts`) look for plaintext
  in a sealed body; base64 is 64 symbols, so `"EUR"` turns up in a few hundred
  random characters about once in fifty runs. Probes are seven characters or
  longer, and the exact envelope key set is what actually pins the shape down.
- **`/g` is both a file and a directory** in the export, so the static server
  must `statSync(p).isFile()` before serving and only then fall through to
  `${file}.html`. Serving the directory hit is an `EISDIR` crash. Fixed once, in
  the harness — don't hand-roll a fourth server.
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
exactly the window the second tap arrives in.

**Wait on state, not on a URL:** a save navigates before Dexie has redrawn, so
every assertion here follows a `waitForFunction` on the row count. Skipping
that is what makes a check like this flake and then get deleted.

## `pnpm claim` — the name that has not been filed yet

The add row lets a name be typed and not yet filed, and only its own plus files
one (`components/name-adder.tsx`). What goes wrong there is never arithmetic: a
blur that must do nothing, a plus that must be dead on a name the list already
holds, and a screen whose button must not read intent out of a field nobody has
pressed anything on. All of it looks perfect in jsdom.

So the press is made by hand and **held**: `locator.click()` re-resolves the
button and quietly retries a press that missed, and an instant down-up is over
before React has re-rendered, so either shortcut reports a green on a build
where the press and the screen disagree about what is under the finger. Both
doors are walked, because their add rows differ where it matters — on `/new`
the list is state and grows in the same tick, on `/g/claim` it is a Dexie write
that arrives whenever it arrives, and the tick has to follow it there.

It ends on the other half of that question: a phone that has answered it is
never asked again. The invite link is copied out of People and opened a second
time — it must land in the group, not back on the picker — and the app is
launched, which reopens the group last open, while backing out of that group
must leave the list alone — and must be remembered, so the launch after it
lands on the list until the group is opened again (`apps/web/lib/launch.ts`).

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

## `pnpm drive` — the app as text

A live session you send one command at a time and that answers with the screen
written out in words — reproducing a bug, checking a screen, watching two phones
disagree, all in a terminal without a screenshot. Stress-test any nontrivial
behaviour here before calling it done — owner's instruction,
[standing-instructions](standing-instructions.md#workflow) — and what it turns
up is usually the test worth writing.

```bash
pnpm drive start &                                   # holds the session open
pnpm drive do "as ana goto /" "click 3" "fill 2 Lisbon"
pnpm drive stop
```

| | |
|---|---|
| `as <who>` | switch phone, creating it on first mention |
| `goto <path>` · `back` · `forward` · `reload` | move around |
| `click <n>` · `fill <n> <text>` · `select <n> <label>` · `press <Key> [times]` | act on the numbered control the last screen handed you |
| `type <n> <text>` | key it in one character at a time — `fill` sets a value in one go, which never runs the amount field's regrouping or its caret |
| `hold <n>` | long-press — the only way to the row menus |
| `offline on\|off` | cut this phone's network, or restore it |
| `receipt <name>` · `receipt list` · `receipt off` | hand this phone a canned bill, so the next scan reads it |
| `clipboard` | read what the page copied — how the invite link travels |
| `screen` · `wait <ms>` | look again, or give something time to settle |
| `forget` | throw this phone away and start it factory-fresh |
| `html [n]` | markup and computed style, for calibrating the reader |

**Two devices are two names.** Each phone is its own `newContext()` — its own
IndexedDB, the part a single-context test cannot simulate — and `serveWorker()`
puts a real Worker and D1 behind them, so `ana` and `bruno` sync through the API
rather than a mock. That is the stack the `/join` bug needed
([sync.md](sync.md#gotchas)): `ana` creates the group, `clipboard` yields the
invite link, `bruno` opens it on a phone with no storage at all — the "never used
the app before" device the bug reports care about.

**A figure shown beside a balance has to be able to reach it.** Two of the three
defects a blind walk turned up were a screen stating part of an arithmetic it
presented as the whole: a balance summary missing the transfer leg, and a split
asking for an amount that was typed but unconvertible. Neither is caught by a
test of the arithmetic, which was right both times.

**A scan can be driven without a camera or a key.** `receipt <name>` arms the
phone rather than the screen — the same family as `offline` — and the scan
button is still the app's own, pressed by number: the hidden file input opens a
real chooser, this answers it with a real (1×1) image the client really
downscales, and only the round trip to Gemini is faked. It is the one way to
reach the who-had-what grid — by either door, the entry form's or a quick
split's — since a scanned bill lives in an in-memory draft and cannot be
seeded by poking storage.

The bills are `scripts/fixtures/receipts/*.json`, shared with `pnpm shots`, and
each declares in `exercises` the verdict it is for — `ok`, `rejected`,
`mismatch`, `busy`. One of them (`two-for-one`) carries two deductions and a
tax, which are the grid's rows with no cells. That claim is checked against `checkScan` itself by
`lib/scan/fixtures.test.ts` on every `pnpm check`, so a bill that quietly stops
adding up fails the suite instead of testing nothing. Adding one is a file; the
test tells you if its arithmetic is wrong.

**It runs as a daemon** because replaying the whole story to take one more step
loses what makes these bugs bugs — IndexedDB, the service worker, a group's
accumulated history. Its state lives in `.drive/`, gitignored.

### What the reader shows you

Its first use is the one it is shaped by — handing an agent the app the way a
stranger gets it, so it has to work the screen out rather than read the source.
So it offers no vocabulary from the app: no `#g-name`, no `newGroup`, only
numbers. Four rules separate it from dumping `innerText`, each one a wrong
answer it gave before:

- **Layout decides the lines, not tags.** The app writes `<span>` with
  `display:block`, which a tag list read as `Split3 people`.
- **What a sheet covers is not on the screen.** With one open, only what is
  inside it is numbered; the rest is counted as out of reach, and the text under
  the scrim is dropped. `:modal` answers this for a `<dialog>`; the row menu is
  a fixed veil with a `role="menu"` beside it and no dialog at all, so a scrim
  is also recognised by hit-testing the centre of the screen.
- **A phone is 844px tall.** What is below the fold is marked a scroll away.
- **CSS is also text.** `text-transform` is what a person reads (`LEDGER`, not
  `Ledger`), `text-overflow` is what they never get to (`…`), and
  visually-hidden text is read out by screen readers but is not on the page, so
  it is left out.

**A control that says it is the chosen one** — a picked row, the page you are
on — wears `(chosen)`. Inside a set the `(•)` says it instead, and saying it
twice reads as two claims. What is only painted that way says nothing here, on
purpose: that is the finding.

**Where the keyboard is pointing.** A numbered control wears `(focused)`; when
focus is anywhere else — a sheet that opened without landing it on a row — the
dump says so. `press` is how you reach what a tap cannot, and a key sent nowhere
looks exactly like a control that ignored it.

**Alternatives are read as one question.** A `tablist`, `listbox`, `radiogroup`,
or same-tag siblings painted in two ways come out as a set with the chosen one
marked `(•)`. When only the styling says which, the header says so — a segmented
control that never tells a screen reader which segment is live is a finding, and
this is where it surfaces. Members of one set are labelled alike, which is what
separates a segmented control from a control standing between two fields: the
transfer's two sides and the swap button between them are three buttons painted
two ways, and were read out as a question whose answer was the swap. Styling
answers only from three members up: in a pair
each differs from the other and nothing makes one the odd one out, so a pair with
nothing in ARIA is read as `nothing marked as chosen` rather than guessed at.

### Gotchas

- **Numbers are only good until the next screen**, like a person looking away.
  Every answer renumbers; never reuse a number across two commands blind. A
  failed command stops the rest of its `do` for the same reason — the commands
  behind it were written against a screen that never arrived, and the answer
  says `not run` rather than pressing whatever is wearing the number now.
- **Read a whole answer, not its tail.** The banner that says what state a phone
  is in — offline, changes waiting, link rejected — is the first line, above the
  back arrow, and `| tail` cuts exactly it.
- **`offline on` cuts the page load too.** Cut the network after a phone has the
  app, not before, or you are testing a blank tab rather than the offline app.
- **`html` is the one deliberate cheat.** It is for building the reader, not for
  using it; reading it during a blind run defeats the point.
- **Don't run `pnpm check` while a session is open.** It rebuilds `apps/web/out`
  under the running Worker, which then serves 404 for every path — including the
  app shell, so the next `goto` fails with an HTTP error that looks like a bug
  in the app. Restart the daemon after any build. A `git push` counts: pre-push
  runs `pnpm check`.
- **The daemon holds a browser and a Worker**, and `stop` takes both with it:
  `serveWorker` spawns `wrangler` detached and signals the process group, so the
  `workerd` underneath it goes too. It used to survive, and enough survivors
  exhaust memory — at which point a fresh `start` hangs before it ever writes
  `.drive/ready.json`. If a start ever hangs, that is still the first thing to
  check with `ps`.
