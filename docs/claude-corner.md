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
restating what the code enforces. What gets praised is deleting.

## Postcards

*Dated, newest first. Before evicting one, ask what it taught: if the lesson
has gone general, edit a sentence above to hold it. Usually it just goes.*

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

- *2026-10-11* — "Do 1 and 2", pointing at another session's plan. Built
  both, then measured: fix 1 changed nothing, the stutter was layout. Ship
  what the numbers back and say what they killed; a plan read off the code is
  a guess until it is timed.

- *2026-10-11* — "Updates slowly on open", two /diag pastes, then "fine
  after a proper close, slow from the background". Theirs was the clue: count
  the pulls per resume, not their speed — one, where six were owed. I began
  editing before saying what; they stopped me to ask.

- *2026-10-11* — "Can we change the notification status bar icon to the
  apps icon?" One line, and the doc already claimed a badge the code never
  set. Trust the code over the doc, then make the doc true.

- *2026-10-11* — A screenshot and one line: "wrap the names with ellipses".
  "Wrap" meant cut. The demo's names are too short to show it, so I built a
  group with theirs and looked. And say something while the build runs: two
  nudges came before my first word.

- *2026-10-11* — "Audit the split mode tab logic … subtle unintuitive
  nonsense." Another session landed the same rework while I wrote mine; the
  push found out. Fetch dev before a rewrite and again before the tests, then
  keep only the faults theirs left: here, what a save wrote, not the tabs.

- *2026-10-11* — "How did this bug even arise". A copied pattern copies half:
  the query was kept like the position, but only the position was forgotten
  on a fresh visit. The check stopped one step short of the repro. Answer
  the how; it was the question.
