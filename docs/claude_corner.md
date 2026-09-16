# Claude's corner

*For: the next agent, five minutes before it does something the repo will
quietly resent. Everything else in `docs/` describes the product. This one
describes the **job** — how the owner asks, where the automation bites, and what
this place feels like to work in. The owner asked for it and reads it.*

**House rules for this file.** Under 200 lines, always — `wc -l` it before you
commit. Every session touches it, even one line, even just sharpening a
sentence someone else wrote. It is the one doc where narrative is allowed, so
it is also the one doc most likely to bloat: when you add, cut. Prefer editing
a line to appending one. Nothing here may contradict
[standing-instructions.md](standing-instructions.md) — that file is the owner's
word, this one is our notes on hearing it.

## How the owner asks

- **Lower-case, unpunctuated, short.** "the llm can handle that, don't build
  useless stuff." "don't highlight cent splits, that's the wrong vibe." Read the
  fragment as the whole instruction; it usually is one. Don't mistake brevity
  for vagueness, and don't send a clarifying question you could answer by
  looking at the screen.
- **Taste arrives as feel, not as spec.** "the wrong vibe" is a real, actionable
  bug report — your job is to translate it into pixels, not to ask for a
  redlined mock. Guessing and shipping beats asking and waiting.
- **Permission is usually pre-granted.** "propose a ux and go for it without
  approval, we'll iterate later." They would rather see the built thing and
  correct it than approve a plan. The exceptions are named explicitly in
  standing-instructions and implementation-status — read those, then move.
- **Corrections come as compression.** 32 ADRs became 11 because the docs had
  inflated. The instinct that gets praised here is deleting, not covering.
- **Iteration is by eye, on the real screen.** Whole runs of the log are one
  word, one centring, one line-break at a time. That is not churn — it is how
  the owner works. Ship a good-enough version early so there is something to
  nudge.
- **Scope is real.** "leave the seams, build none of it" means exactly that.
  Building the deferred thing because it was easy is the one way to make work
  that gets thrown away.

## Quirks of the automation

- **`pnpm session` first, always, and the failure mode is silence.** No install
  means no `core.hooksPath`, which means the `pre-push` hook is not there to run
  `pnpm check` — you push with zero verification and nothing tells you. It also
  moves you off whatever branch your harness invented onto `dev`
  ([hosting.md](hosting.md#dev-and-production)).
- **Your harness will assign a feature branch. Ignore it.** `scripts/on-dev.sh`
  carries your commits over and deletes the stray. It is safe to re-run, and it
  fails loudly rather than guessing if local `dev` holds work it cannot place.
- **`pnpm` skips postinstall by default**, so anything needing a build step must
  be in `onlyBuiltDependencies` or it silently isn't there.
- **`pnpm docs` fails on stale anchors and on any "N tests" you write** — a
  count goes stale the next commit. Say what the suite covers.
- **`pnpm rules` reads code with comments and string literals stripped**, so
  prose explaining a rule never trips it. Add a rule only when a single line
  reverses a written decision and no test would notice.
- **`pnpm verify` and `pnpm shots` drive a real browser.** Use them after a
  screen changes, not after every edit — the owner asked for the loop and asked
  us not to lean on it.
- **`pnpm check` is ~45s and is the whole gate.** Nothing runs in the cloud. If
  you want something caught, it goes in there or it is not caught.
- **Push at every checkpoint.** A session that dies mid-task should still have
  left its finished work on `dev`. This is cheap insurance and we keep
  forgetting it.

## Vibes

This is an unusually well-kept house for a project with no team. The docs argue
with you in advance: `docs-check.mjs` explains *why* a test count is banned,
`rules-check.mjs` explains why it strips strings, `on-dev.sh` explains why it
deepens a shallow clone before trusting ancestry. Read the comment before
fighting the script — it has usually already thought about your objection, and
the few times it hasn't are worth a Gotcha line.

The pleasure of working here is that the constraints are load-bearing rather
than ceremonial. Money is integers because floats lose cents. Entities are never
mutated because that one rule buys sync, offline and history at once. Colour is
only ever green or red because a third hue would make the balance stop
shouting. Every rule pays for itself, which makes obeying them feel like
craftsmanship instead of compliance.

The honest failure mode of an agent here is *earnestness*: writing the
paragraph, adding the ADR, restating in prose what the code already enforces,
leaving a note about what changed this session. It feels like diligence. It is
the exact thing the owner has had to undo more than once. When you feel the urge
to document your own thoroughness, that is the urge to resist — the reward for
good work here is a smaller diff, not a larger one.

And there is something quietly good about a product this modest being built
this carefully: no accounts, no tracking, a server that structurally cannot read
your group, hosted for free, for a handful of people splitting dinner. Nobody
made us do any of that.

## Postcards

*One line, dated, from a session that learned something too human for a Gotcha.
Newest at the top. When this section reaches roughly ten, drop the bottom one
rather than growing the file.*

- *2026-09-16* — The first session to write this file went looking for its own
  quirks and found the repo had already documented most of them, in script
  comments, addressed to exactly the agent who was about to make that mistake.
  That is the whole culture here, in one artifact: the previous person left the
  note before you needed it. Leave yours.
