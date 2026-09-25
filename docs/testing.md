# Testing

*For: anyone running the gate or writing a test. The table under the commands
says which of the testing docs your task needs.*

```bash
pnpm check        # links · rules · version · typecheck · tests · export build — pre-push, ~30s
pnpm verify       # every browser check against a real build, ~50s (~90s on a 4-core container)
pnpm entries      # just the three kinds of entry, end to end
pnpm claim        # a name still being typed, and the button that acts on it
pnpm keyboard     # what a phone keyboard does to a form: the act under it, the confirm key
pnpm offline      # just every screen with the network cut
pnpm stall        # what a screen does when reading this phone's database stops working
pnpm homescreen   # the invite an iOS icon is added with, both ends of it
pnpm demo         # /demo lands on a populated ledger, and holds no key
pnpm nav          # where the back arrow goes, and what it leaves on the stack
pnpm tricount     # a Tricount link, pasted, all the way to a balanced group
pnpm shots        # PNGs into shots/ (gitignored)
pnpm readme-shots # the six pictures in README.md, into docs/media/ (committed)
pnpm drive        # drive the app as text — [drive.md](drive.md)
pnpm run docs     # links resolve, ADRs indexed, claude_corner within size, ~30ms
pnpm run rules    # the decisions one line could reverse, checked against the code, ~30ms
pnpm bump         # the number this deploy will show — [hosting.md](hosting.md#versions)
```

| Read | When you are |
|---|---|
| **This file** | Running the gate, or writing a unit test |
| [browser-checks.md](browser-checks.md) | Writing or fixing a browser check, or reading why one went red |
| [shots.md](shots.md) | Photographing screens, or refreshing the README's pictures |
| [on-a-phone.md](on-a-phone.md) | Holding an iPhone: what no headless browser can check |
| [drive.md](drive.md) | Reproducing a bug by driving the app as text |

**The browser checks build for themselves.** `ensureBuild()` compares `apps/web`
and `packages/core` against `apps/web/out` and runs the build only when it is
missing or stale — so none of them needs a build step in front of it, and none
of them wastes 25 seconds when nothing has changed. `pnpm verify` does that
build once and then runs them together (`scripts/verify.mjs`): they share
nothing to collide over, each serving the export on its own port 0, and the
build is the one thing nine of them starting at once would have raced on.

**What they do share is the machine.** Each check wants about a core, so
`verify` runs as many at once as the machine has cores (`VERIFY_JOBS`
overrides), slowest first: a laptop runs all nine together, a four-core cloud
container four at a time. Nine chromiums on four cores starve the pages past
the app's own timers, and that is where every flake this suite has had came
from. The cap is load-shedding, not the fix: a check that only fails under load
is still betting on how fast the machine is, and the bet is the bug (*A pause
is not a wait*, in [browser-checks.md](browser-checks.md#gotchas)). A check that fails alone is a real failure, every time,
so rerun the named one on its own before believing anything else.

`pnpm check` is the gate — nothing else stands between an edit and production,
so the three things that gate nothing else are in it. The build, because `next
build` catches what `tsc` cannot (a prerender touching `window`, a
client-boundary mistake, a `precache.mjs` that throws) and the deploy workflow
only rebuilds and ships, so a build that fails there fails on `main`. And
`pnpm run rules`, because a decision in an ADR is one careless import away
from being reversed by someone who never read it — an import or a
`Date.now()` in `packages/core`, a browser dialog in `apps/web`
([ADR-0008](decisions/0008-hand-rolled-interface.md)), a live read without its
watchdog; each rule in `scripts/rules-check.mjs` names the doc it holds. The bar
for another is in the script: written down as a decision, reversible in one
line, invisible to every test. Style isn't on the list — there is no linter here
on purpose. And the version, because a push to `dev` deploys and a deploy has to
show a new number: the stage fails a tree that differs from what `dev` is serving
and still calls itself the same thing ([hosting.md](hosting.md#versions)). CI
cannot check that one — it clones shallow, with no `dev` to compare against.

**A pass is stamped and not repeated.** The stamp is a hash of every file git
tracks or would track, plus the env files it ignores and the build reads
(`scripts/lib/check-stamp.mjs`), so `pnpm check` then `git push` runs the gate
once — and committing in between does not invalidate it, because the contents
are what is hashed and they did not move. Anything that did move re-runs it;
`pnpm check --force` re-runs it regardless.

**Its six stages run at once** (`scripts/check.mjs`), because none of them
reads what another writes — so the gate costs the slowest one, the build, and
not the sum. Each keeps its output instead of printing it: a pass is six lines
and a digest, a failure spills only the stages that failed and names the
`pnpm run <stage>` that reproduces each alone. Nothing stops at the first
failure, so one run tells you everything that is broken.

The flip side: **the [browser checks](browser-checks.md) gate nothing**, so one can go red and
stay red. Run `pnpm verify` after touching a screen, not only when something
feels wrong.

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
