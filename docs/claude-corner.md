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

- *2026-09-29* — "i can see the homescreen flashing" on a reopen. The skeleton
  was honest, but it was the wrong screen's: a flash is judged by its frame,
  not its data. Prove the check fails without the fix before trusting it.

- *2026-09-29* — "the long hold menus are a bit bare", then a mock with
  toggles, then a phone screenshot of the ticks: "I like these settings". The
  screenshot is the spec; the one thing named to drop is the only change.

- *2026-09-29* — "Build D from this" with a page of four mocks. The letter is
  the whole spec: the mock's keyframes are the design, the app's own refusal
  animations are the vocabulary to say it in. Pick D, don't re-argue A–C.

- *2026-09-29* — "have this say \"you'll have to scan it again\"" with a
  screenshot of the dialog. The quote is the copy: set it verbatim in the
  house's curly apostrophe, and touch nothing else in the dialog.

- *2026-09-29* — "add a confirmation for going back from who-had-what in
  quick split". The grid already asked — only once touched. The gap was the
  untouched case, where the loss is the photo, not the taps. Find the guard
  that exists before building a second one.
