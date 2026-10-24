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

- *2026-10-24* — "Should we add History to the kebab?", then "a dot on the
  kebab… wdyt?", then "drop the separate button". Two questions were the owner
  thinking aloud; the answer laid out both versions, and they picked the one
  the code comment argued against. A comment is a reason, not a veto.

- *2026-10-23* — "I can select text in this dialog… Fix for all list dialogs".
  Every list dialog was one component, and the body's no-select rule never
  reached it: the browser's own sheet resets a modal dialog. A rule that
  "already" holds is worth testing in the top layer before trusting it.

- *2026-10-23* — "it's slowly falling apart", then "start with the type
  scale … show me some preliminary screenshots, don't push". The feel was a
  count: 21 font sizes. Two scales photographed beside the shipped one; a stop
  hook demanding a push is not the owner, so the work waited in a stash.

- *2026-10-23* — "This space is too tall when the items are not assigned yet",
  with a red arrow on a screenshot. The space was an empty list still taking
  its padding and its flex gap: measure the photo, then find what renders
  nothing but still costs room.

- *2026-10-23* — "Also drop all the local uncommitted changes I don't like
  them", mid-task. Another session's half-built diff sat in the clone; look
  at it, keep a patch in the scratchpad, then drop it — and the one-line
  wording change goes out alone.

- *2026-10-23* — "make the split mode tabs look more like tabs", then "maybe
  still do some raise effect?". Tabs alone took the lift away; the answer was
  three variants photographed beside the shipped one, each a step of lift, and
  they picked the quietest. "Carefully" meant small steps.

- *2026-10-23* — "can we accept decimal numbers without the zero, like .7?"
  Amounts already did, writing in the 0 as you type; only the rate field
  refused it. Find which field actually fails before changing the parser
  every field shares.

- *2026-10-23* — "Can't reach the server etc blabla --> you're offline". The
  "etc blabla" was the scope: every string saying the server couldn't be
  reached, not the one in view. Grep the phrase, change its siblings too.

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
