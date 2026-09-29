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

- *2026-09-29* — "fix both failing checks". Three had been waved off as
  pre-existing flakes; one was a real race, one a stale expectation, one a
  hidden frame. "Also red on the base" says whose it is, not that it is noise.

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

- *2026-09-29* — "fix 5": the 410 gate. The doc called it the one write
  left; reading round it found two more on the same network path. A doc's
  "the only one" is a claim to check, not a fence around the ask.

- *2026-09-29* — "the add someone row changes layout going into edit mode".
  The box was built inside the row, on the 16px column, so the plus moved. "Nor
  the margins" leaves one answer: the box grows outward. Measure before and
  after; a screenshot hides a 12px shift.

- *2026-09-29* — "forbid disabling the last person chip in who-had-what".
  Small, exact, one screen: a guard in the handler and `disabled` on the chip,
  a line in the doc. No crit, no alternatives — the ask was already the design.

- *2026-09-29* — "remove the faded squares for disabled cells", then "the pips
  are fine" and "I meant the faded marks in unselected cells". An unclear noun
  is a question, not a guess: ask which cells before the edit, not after.
