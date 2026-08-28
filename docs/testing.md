# Testing

*For: anyone touching `packages/core`, or reviewing a screen without a phone.*

```bash
pnpm --filter @hajsik/core test       # 111 tests, ~1s
pnpm --filter @hajsik/core typecheck
pnpm --filter @hajsik/web test        # 26 smoke tests
pnpm shots                            # 26 PNGs into shots/ (gitignored)
```

`packages/core` gets real coverage — money, splits, folding; the bar is in
[CLAUDE.md](../CLAUDE.md#working-agreements) and what's proven is in
[implementation-status.md](implementation-status.md#what-has-been-proven--tested-not-just-written).
The web app gets smoke tests only; `vitest.config.ts`
includes `lib/**` *and* `components/**`, which is why `sanitizeAmount` and
`groupDigits` are exported from `amount-input.tsx` rather than hidden in it.
Rendering isn't tested — `pnpm shots` is what looks at screens.

## `pnpm shots` — photograph every screen

One browser launch, one PNG per route per theme, no human and no phone. Run it
after building or changing a screen, **not after every edit** — owner's
instruction, [standing-instructions](standing-instructions.md#workflow).

`scripts/shots.mjs`:

1. **Serves the real static export** (`apps/web/out`) over a bare `node:http`
   server rather than `next dev`. The export is what ships, and it has quirks
   `next dev` doesn't.
2. **Seeds a group through the UI** — three members, four expenses and an edit —
   by driving real screens, not poking IndexedDB. Each expense earns its place:
   a plain one, a co-sponsored one, one somebody else paid that you owe a share
   of, and one that leaves you out (the last two are what personal mode is
   *for*); the edit gives history a revision that isn't a create. It buys a
   harness that fails loudly when a screen it isn't even photographing breaks.
3. **Walks the routes in both themes** via two `newContext()`s with
   `colorScheme` set, 390×844 at `deviceScaleFactor: 2`. Three scenes are
   reached by driving instead of by URL: `/g/restore` (its URL carries an HLC),
   `settle`, and `expense-split-amounts` (a deliberate shortfall).

Chromium is at `/opt/pw-browsers/chromium` (override with `CHROMIUM_PATH`);
`playwright-core` is a root devDependency. Never run `playwright install`.

### Gotchas

- **`/g` is both a file and a directory** in the export, so the static server
  must `statSync(p).isFile()` before serving and only then fall through to
  `${file}.html`. Serving the directory hit is an `EISDIR` crash.
- **Locate by role and id, not by guessed label text.** On `/new` the label is
  "Name"; "Group name" is only the placeholder, so `getByLabel` hangs.
- **Scope row-level clicks to the row.** `getByRole("button", { name: /the
  rest$/i }).first()` hits whichever row is first — filter `.rows .row` by the
  member's name. Getting this wrong seeds a "co-sponsored" expense that quietly
  has one payer, and the shot looks plausible.
- **Screenshots miss the caret** (it blinks), and IBM Plex Mono's zero is
  *dotted*. A mark inside a "0" is the font, not a struck-through field.

## Real two-device testing — for sync/join bugs

A mocked `fetch` proves the protocol but can't catch a bug in how two real
devices interleave, which is exactly the shape `/join` had
([sync.md](sync.md#gotchas)). When a report smells like "works for a device that
already has state, breaks for one that doesn't", stand up the real stack:

```bash
pnpm --filter @hajsik/web build
cd apps/api
npx wrangler d1 migrations apply hajsik --local   # once, or after a schema change
npx wrangler dev --port 8787                      # real ASSETS + DB bindings
```

Drive it with `playwright-core` (install ad hoc, `--no-save`, in a scratch
directory — it's a debugging tool, not app code). One `newContext()` per
"device" gives each its own IndexedDB, the part a single-context test can't
simulate: `ctxA` creates the group and reads its secret straight out of the
`groupKeys` store instead of fighting the clipboard; `ctxB` is a brand-new
context with no storage — the "never used the app before" device the bug reports
care about. Force fail-then-recover with `page.route()`, not
`context.setOffline()`, which also blocks the initial page load.
