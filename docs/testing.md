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
