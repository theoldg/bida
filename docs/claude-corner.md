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

- *2026-10-04* — "off, then on, then off, there's a separator line missing
  on the top", over a screenshot with two arrows. A divider belongs to the
  row above it; the wash below swallowed it. Read the sequence as the bug's
  recipe, and fix both screens that share the pattern.

- *2026-10-04* — "Have it scroll to fit in a single line — or advise me
  differently". A phone photo of an overflow; the box was already built to do
  that and a same-named rule elsewhere undid it. Find why the design failed
  before designing anew, and give the asked-for shape if it's sound.

- *2026-10-03* — "Research this online pls", after two keyboard guesses
  failed on the phone. The owner's /diag paste settled it in one read. Ship
  the line that measures before the fix that guesses, and prefer the platform
  doing the job to arithmetic about it.

- *2026-10-03* — "Delete and trim a bunch of comments". Half a comment was
  the name it sat over; a ref called `before` needed a paragraph that
  `latestScanAs` doesn't. Keep the why, the platform quirk and the trap.
  Rename before you rewrite.

- *2026-10-03* — "anything bloated or tangled up?", then "Fix all". The knot
  was a shape copied, not a big file: eight receipt fields spelled out eight
  times. Answer with a ranked list, then say which smalls you left as not
  worth the churn.

- *2026-10-03* — "maybe some of them are useless what do you think?", then
  "Cut everything". A flaky suite was a question about worth, not speed: name
  which checks earn their place, and expect the owner to cut further than you
  dared to suggest.

- *2026-10-03* — "ordered by last modification time, not most recently dated
  entry". One line, and the word chosen was exact: an edit is a modification,
  so read the op log, not the entries. Take the owner's noun literally.

- *2026-10-02* — "Let's workshop the text title first", mid-build. Copy is
  the owner's to pick: offer a short table and a pick, keep the plumbing
  parked, and don't push a placeholder past the interruption. Their answer
  beat every option in the table.

- *2026-10-02* — "yes please build a". The plan promised to move the keyboard
  padding to the column; the code already had a cheaper shape (`.foot` pays
  `--kb` itself), so the dock copied that, and the dead `--act-below` went too.
  Say where the build left the plan.

- *2026-10-01* — "Block publishing to main until the latest checks are green
  (wait if still going, refuse if failed)". Every way to release needs the
  gate, the button and the laptop both; and gate one pinned commit, so what
  passed is what ships. Prove the refusal on a real red run.

- *2026-09-30* — "I'm going to sleep, anything you need me to clarify or
  decide". List the open choices, each with the default you'll take, then
  drive it home. The one answer that came back — a clean rebase "needs to be
  checked by the agent" — was the one no default would have guessed.

- *2026-09-30* — "add subtle dividers between selected rows (there already are
  some between unselected)". The rule for it already existed; a shorthand
  further down the file had quietly undone it. Look for the rule before
  writing a new one.
