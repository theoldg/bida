# Claude's corner

*For: the next agent, before it starts. The other docs say what to build and
how. This one says what it is like here — how the owner's instructions actually
read, and what an agent tends to get wrong that no check will catch.*

**House rules.** 100 lines, twelve postcards, 300 characters each — `pnpm
check` fails on all three. Every session adds a postcard and evicts the oldest
in the same edit. Nothing technical lives here: a fact about the code belongs
in the Gotchas of the doc that owns it, a rule in
[CLAUDE.md](../CLAUDE.md#doc-upkeep) or
[standing-instructions](standing-instructions.md).

## What the postcards keep teaching

The owner writes lower-case fragments; read each as the whole instruction.
Taste arrives as feel ("the wrong vibe") — answer with the screen photographed,
not described. Permission is usually pre-granted: build, then be corrected —
but "wait for my approval" means stop until a yes.
When a request undoes an ADR, say so ("this undoes ADR-N, sure?") and wait for the yes.

The failure mode is *earnestness* — the extra paragraph, the ADR, prose
restating what the code enforces. What gets praised is deleting — and when
told to cut, drop whole comments and sections; squeezing each into a denser
sentence is the same earnestness, compressed.

## Postcards

*Dated, newest first. Before evicting one, ask what it taught: if the lesson
has gone general, edit a sentence above to hold it. Usually it just goes.*

- *2026-10-12* — "Change the app icon to have four teeth … like the receipt
  icon in the home screen. Any questions?" The ask pointed at its own spec, so
  none were owed: count the reference's teeth, match them, regenerate, and
  name what stayed (badge, banner) for them to veto.

- *2026-10-12* — "Take your time, do many runs", then "I'm bored". Twenty
  runners at once, four rounds each, and a status table after every batch:
  the soak said the flakes were the checks' waits, not the load. Show the
  numbers as they land; a long experiment is not a silent one.

- *2026-10-12* — "Make the balance amounts … tap-to-copy", then mid-build
  "Do the same for the amount inside the record dialog". A follow-up that
  arrives mid-turn joins the turn: fold it into the same push, built from the
  same helper, rather than finishing the first and starting over.

- *2026-10-12* — "Change the … copy back to what it was. I don't care
  that it's imprecise." An audit's precision fix can be the wrong fix: the
  owner weighs plain words above exact ones. Revert, and record it as a
  decision so the next audit doesn't redo it.

- *2026-10-12* — "Run a few probe checks pretending you want to find
  something", then "Fix 1 and 2". Probing as a cold reader found a rule the
  code broke and a status file grown into a changelog; neither was visible
  from the docs alone. Ask the code if the rule holds.

- *2026-10-12* — "Continue fixing the bugs from yesterday's list." Many
  pushes in, after a compaction, they stopped me mid-command. A long unattended
  run wants checkpoints the owner can see: what is done, what is next, then
  carry on. A summary that only the next context reads is not one.

- *2026-10-12* — "Are the docs too long?", then "do all 4", then "push
  frequently, another session is working". A split moves text away from
  whoever is reading it: commit each step and run every moved link through
  docs-check before pushing, or the other session rebases onto wreckage.

- *2026-10-11* — "Scan the latest ~100 commits for … anything falling apart",
  then mid-scan "push whatever you have … this machine might be dropped". An
  audit's findings are work product: commit them as a list in the docs as
  they land, not only in chat.

- *2026-10-11* — Three numbered answers to questions this session never
  asked; they were another session's. I said so, then they pasted the whole
  exchange. Asking which conversation it belonged to cost one turn; guessing
  would have built the wrong thing.

- *2026-10-11* — "1 minute than 5, or no timer at all? Wdyt" — an either-or
  ending in wdyt wants a pick with its one reason, then the build, not a
  survey. And when the owner pastes another session's proposal, that paste is
  the whole brief.

- *2026-10-11* — "Rename "by name" to "by title" in search results".
  One string in copy.ts; grep the docs and checks for it anyway, then ship
  without ceremony. A one-word ask wants a one-word diff.

- *2026-10-11* — A UI request, cut off, then "Any questions?". The owner
  wanted questions before code: four, each with a pick. They took the safe
  default on three and kept today's rule on the fourth, which changed how
  the build went. When asked to ask, ask.
