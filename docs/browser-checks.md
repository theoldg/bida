# Browser checks

*For: anyone writing, fixing or reading a browser check. Part of the
[testing](testing.md) docs, which say how `pnpm verify` runs them on GitHub at
every push, and why nothing waits on them but the pusher. What each check is
*for* is in the doc for its area ([the checks](#the-checks)); [Writing a check
that holds](#writing-a-check-that-holds) is what every one of them has had to learn.*

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

## The checks

Each is a file in `scripts/checks/`, run alone as `pnpm verify <name>`. What each
holds, and why it is built the way it is, is in the doc for its area:

| Check | Holds | Doc |
|---|---|---|
| `join` | Every way into a group lands on its screen, with every tap a full load | [the ways in](checks-ways-in.md#pnpm-verify-join--every-way-in-across-a-full-load) |
| `homescreen` | The invite that rides onto the iOS home screen; the in-app browser's banner | [the ways in](checks-ways-in.md#pnpm-verify-homescreen--the-invite-that-rides-onto-the-home-screen) |
| `demo` | The demo group, and the key it must not have | [the ways in](checks-ways-in.md#pnpm-verify-demo--the-demo-group-and-the-key-it-must-not-have) |
| `nav` | Where the back arrow goes, and the history it leaves behind | [moving around](checks-moving.md#pnpm-verify-nav--where-the-back-arrow-goes-and-what-it-leaves-behind) |
| `search` | The ledger's search bar in every state, frame by frame | [moving around](checks-moving.md#pnpm-verify-search--where-the-search-bar-is-and-the-list-under-it) |
| `entries` | The entry form reaches the commands; holds and taps as a phone sends them | [the forms](checks-forms.md#pnpm-verify-entries--the-form-is-wired-to-the-commands) |
| `keyboard` | A form's field and its act above a phone keyboard; Enter down a column | [the forms](checks-forms.md#pnpm-verify-keyboard--a-form-under-a-phone-keyboard) |
| `offline` | Every screen with the network cut; deploys, good and bad | [storage and updates](checks-storage.md#pnpm-verify-offline--the-built-app-with-the-network-cut) |
| `stall` | A read of this phone's database that never answers | [storage and updates](checks-storage.md#pnpm-verify-stall--a-read-of-this-phones-database-that-dies) |

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
