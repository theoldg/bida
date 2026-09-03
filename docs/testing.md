# Testing

*For: anyone touching `packages/core`, or reviewing a screen without a phone.*

```bash
pnpm check       # links · rules · typecheck · 217 tests · export build — pre-push, ~45s
pnpm verify      # both browser checks against a real build, ~45s
pnpm entries     # just the three kinds of entry, end to end
pnpm offline     # just every screen with the network cut
pnpm shots       # PNGs into shots/ (gitignored)
pnpm run docs    # every relative link resolves, every doc inside its budget
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

`packages/core` gets real coverage — money, splits, folding; the bar is in
[CLAUDE.md](../CLAUDE.md#working-agreements) and what's proven is in
[implementation-status.md](implementation-status.md#what-has-been-proven--tested-not-just-written).
The web app gets smoke tests only; `vitest.config.ts`
includes `lib/**` *and* `components/**`, which is why `sanitizeAmount` and
`groupDigits` are exported from `amount-input.tsx` rather than hidden in it.
Rendering isn't tested — `pnpm shots` is what looks at screens.

## `scripts/lib/harness.mjs` — what the three checks share

A build, a server that speaks the static export's dialect, a phone-shaped
browser, a pass/fail tally that owns the exit code, and a seeded group. Written
three times they drifted; written once, a fourth check costs a dozen lines:

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
offline-check drops an asset and forges a service-worker revision. `pick(page,
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
   `colorScheme` set, 390×844 at `deviceScaleFactor: 2`. Ten scenes have no URL
   worth visiting and are reached by driving instead: four dialogs (add member,
   leave group, delete entry, and a transfer side's person picker),
   `who-had-what` twice, `expense-split-amounts` (a deliberate shortfall) and
   `payers` — the last two hang off the entry form's in-memory draft, so their
   own URLs photograph an empty frame.

Chromium is at `/opt/pw-browsers/chromium` (override with `CHROMIUM_PATH`);
`playwright-core` is a root devDependency. Never run `playwright install`.

### Gotchas

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

## `pnpm entries` — the form is wired to the commands

The command tests prove an income's sign reaches the balances and that a
transfer edit writes only what changed. They cannot prove the *form* reaches
those commands — a Save stuck disabled, a segmented control writing the wrong
field, a detail screen that can't find a settlement by id
([ADR-0010](decisions/0010-what-an-entry-is.md)). This adds each of the
three kinds through the real UI, edits them, and reads the history back.

**Wait on state, not on a URL:** a save navigates before Dexie has redrawn, so
every assertion here follows a `waitForFunction` on the row count. Skipping
that is what makes a check like this flake and then get deleted.

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
