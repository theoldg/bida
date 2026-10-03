# Testing

*For: anyone running the gate or writing a test. The table under the commands
says which of the testing docs your task needs.*

```bash
pnpm push         # bump, push to dev, watch the run until green or red — how a session ships
pnpm check        # links · rules · version · typecheck · tests — pre-push, ~25s
pnpm verify       # every browser check against a real build — on GitHub, at every push
pnpm verify nav   # one of them (or several, named) — each is a file in scripts/checks/, [browser-checks.md](browser-checks.md) says what it holds
pnpm shots        # PNGs into shots/ (gitignored)
pnpm readme-shots # the six pictures in README.md, into docs/media/ (committed)
pnpm drive        # the app as text, one command at a time: one screen's shot, a bug, two phones — [drive.md](drive.md)
pnpm run docs     # links resolve, ADRs indexed, claude-corner within size, ~30ms
pnpm run rules    # the decisions one line could reverse, checked against the code, ~30ms
pnpm bump         # the number this deploy will show; `push` does it for you — [hosting.md](hosting.md#versions)
```

| Read | When you are |
|---|---|
| **This file** | Running the gate, or writing a unit test |
| [browser-checks.md](browser-checks.md) | Writing or fixing a browser check, or reading why one went red |
| [shots.md](shots.md) | Photographing screens, or refreshing the README's pictures |
| [on-a-phone.md](on-a-phone.md) | Holding an iPhone: what no headless browser can check |
| [drive.md](drive.md) | Looking at the app yourself: one screen, a bug, a feature to stress |

## Where each check runs

| | Where | Gates |
|---|---|---|
| `pnpm check` | `pre-push`, on your machine; again on GitHub (`--ci`) | the push, then the deploy |
| the build | GitHub, in the deploy job | the deploy: a red build ships nothing |
| `pnpm verify` | GitHub, beside the deploy, every push to `dev` | the release — `pnpm push` waits on it |
| the whole run | — | the release: `main` gets only a commit whose `dev` run is green ([hosting.md](hosting.md#dev-and-production)) |

**Your machine runs only what takes seconds**, so the loop stays fast; what
takes minutes runs on one named GitHub image (`.github/workflows/deploy.yml`),
so a verdict does not depend on which container a session got. `pnpm push`
watches the run its push started and ends on it: green is done, red is yours.
It prints the failures pinned to the run — `::error` annotations, the one part
of a run the API serves without a log download, which the agent environment
cannot reach. The deploy does not wait for `verify`, so the owner is trying the
change on dev while it runs; a red `verify` is dev serving a change you still
owe a fix.

**A browser check that fails on GitHub runs once more, alone** (`verify
--retry`). Failing alone is a real failure. Passing alone is a flake: the run
stays green and `pnpm push` prints it. It is still a bug — a check that only
fails under load is betting on the machine's speed (*A pause is not a wait*, in
[browser-checks.md](browser-checks.md#gotchas)) — but not yours to chase
mid-task unless you touched what it drives.

**Don't run the whole `pnpm verify` yourself.** Run the one check you are
writing or fixing, alone (`pnpm verify <name>`). On GitHub they run one at a time
(`VERIFY_JOBS=1`); locally, as many at once as the machine has cores (`VERIFY_JOBS` overrides): seven chromiums on four cores
starve the pages past the app's own timers, which is where every flake this
suite has had came from.

**The browser checks build for themselves.** `ensureBuild()` compares `apps/web`
and `packages/core` against `apps/web/out` and runs the build only when it is
missing or stale. `pnpm verify` does that build once and then runs them
together: each serves the export on its own port 0, and the build is the one
thing seven of them starting at once would have raced on.

**What gates, and why.** The build, because `next build` catches what `tsc`
cannot (a prerender touching `window`, a client-boundary mistake, a
`precache.mjs` that throws). `pnpm run rules`, because a decision in an ADR is one careless import away
from being reversed by someone who never read it — an import or a
`Date.now()` in `packages/core`, a browser dialog in `apps/web`
([ADR-0008](decisions/0008-hand-rolled-interface.md)), a live read without its
watchdog; each rule in `scripts/rules-check.mjs` names the doc it holds. The bar
for another is in the script: written down as a decision, reversible in one
line, invisible to every test. Style isn't on the list — there is no linter here
on purpose. And the version, because a push to `dev` deploys and a deploy has to
show a new number: the stage fails a tree that differs from what `dev` is serving
and still calls itself the same thing ([hosting.md](hosting.md#versions)). It
is the one stage GitHub skips — it clones shallow, with no `dev` to compare
against.

**A pass is stamped and not repeated.** The stamp is a hash of every file git
tracks or would track, plus the env files it ignores
(`scripts/lib/check-stamp.mjs`), so `pnpm check` then a push runs the gate
once — and committing in between does not invalidate it, because the contents
are what is hashed and they did not move. Anything that did move re-runs it;
`pnpm check --force` re-runs it regardless.

**Its stages run at once** (`scripts/check.mjs`), because none of them reads
what another writes — so the gate costs the slowest one, not the sum. Each
keeps its output instead of printing it: a pass is a line and a digest each, a
failure spills only the stages that failed and names the `pnpm run <stage>`
that reproduces each alone. Nothing stops at the first failure, so one run
tells you everything that is broken.

## Unit tests

`packages/core` gets real coverage; the bar is in
[CLAUDE.md](../CLAUDE.md#working-agreements). The web app gets less, and not all
of it is smoke: the command layer, `checkEntry` and the split tabs' own
inputs — where being wrong outside core costs money — are covered in earnest,
the screens are not. The merge rule itself has its own suite
(`lib/db/commands/patch.test.ts`), shared by both entry editors. `vitest.config.ts` includes `lib/**` *and* `components/**`, which is why
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
  repeated amounts, all different, two amounts, wide random). Keep all four
  shapes if you touch it: equal debts are where a search misses pieces.
- **HLCs are totally ordered by string comparison**, and a peer's stamp is
  absorbed on receive up to a day ahead — so a reply to their op always sorts
  after it — and held back past that, until the wall catches up.
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

## Gotchas

- **`pnpm` skips postinstall scripts by default, which breaks vitest and
  `wrangler dev`.** The root `package.json` carries
  `"pnpm": { "onlyBuiltDependencies": ["esbuild", "workerd"] }`; anything that
  needs to build on install goes in that list or it silently does not.
- **Never probe ciphertext for a short word.** The "nothing readable crossed the
  wire" checks (`core/seal.test.ts`, `lib/db/sync.test.ts`) look for plaintext
  in a sealed body; base64 is 64 symbols, so `"EUR"` turns up in a few hundred
  random characters about once in fifty runs. Probes are seven characters or
  longer, and the exact envelope key set is what actually pins the shape down.
