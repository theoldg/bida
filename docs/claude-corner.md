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

- *2026-10-22* — "Is it an easy fix? what else is missing the effect?", then
  "do all". Asked a question, answer it — the list with where each lives and
  which need a variant — and build nothing: the owner chose the scope in two
  words. Drive is a phone, so check a hover on a desktop page of its own.

- *2026-10-22* — A redditor's "autofill css you didn't override", then two
  interrupts: "we need a garbage value", "fact check me though". The owner's
  memory was half right ("off", not "false"); say which half, with sources,
  rather than building on it or on yours.

- *2026-10-21* — "Simplify, same results", then a rewrite of their own at half
  the length. Their structure won; the review that helped named which cut lines
  each fixed a past failure, and they took three of six. Answer a draft line by
  line, and let "that's obvious" end the line.

- *2026-10-21* — "What did we miss?", then "fix all the easy things". A
  throwaway test made each guess a finding. Easy meant no money call: keeping
  the tip through a rescan looked easy and would double an older scan's
  service, so it went back to the owner with the old phones.

- *2026-10-21* — "Make the discount and charge cards the same colour as the
  item cards". The clone was behind dev and had no such cards: pull before
  hunting. And the chip's own shade already was the card's — deleting the
  deeper one was the whole change, no override to add.

- *2026-10-21* — "Taking this logic to the extreme, the tip should only be
  editable in the editor. That's wrong though." One home is a rule for facts,
  not doors: one field may be typed in two places. And a critique declined
  ("the top is more header-like") is a decision — build theirs, not yours.

- *2026-10-21* — "Do you like it?" Mid-iteration it asks for a view, not a
  build: say yes, then name two flaws seen in the photo. Then "do neither,
  push it" — the critique was the owner's to take, and declining it is an
  answer too.

- *2026-10-21* — "The diag screen takes a while to open when there's a lot of
  logs". The guess was the database wait; a profile said layout, every 2s, of
  lines that hadn't changed. Measure before choosing which of the owner's
  offered fixes to build.

- *2026-10-21* — "The copy button wash should respect the margin here", then
  "(or at least have some margin)". The second line widened the first: an inset
  is enough. A press wash only shows while held, so drive learnt `down` to
  photograph one rather than guess it from the CSS.

- *2026-10-20* — "Equally rude but less specific so the model gets to be a
  bit more creative". Two example roasts and two lists of targets were a
  script it could only recite. Then "where else": in the reading, each example
  is a fixed misreading — keep those; only the jokes want room.

- *2026-10-19* — "Flash 'assign who had what' after scanning … not in quick
  split". The FAB's scan lands a screen before the button exists, so the
  flash is a mark left by the scan and taken by the button. Sample frames to
  see a flash: one shot at a guessed moment says nothing either way.

- *2026-10-19* — A receipt photo and "it doesn't work". No key here to scan
  with, but the paper did the arithmetic: three "discount included" notes, a
  sum matching only without them. Asked "would logs help?", say what the
  guess rests on — then build the log that makes the next one a reading.

