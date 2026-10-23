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

- *2026-10-23* — "The camera doesn't work… the button just does nothing", then
  "let's workshop it" on a dialog's words. The diag held no trace of the press,
  so the answer was a guess to check on the phone. Workshop meant notes and two
  drafts; they wrote their own third, terser than either.

- *2026-10-23* — "I don't like the new each/total arrangement, revert… except
  moving the -xN+ to the right", "keep the improvements made since". Wedging
  the count between two prices so it never moved was my reason, not theirs:
  a line reads in order first. A revert is a reorder, not `git revert`.

- *2026-10-23* — "Clean up after the previous session", then twice "out of
  scope": the code-substring match stays, the Polish is too far back. A
  clean-up's scope is the last stretch of work, not the whole history; the
  find worth keeping was a doc's figure that the screen at 360 contradicted.

- *2026-10-23* — "[price] [quantity (x1)]", then mid-build: "Add the +- buttons
  back to the quantity!" A sketch's brackets name the order, not what is
  inside them; dropping the stepper to make room was my call to make loudly,
  not quietly. Ask the room question, don't answer it by deleting.

- *2026-10-22* — "Quiz me on each word… batch obvious ones". Neither text
  before a question nor an option's preview reached the owner ("I can't see
  them"): the batch goes in the question itself. And one pick can't fill every
  slot: "Części" as a tab broke "Podział …", so that was asked again.

- *2026-10-22* — "do you have the latest version? i added a rule 20 minutes
  ago". The benchmark had loaded the prompt 45 seconds before a pull brought
  that rule in. A measurement names the commit it measured, or nobody can say
  what it measured: runs are labelled by commit now.

- *2026-10-22* — "Add a toggle similar to the who-had-what editor ... share
  the translation state obviously". The "obviously" was the spec: the same
  draft field, written at once like the grid's, so a look-only toggle never
  made Back ask to discard.

- *2026-10-22* — "BYOK should accept both a vertex and gemini api key". A
  key's look says nothing about its host, so saving asks both. Not every
  Google API takes a key: Vertex 401s a bogus one with "API keys are not
  supported", so probe with curl before trusting a free endpoint to answer.

- *2026-10-22* — "Produce ~10 receipts to test the limits of the scanning", then
  "fell right into the trap". Each receipt aimed at one rule, with an answer
  key saying in advance what passing meant, so the miss came back diagnosed.
  Then "a bit shorter pls": cut whole examples, not words.

- *2026-10-22* — "i still get autocomplete suggestions even after the recent
  fix". The fact-check before it was half right too: a forum's rule, not
  Chrome's source. Then a closed window: its transcript held the owner's yes,
  and the diff showed half its edits never landed. Finish from both.

- *2026-10-22* — "Is it an easy fix? what else is missing the effect?", then
  "do all". Asked a question, answer it — the list with where each lives and
  which need a variant — and build nothing: the owner chose the scope in two
  words. Drive is a phone, so check a hover on a desktop page of its own.

- *2026-10-22* — A redditor's "autofill css you didn't override", then two
  interrupts: "we need a garbage value", "fact check me though". The owner's
  memory was half right ("off", not "false"); say which half, with sources,
  rather than building on it or on yours.
