# Testing

*For: anyone touching `packages/core`, or reviewing a screen without a phone.*

```bash
pnpm check       # links · rules · typecheck · 390 tests · export build — pre-push, ~45s
pnpm verify      # every browser check against a real build, ~60s
pnpm entries     # just the three kinds of entry, end to end
pnpm back        # every screen with an arrow, walked back out one press at a time
pnpm offline     # just every screen with the network cut
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

`packages/core` gets real coverage — 249 tests; the bar is in
[CLAUDE.md](../CLAUDE.md#working-agreements). The web app gets 159, and they
are not all smoke: the command layer and `checkEntry` — the two places outside
core where being wrong costs money — are covered in earnest, the screens are
not. `vitest.config.ts` includes `lib/**` *and* `components/**`, which is why
`sanitizeAmount` and `groupDigits` are exported from `amount-input.tsx` rather
than hidden in it. Rendering isn't tested — `pnpm shots` is what looks at
screens.

## What the core suite guarantees

Not a list of test names — the properties they hold, which is what you'd
otherwise have to read 249 tests to learn:

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
offline-check drops an asset and forges a service-worker revision.
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
   `colorScheme` set, 390×844 at `deviceScaleFactor: 2`. Eleven scenes have no URL
   worth visiting and are reached by driving instead: five dialogs (add member,
   forget group, delete entry, a transfer side's person picker, and the rate
   editor), `who-had-what` twice, `expense-split-amounts` (a deliberate
   shortfall) and `payers` — the last two hang off the entry form's in-memory
   draft, so their own URLs photograph an empty frame.

Chromium is at `/opt/pw-browsers/chromium` (override with `CHROMIUM_PATH`);
`playwright-core` is a root devDependency. Never run `playwright install`.

### Gotchas

- **`pnpm` skips esbuild's postinstall by default, which breaks vitest.** The
  root `package.json` carries `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }`.
- **`/g` is both a file and a directory** in the export, so the static server
  must `statSync(p).isFile()` before serving and only then fall through to
  `${file}.html`. Serving the directory hit is an `EISDIR` crash. Fixed once, in
  the harness — don't hand-roll a fourth server.
- **Locate by role and id, not by guessed label text.** On `/new` the label is
  "Name"; "Group name" is only the placeholder, so `getByLabel` hangs.
- **Scope row-level clicks to the row.** `getByRole("button", { name: /the
  rest$/i }).first()` hits whichever row is first — filter `.rows .row` by the
  member's name. Getting this wrong seeds a "co-sponsored" expense that quietly
  has one payer, and the shot looks plausible.
- **Screenshots miss the caret** (it blinks), and JetBrains Mono's zero is
  *slashed*. A mark inside a "0" is the font, not a struck-through field.
- **`copy.ts` types its apostrophes.** `getByLabel("Marie's amount")` matches
  nothing against `Marie’s amount` and hangs until the check times out; match
  with a regex (`/Marie.s amount/`) or paste the real character.
- **`pnpm back` used to be intermittently red, and it was the check.** The
  signature — one press unwinding *two* screens — read like the app's own
  cancellation race, and this file said so. It wasn't: tracing every `navigate`
  event through a whole run showed the walk cancels no press at all, so that
  code never ran. What ran was a blind `waitForTimeout(500)` after each press,
  which could sample mid-answer and, worse, press again while the last answer
  was still settling — Next writes its own `replaceState` a millisecond after
  every traversal. `settle()` waits on the app instead: no
  `navigation.transition` in flight, and the URL unmoved for three polls.
- **A `navigate` listener added by `addInitScript` runs before the app's**, so
  it cannot read `defaultPrevented` in a microtask: the checkpoint runs after
  *each* listener, not after the dispatch. Read it from a `setTimeout(…, 0)`.
  Getting this wrong reports every press as uncancelled — which looks exactly
  like a takeover that has stopped working.
- **A cross-document back press cannot be taken over at all** (`cancelable:
  false`), so a screen opened from a shared link cannot be driven to exercise
  the app's cancellation — the only press in the app that reaches it is the
  whole-group feed opened from one entry's own history
  ([ADR-0007](decisions/0007-a-screen-is-a-route.md)).

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
([ADR-0005](decisions/0005-money-and-currency.md)).

**Wait on state, not on a URL:** a save navigates before Dexie has redrawn, so
every assertion here follows a `waitForFunction` on the row count. Skipping
that is what makes a check like this flake and then get deleted.

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

**Where the keyboard is pointing.** A numbered control wears `(focused)`; when
focus is anywhere else — a sheet that opened without landing it on a row — the
dump says so. `press` is how you reach what a tap cannot, and a key sent nowhere
looks exactly like a control that ignored it.

**Alternatives are read as one question.** A `tablist`, `listbox`, `radiogroup`,
or same-tag siblings painted in two ways come out as a set with the chosen one
marked `(•)`. When only the styling says which, the header says so — a segmented
control that never tells a screen reader which segment is live is a finding, and
this is where it surfaces. Styling answers only from three members up: in a pair
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
- **The daemon holds a browser and a Worker**, and `stop` does not always take
  them with it — it prints `stopped` while `wrangler`/`workerd` keep running.
  Each is a multi-gigabyte process, and enough of them exhaust memory — at which
  point a fresh `start` hangs before it ever writes `.drive/ready.json`. Check
  with `ps` after stopping, and reap what is left.
