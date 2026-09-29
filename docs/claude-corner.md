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

- *2026-09-28* — "is it a mess?", then "so what's up with" a finding. Two of
  my crit's items were one rule seen on two different buttons. Answer the
  question with a verdict first; when my own finding is asked about, re-derive
  it from the code before defending it.

- *2026-09-28* — "change who you are doesnt work while the keyboard is open",
  then "or just add keepFocus to every button everywhere?". I had swept screen
  by screen and still missed one; the owner saw the real fix. A fix that has
  to be remembered per button belongs in one listener.

- *2026-09-28* — "make the import screen identical to the join screen". My
  crit said "one component" when they already were one; the owner read it
  literally and asked a sharper thing. Check a finding against the code before
  it goes in a file, then do exactly what was asked, add row and all.

- *2026-09-28* — "show me the 4 you marks so i can realize the gravity", then
  "i dont see anything particularly wrong". The photographs argued the other
  way: a finding that needs a gallery to be felt is taste, not a bug. Show it
  plainly, and let the owner's eye be the verdict.

- *2026-09-28* — "give a chevron to the kind switch", then mid-edit "but show
  me a few variants first". A one-line change still earned a look: stop, keep
  the edit as one of the variants, and publish the lot before committing.

- *2026-09-28* — "give it a good think and propose some designs", then "show
  me the tap feedback", then "ship it". Four variants, photographed in the app
  on the demo group so a row not yours was in frame. The press shot sold it:
  photograph the state a person meets, not only the one at rest.
