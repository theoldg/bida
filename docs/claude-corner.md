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

- *2026-10-06* — "Go wild" on history, then "this doesn't make any sense"
  over my rows of struck names, and "too much detail". Wild meant clearer,
  not denser. Three text mocks per question got two picks in one reply: when
  a first pass misses, mock before rebuilding.

- *2026-10-06* — "The group history link should have its icon aligned with
  the timeline points". One element named, one alignment asked: measure the
  rail, put the icon on it, and let the words fall into the column too.

- *2026-10-06* — "Sort the amount chips by value": no direction given.
  Biggest first is how a bill is read; pick it, tie-break so the row can't
  shuffle, and let a correction come if it's wrong.

- *2026-10-06* — "Stick to the last person's row, not the bottom of the
  screen": a ten-minute-old choice reversed in a line. The owner refines by
  living with it; build the second version as readily as the first.

- *2026-10-06* — A phone screenshot and one line: make the tabs stick. The
  picture is the spec; check it in a viewport short enough to scroll, not in
  the demo's four rows at full height, where nothing ever sticks.

- *2026-10-06* — "Make the names louder to match the amounts on expense
  summary screens". Plural screens, one shared row: the quick split's answer
  too. Lift the people, not every `.kv` — a label beside a count stays quiet.

- *2026-10-06* — "What's up with the variable sodas price??" with the receipt
  beside it. A cent the owner can see is a bug, not rounding: find which
  tap turned one printed line into three, and fix the arithmetic there.

- *2026-10-06* — I argued against inking a chip; they picked it anyway, with
  three other letters, and in the same breath asked for the next round. An
  argument is a footnote on the mock, not a veto: build the pick, then go on.

- *2026-10-06* — "Maybe a checkmark next to unspecified rows", typed into
  the middle of my survey of the code. The owner designs while you read: stop
  and fold the hint in, and the mocks they then see are already theirs. Then
  "Build it" settled three open questions by accepting every proposal.

- *2026-10-06* — "make only its check box clickable… it shouldn't be visible
  in the tap feedback". A day after shipping the whole-row toggle: the owner
  tunes by hand after use. The hit area may grow; what the eye sees answer
  the tap must stay the box.

- *2026-10-05* — "Propose a toggle all… not too text-heavy", then four
  working mocks, then "make some stuff aligned right, the checkbox is a good
  direction", then "Ship 3". The owner steers a round by naming a direction,
  not a variant: give them five takes on it, not the old four again.

- *2026-10-05* — "I crashed the app by typing \"1 million tomatoes\"… should
  we cap rows?" The owner breaks things on purpose and offers two fixes. Pick
  the narrower one, say why, and ship it: the question was the go-ahead.
