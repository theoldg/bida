# Testing

*For: anyone touching `packages/core`, or wanting to review a screen without a
human looking at a phone.*

## `packages/core` — real unit tests

Pure functions over plain data get real coverage, especially money, splits,
and op folding. This is what actually exists and passes today:

```bash
pnpm install
pnpm --filter @hajsik/core test          # 111 tests, ~1s
pnpm --filter @hajsik/core typecheck
```

See [implementation-status.md](implementation-status.md#what-has-actually-been-proven)
for what's specifically covered.

## `apps/web` — smoke tests only

UI gets smoke tests, not exhaustive coverage — see
[standing-instructions.md](standing-instructions.md). `pnpm --filter @hajsik/web
test` runs 26 of them. `vitest.config.ts` includes `lib/**/*.test.ts` **and**
`components/**/*.test.ts` — pure logic that happens to live beside a component
still gets real tests, which is why `sanitizeAmount` and `groupDigits` are
exported from `components/amount-input.tsx` rather than hidden inside it.
Rendering is not tested here; `pnpm shots` is what looks at screens.

## `pnpm shots` — photograph every screen

```bash
pnpm shots        # builds apps/web, then writes 26 PNGs into shots/ (gitignored)
```

One browser launch, one PNG per route per theme, no human and no phone. Run it
after building or changing a screen, or when something looks wrong — **not after
every edit**; that's the owner's instruction, see
[standing-instructions.md](standing-instructions.md#keep-a-screenshot-loop-and-dont-lean-on-it).

`scripts/shots.mjs` does three things:

1. **Serves the real static export** (`apps/web/out`) over a bare `node:http`
   server rather than running `next dev`. The export is what actually ships, and
   it has quirks `next dev` doesn't.
2. **Seeds a group through the UI** — "Marrakech", three members, four expenses
   and one edit — by driving the real screens, not by poking IndexedDB. Each
   expense earns its place: a plain one, a co-sponsored one, one somebody else
   paid that you owe a share of, and one that leaves you out entirely. The last
   two are what personal mode is *for*, so a shot without them cannot show it
   working — one row red, one faded to "not yours". The edit is there so the
   history screens have a revision that isn't a create: a diff to render, and a
   version worth offering to restore.
   That costs a few seconds and buys a lot: the harness fails loudly when a
   screen it isn't even photographing breaks, and every shot shows a populated
   ledger instead of an empty state.
3. **Walks the routes in both themes** via two `newContext()`s with
   `colorScheme` set, at a 390×844 mobile viewport with `deviceScaleFactor: 2`.
   `/g/restore` is the one screen not in that list: its URL carries an HLC, so
   it is reached by pressing the rewind on a real revision. Two more scenes are
   reached the same way, by driving to a state a URL alone can't express:
   `settle` (open the first suggested settlement from the balances tab) and
   `expense-split-amounts` (a 120 expense split *as amounts* with only 25
   allocated, so the shortfall line has something to say).

Chromium comes from `/opt/pw-browsers/chromium` (override with `CHROMIUM_PATH`);
`playwright-core` is a root devDependency. Never run `playwright install`.

### Gotchas

- **`/g` is both a file and a directory** in the export (`out/g.html` and
  `out/g/` holding the child routes), so the static server has to check
  `statSync(p).isFile()` before serving a path and only then fall through to
  `${file}.html`. Serving the directory hit is an `EISDIR` crash.
- **Locate by role and id, not by guessed label text.** On `/new` the label is
  "Name" and "Group name" is only the *placeholder*, so `getByLabel("Group
  name")` hangs for the full timeout.
- **Scope row-level clicks to the row.** `getByRole("button", { name: /the
  rest$/i }).first()` in the payers editor hits whichever row is first, not the
  one you meant — filter `.rows .row` by its member's name first. Getting this
  wrong seeds a "co-sponsored" expense that quietly has one payer, and the shot
  looks plausible.
- **Screenshots miss the caret** (it blinks), and IBM Plex Mono's zero is
  *dotted*. A "0" with a mark in the middle of it in a shot is the font, not a
  struck-through field.

## Real two-device testing — for sync/join bugs specifically

A mocked `fetch` (`apps/web/lib/db/sync.test.ts`) proves the sync *protocol*,
but it can't catch a bug that only exists in how two real devices interleave —
which is exactly the shape of bug that `/join` had (see
[sync.md's gotchas](sync.md#gotchas)). When a bug report smells like "works for
a device that already has state, breaks for one that doesn't," don't reason
about it in the abstract — stand up the real stack and drive two browser
contexts against it:

```bash
pnpm install
pnpm --filter @hajsik/web build                 # apps/web/out, real static export
cd apps/api
npx wrangler d1 migrations apply hajsik --local  # once, or after a schema change
npx wrangler dev --port 8787                     # serves apps/web/out + the API + local D1
```

That's the real `ASSETS` + `DB` bindings from `apps/api/wrangler.toml` — not a
mock. Drive it with `playwright-core` against the Chromium already on disk at
`/opt/pw-browsers/chromium` (no `playwright install`; `playwright-core` isn't
a project dependency — install it ad hoc with `npm install playwright-core
--no-save` in a scratch directory, it's a debugging tool, not app code). One
`browser.newContext()` per "device" gives each its own IndexedDB, which is the
part a single-context test can't simulate: `ctxA` creates the group and reads
its invite secret straight out of IndexedDB (`indexedDB.open('hajsik')` →
`groupKeys` store) instead of fighting `navigator.clipboard`/`share`; `ctxB` is
a **brand-new context with no storage at all** — that's the "never used the
app before" device the bug reports care about. `page.route()` can force one
device's API calls to fail-then-recover to test reconnect behaviour, which is
more precise than `context.setOffline()` (that also blocks the initial page
load, which isn't what a real "signal drops mid-sync" looks like).
