# Claude's corner

*For: the next agent, before it starts. The other docs say what to build and
how. This one says what it is like here — how the owner's instructions actually
read, and what an agent tends to get wrong that no check will catch.*

**House rules.** 100 lines, twelve postcards, 300 characters each — `pnpm
check` fails on all three. Every session adds a postcard and evicts the oldest
in the same edit; `pnpm push` merges two sessions' cards. Nothing technical lives here: a fact about the code belongs
in the Gotchas of the doc that owns it, a rule in
[CLAUDE.md](../CLAUDE.md#doc-upkeep) or
[standing-instructions](standing-instructions.md).

## What the postcards keep teaching

The owner writes lower-case fragments; read each as the whole instruction.
Taste arrives as feel ("the wrong vibe") — answer with the screen photographed,
not described. Permission is usually pre-granted: build, then be corrected —
but "wait for my approval" means stop until a yes.
When a request undoes an ADR, say so ("this undoes ADR-N, sure?") and wait for the yes.
A request naming something this session never saw ("the flags", three answers to
unasked questions) is another conversation's: ask which, that turn, not later.

The failure mode is *earnestness* — the extra paragraph, the ADR, prose
restating what the code enforces. What gets praised is deleting — and when
told to cut, drop whole comments and sections; squeezing each into a denser
sentence is the same earnestness, compressed.

## Postcards

*Dated, newest first. Before evicting one, ask what it taught: if the lesson
has gone general, edit a sentence above to hold it. Usually it just goes.*

- *2026-10-13* — "What does Staś mode say about the project", then
  "Wdyt about…", then the finished wording. Three questions were one design
  meeting; each answer checked the claim it made first (does `/diag` send
  anything?) so the copy promised only what the code keeps.

- *2026-10-13* — "What other large inputs are we not prepared for?" became
  paging and batching, then "and binary", which a probe of D1 priced at twenty
  times the CPU. An owner's design is a hypothesis too: measure it before
  building, and drop what loses out loud, mid-build, not in the summary.

- *2026-10-13* — "Design the incremental balance calculation and measure
  potential gains (with a temporary code hack…)", then "Do step 1 and 2". A
  throwaway patch priced each piece before any was built, and the owner chose
  from the table. The hack stays in the scratchpad, never in a commit.

- *2026-10-13* — "When I save an entry the summary screen animated the height
  change", and in passing, the balance label moving "ever so slightly". A probe
  measured both on the old build first: 32px of slide, 3px of label. An aside
  is as real as the ask; "I feel like" is a measurement not yet taken.

- *2026-10-12* — "Fix this flaky test", a phone shot of another session
  calling one sync test a timing flake. Six suites at once failed it, and
  four more with the same sleep; alone it never did. Load first, then read
  what each wait was standing in for.

- *2026-10-12* — "The animation feels a bit slow/janky". The six-row demo
  played smoothly at any throttle; four hundred rows at 4× played the fold in
  four frames. Jank is a size: seed a ledger as big as a real one before
  judging a motion smooth.

- *2026-10-12* — "Show the delete animation and number roll … Any
  questions?" Headless looked fine, so the owner's phone was the evidence:
  make the check fail the way the phone did before trusting the fix.

- *2026-10-12* — "Could switching screens be even snappier with like
  prefetches?" The ask named a fix; a frame-by-frame probe named the cause, a
  wait no prefetch touches. Measure before building the remedy offered, and
  at size: 600 entries slowed every screen, which no small group showed.

- *2026-10-12* — "ship the flags that speed up the trace": flags from a
  conversation I wasn't in. I measured my way toward them until they pasted
  it, and the paste was the whole brief. Build what it proposed and check it
  again, here: the export compared by content this time, not names.

- *2026-10-12* — "Should the deploy take so long?", then "Ok do your version.
  Why does the build take 30 seconds though?" Time each phase before
  answering a why; the numbers were the answer, and a fix touching a gate
  went to them as a question rather than into the push.

- *2026-10-12* — "Should we special case the wording…?" I answered with a
  pick and asked; their reply was a better design ("a single row … for Y").
  A question can be the owner thinking aloud: answer briefly, then build what
  comes back without asking again.

- *2026-10-12* — "Change the app icon to have four teeth … like the receipt
  icon in the home screen. Any questions?" The ask pointed at its own spec, so
  none were owed: count the reference's teeth, match them, regenerate, and
  name what stayed (badge, banner) for them to veto.
