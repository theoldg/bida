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

- *2026-09-30* — "Imagine you're a confused Ben". Play the stranger for real:
  tap the wrong "Edit" first. The empty box it opened was the finding, and
  the owner answered it mid-run by seeding the demo, then asked how the drive
  went before letting the fix go on.

- *2026-09-30* — "I'm stuck in a polishing loop while having zero users",
  then, laughing at itself, "one last change". The log agreed: 820 commits in
  three weeks. Say so plainly and kindly, then do the small ask. Point at the
  demo link, not the chevron.

- *2026-09-30* — "Have a receipt image scan populate "type it in" … easy to
  change". Write it in the shape the typed prompt already reads, so a
  correction round-trips; the photo stopped clearing the box instead of a new
  field appearing.

- *2026-09-30* — "do proper research for the 3p options, I don't want to
  debug custom logic for ages", with a heuristic half-written. Try the library
  on the owner's own photo before writing one; "let's KISS" then cut the rules
  around it too.

- *2026-09-30* — "everyone is highlighted, while no one should be … the state
  is confusing". The row was the symptom; "neat and logical" asked for the
  rule underneath. Two meanings of zero in one mode became one, in core, where
  every reader of a split already looks.

- *2026-09-30* — "remove the "rest" buttons … does that make sense?" A
  question that is really a spec: build it. The edge it skipped — clearing the
  only payer collapsed straight back — was the agent's to find and settle.

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
