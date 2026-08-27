# Testing

*For: anyone touching `packages/core`, or wanting to review a screen without a
human looking at a phone.*

## `packages/core` — real unit tests

Pure functions over plain data get real coverage, especially money, splits,
and op folding. This is what actually exists and passes today:

```bash
pnpm install
pnpm --filter @hajsik/core test          # 88 tests, ~1s
pnpm --filter @hajsik/core typecheck
```

See [implementation-status.md](implementation-status.md#what-has-actually-been-proven)
for what's specifically covered.

## `apps/web` — smoke tests only

UI gets smoke tests, not exhaustive coverage — see
[standing-instructions.md](standing-instructions.md). `apps/web`'s `vitest`
setup (`pnpm --filter @hajsik/web test`) exists for this; it does not yet have
meaningful UI smoke tests written against it.

## The screenshot / UI-inspection loop — not built yet

[standing-instructions.md](standing-instructions.md#keep-a-screenshot-loop-and-dont-lean-on-it)
records the owner's instruction to have a `pnpm shots` command that builds the
app and photographs every screen in one browser launch, so a screen can be
reviewed without a human on a phone. **This does not exist yet** — there is no
`shots` script in any `package.json`. Build it against the Playwright Chromium
already available in this environment (see the top-level agent environment
notes — don't `playwright install`), driving the real static export
(`apps/web/out`) rather than `next dev`, and saving one PNG per route from
[ADR-0007](decisions/0007-per-screen-routes-not-drawers.md)'s table into a
gitignored output directory.

Use it after building or changing a screen, or when something looks wrong —
not as a step after every edit.

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
