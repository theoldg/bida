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

- *2026-10-18* — A Reddit comment, forwarded: "fix the selection issue and
  check the target blank thing just in case". The CSS already said nothing
  selects; a scan of every screen's computed style found the two opt-ins that
  did. The links were already fine; "just in case" wants that said.

- *2026-10-18* — "The Reddit browser escape doesn't work", a /diag and no
  more. A tap I can't watch can't be fixed by guessing how it failed: put the
  host's own way out under the button, and say which guess the fix rests on.

- *2026-10-18* — ""Han settled that one at the table" is funny but the UI
  doesn't support deletion notes". A demo line nobody can see is a joke told to
  the log. The demo holds only what a screen shows; a gag the app can't render
  is the first thing to go.

- *2026-10-18* — "Yes, add it, but also audit the prompt for … redundant
  structures … (don't make any changes yet)". "Yet" fenced the audit, not the
  sentence already agreed: one built, the rest reported. And the new sentence
  had to pass the audit it arrived with.

- *2026-10-18* — "Make the scan and who had what buttons quieter, but not too
  quiet". An outline, then five fill strengths, and the answer was the grey
  already beside them: "just make it like Rescan". A sheet of variants is
  how the plain answer gets found; offer the plainest one in it.

- *2026-10-18* — "Make the upper limit for as parts more like 1000000000".
  "More like" is a size, not a figure: 999 999 999 keeps the field a digit
  cap. A cap a thousand times higher also reached the footer's count, which
  was never grouped. Raise a limit, then look at every place the number lands.

- *2026-10-18* — "Make the expense button non inked, show me a screenshot and
  wait for approval". The stop hook asked for a push before the yes came; the
  owner's wait outranks the hook. Say why nothing went up, then end the turn.

- *2026-10-18* — "Should we make placeholders disappear on focus?" I spared the
  "as amounts" share as information; it was the very field users misread. And
  my rule caught "Item", a text field that opens focused. Ask which field
  confused them; photograph every field a selector catches.

- *2026-10-17* — "When i click fast it's buggy", the who-had-what grid on
  an iPhone. Three clicks in one frame reproduced it; the cause was a habit,
  not a line, and "look for similar bugs across the whole app" found it in
  the split steppers and payers too. Fix the pattern, not the screen named.

- *2026-10-17* — "Add an up/down chevron to the currency picker". refusals.md
  said the other chips carry no mark, on purpose: a one-liner can overrule a
  written rule, and then the rule's sentence goes in the same commit.

- *2026-10-17* — "Fix the flash that happens on deleting the last entry".
  A click showed it for one frame; a phone's tap for 260ms, since the tap on
  the dialog counted as a finger on the list. Drive a "flash" by touch, frame
  by frame, before deciding it is small.

- *2026-10-17* — "Adding an item to an already split bill accepts saving
  without assignment!" The cause was ten commits ahead of my clone: pull
  before tracing, or a bug in code you can't see reads as no bug. The fix
  was one question asked in two places, not two answers.
