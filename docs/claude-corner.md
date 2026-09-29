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

- *2026-09-29* — "imported groups: every expense has the same creation time
  and author". The log already knew which entries came in with the group; no
  new flag was needed to tell, only one to say from where. Read the log first.

- *2026-09-29* — "i went through the quick split flow and didn't find a single
  -". The crit's hyphen was the fixture receipt's own title, not the app's. A
  shot shows data as well as design: before filing a finding, find the line
  of code that draws it.

- *2026-09-29* — "make single currency symbols full color", then halfway into
  a second ask, "nevermind the kebabs". Drop the retracted half entirely; do
  the one that stayed, and name the codes it spares.
