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

- *2026-10-14* — "Add the identity choice in the handover", then two
  interruptions: the bug it lands on, then "reuse the mechanism from the ios
  install". Reused whole, it brought the tutorial's first paint along: "it
  flashed the ios install screen". Reuse the logic, not the route.

- *2026-10-14* — "Typing in the search bar flashes the you owe banner". An
  hour lost reproducing it on a checkout 122 commits behind: the hook's report
  had said so. Pull dev before the first read; the cause was in what came in.

- *2026-10-14* — "Don't count the demo group's edits in the offline banner".
  One line, one fix; the check went offline in the demo first and read
  "16 changes waiting", so the passing run meant something.

- *2026-10-14* — "Should we relax the in-app browser restrictions?", then
  the copy, workshopped over two turns. The owner's phrasing beat both my
  drafts once its snags were named; the build waited only for the words, and
  the shot showed the banner before the summary described it.

- *2026-10-14* — "Add the search row back … dig it up from the history." The
  commit that took it out also cut its browser check, down to the glide it
  asserted; restoring the check with the code is half of digging it up.

- *2026-10-14* — "Wdyt, what does this involve?", then one line closing the
  two risks I raised. The answer named a doc it reversed and a test passing
  for the wrong reason; proving that test failed without the rule mattered
  more than the one-line change.

- *2026-10-14* — "Feel free to change verbs with counts", after a draft that
  had bent every sentence around them. Dodging a rule of grammar is a guess at
  the owner's taste; one sentence asking the cost of the plain form would have
  saved the round.

- *2026-10-13* — "Let's start a polish translation … Any questions?" The ADR
  had left the door open (a second object, same shape), so the build was
  small; the questions were Polish's own: gendered verbs, declined names, three
  plural forms. Ask the grammar before the strings.

- *2026-10-13* — "Suggest better copy … and review the idea", then mid-turn
  "the parts footer should state the number of parts". The review asked for
  words, so it went back as words to pick from; the footer was a spec, so it
  shipped. One message can hold both kinds of ask.

- *2026-10-13* — "In history, add an 'everyone else' text … wherever it makes
  sense". The hedge was the spec: "else" only where the people left out were
  named a row above, and the first test it broke ("Marie, Theo" turning into
  it) drew the other edge — two names are as short.

- *2026-10-13* — "Change the “4 people” small text in the group list to the
  icon + number that the ledger uses". The ask pointed at its own spec again:
  copy the ledger's glyph, size and gap, then crop both shots side by side
  rather than trust that they match.

- *2026-10-13* — "What does Staś mode say about the project", then
  "Wdyt about…", then the finished wording. Three questions were one design
  meeting; each answer checked the claim it made first (does `/diag` send
  anything?) so the copy promised only what the code keeps.
