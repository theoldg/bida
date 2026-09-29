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

- *2026-09-29* — "add a confirmation for going back from who-had-what in
  quick split". The grid already asked — only once touched. The gap was the
  untouched case, where the loss is the photo, not the taps. Find the guard
  that exists before building a second one.

- *2026-09-29* — "fix 5": the 410 gate. The doc called it the one write
  left; reading round it found two more on the same network path. A doc's
  "the only one" is a claim to check, not a fence around the ask.

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

- *2026-09-29* — "iiuc we can't catch a back action right after entering",
  then "yes, build it". The docs called it impossible; that was true of
  history, not of the button. When a wall is documented, ask whether another
  platform door reaches the same press before agreeing.

- *2026-09-29* — "why are groups tombstoned locally instead of truly
  forgotten?", then "shouldnt it just delete (after syncing…)?". My first
  answer defended the code; the owner's premise was sharper. When asked why,
  test the reason against the code before offering it as one.

- *2026-09-28* — "back should take me where i came from", then mid-work "if
  the results are the same page as the picker, they probably shouldnt". I was
  patching back inside one page; the owner saw it wanted to be two routes.
  When back needs special handling, ask whether the step is a screen.

- *2026-09-28* — "scan the repo for things that are very similar", then "fix
  everything". "Everything" meant my list minus what I had argued stays apart;
  merging is where the bugs surface (an import failure never shown). Name what
  was left separate, and why, in the summary.

- *2026-09-28* — "fix the +1 other finding", then mid-turn "also remove the
  start again button". My crit had said move it; the owner said remove. The
  later, blunter word wins: take it, and drop the crit's item with it.
