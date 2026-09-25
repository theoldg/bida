# Screenshots

*For: anyone photographing screens, or refreshing the README's pictures. Part
of the [testing](testing.md) docs; both scripts stand on the harness in
[browser-checks.md](browser-checks.md#scriptslibharnessmjs--what-the-browser-checks-share).*

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
   `colorScheme` set, 390×844 at `deviceScaleFactor: 2`. Fifteen scenes have no URL
   worth visiting and are reached by driving instead: five dialogs (add member,
   forget group — from the groups list's row menu — delete entry, a transfer
   side's person picker, and the rate editor), the group's kebab open — the one
   shot of the menu card carrying a full set of items — `who-had-what` twice, `expense-split-amounts` (a deliberate
   shortfall), `payers`, and the three of a quick split (people, grid, answer)
   — every one of them hangs off an in-memory draft, so its own URL
   photographs an empty frame.

Chromium is at `/opt/pw-browsers/chromium` (override with `CHROMIUM_PATH`);
`playwright-core` is a root devDependency. Never run `playwright install`.

## `pnpm readme-shots` — the six pictures in the README

`scripts/readme-shots.mjs` walks the same UI with the opposite brief. `shots`
leans on states worth catching — a split that doesn't add up, a payer who
overpaid, a server that can't be reached; a stranger deciding whether to open
the app should see none of those, so this one photographs two rows of three:
the app a Tricount user already expects (ledger, balances, adding an expense)
over the part they came for (a scan mid-read, the who-had-what grid, and the
saved expense read back line by line).

**The group in them is the demo** (`core/src/demo.ts`), the one `/demo` lays
down for a visitor — written to give every screen something to say, which is
what six screenshots need, and the README then shows what the front page's
button actually opens. Its entity ids are constants, so the cantina tab is
addressable (`demo-cantina`) rather than something to hunt for; the grid is
still reached through the entry form, because it reads a draft and a draft
lives in memory.

The scan's bar is a CSS animation on a wall clock, so `waitForTimeout` would
photograph a different fraction on every machine: the request is routed into a
hole and the animation is paused at a fixed progress instead (`freezeScanBar`).

Two things worth knowing:

- **`DemoCard` is removed before the ledger shot.** It says "Demo group: not
  synced" and never dismisses, which is right in the demo and the opposite of
  the pitch when it sits in the README. The fact is the demo's, not the app's.
- **Its output is committed.** `shots/` is gitignored, so a README cannot point
  at it; `docs/media/` is not. Re-run and commit what moves when one of the
  six screens changes.

## Gotchas

- **A shot wears the harness's locale and clock.** At Playwright's defaults
  every entry carries the container's hour. The context sets `locale`,
  `timezoneId` and a resumed `clock.install`, so the trip is always
  photographed at dinner time.
- **Screenshots miss the caret** (it blinks), and JetBrains Mono's zero is
  *slashed*. A mark inside a "0" is the font, not a struck-through field.
