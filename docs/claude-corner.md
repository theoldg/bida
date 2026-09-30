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
not described. Permission is usually pre-granted: build, then be corrected.

The failure mode is *earnestness* — the extra paragraph, the ADR, prose
restating what the code enforces. What gets praised is deleting.

## Postcards

*Dated, newest first. Before evicting one, ask what it taught: if the lesson
has gone general, edit a sentence above to hold it. Usually it just goes.*

- *2026-09-30* — "'As amounts' split should be in the payment currency!"
  One line, but it moves stored data: the D1 log already holds base amounts.
  Read old and new with one rule, and let the form convert on opening.

- *2026-09-30* — "Can we trigger background sync when a notification
  arrives?" Four turns followed, each cutting the design down: a cache, not the
  database; a stash that never moves the cursor. Say the cost plainly and let
  the owner trim it — "Do it" came once the design was theirs.

- *2026-09-30* — "the big amount's color should fade when spinning". One
  line, one fix: the words and colour wait for the roll, then fade with it.
  Sample the computed colour through the roll before calling it done.

- *2026-09-29* — "never show the deleted expense screen, i can see it
  flashing" — a race only a phone loses. Headless Chrome never showed it, even
  throttled: make it impossible by construction. The fold-out asked alongside
  it was tried on the phone and undone — "keep the bug fix".

- *2026-09-29* — "Consider the banner seen whenever the ledger is open",
  then a fold-back animation, then "remove the full history link". Three asks
  on one line in a row: each shrank it. The cap went with the link, or four of
  twelve would have been all anyone could reach.

- *2026-09-29* — ledger motion: a mock, three rounds of "the divider should…",
  then "ship it with" three lines of letters. The mock got corrections on
  lines and frames; timing only got one once it shipped ("wait a little
  longer"). Then "no animation for the last one": rare cases can go bare.

- *2026-09-29* — "Add exact ledger position memory (not just row index) and
  use it only when navigating back". "Exact" meant the pixel and "only" meant
  every other arrival opens at the top; a save above the row is where both
  showed. Scroll memory was deleted that morning: the ask narrowed it.

- *2026-09-29* — "The delete dialog after a long press should maintain the
  row-highlighted state in the background". One sentence, one state carried
  one step further — and every menu whose item asks a question gets it too.

- *2026-09-29* — "fix both failing checks". Three had been waved off as
  pre-existing flakes; one was a real race, one a stale expectation, one a
  hidden frame. "Also red on the base" says whose it is, not that it is noise.

- *2026-09-29* — "only fade the skeletons if up over 100 ms, otherwise cut...
  or advise me otherwise?" The "or" invites a view, not a veto: agree in a
  line, then find where "up" really began — a reopen's skeleton started on
  another route.

- *2026-09-29* — a digit spinner: mock of four, "B slightly slower", "make the
  speed configurable for all", then "Ship C at 800ms". Put a knob on the mock
  when feel is in question — the answer comes back as a number to ship.

- *2026-09-29* — "can we account for the banners in the skeletons? or does
  that come from the database too?" A question with a fix inside: answer it
  (no, the browser), then build it, and measure the drop before and after.
