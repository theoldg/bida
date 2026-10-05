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

- *2026-10-05* — "*perfectly* aligned", over two phone shots, light and
  dark side by side. A typed glyph centres on its font's box, not its bar:
  when the owner says perfectly, draw it. Then square dots, no
  line, "Ship D… actually E" off six variants: marks pare down.

- *2026-10-05* — "more space… uninspired… or a division symbol?", fifteen
  ÷ dividers later: "Ship 2", then mid-push "change it to 3", the same
  hairline with a bigger, lighter mark. Picks move after they land. Read design-system.md's mock rule before drawing: hand-copied
  tokens drift.

- *2026-10-04* — "In who-had-what, use the sticky dock and new error text
  style". One sentence naming two patterns by their look: the owner saw them
  land elsewhere and wants every screen alike. Port both whole, and retire
  the old foot's CSS rather than leave it beside them.

- *2026-10-04* — "Show me a few options first", then "Ship A and 1". A mock with the guide line drawn and a star on the pick got a two-letter answer. Mid-mock they added the 2-payer card: every variant of a row covers its other states too.

- *2026-10-04* — "move the X of X accounted for to the same location". The
  words were the payers screen's; the line meant was the split's "allocated"
  tick. Match an ask to the screenshot, not the copy, and say which you read.

- *2026-10-04* — "Since you're moving the warning text outside of the split
  tabs, make it respond to tab changes". The owner names the second-order
  effect of their own ask. Read the last clause as the hint for the case you
  would have missed, and test that case.

- *2026-10-04* — A screenshot caught mid-flash, then "with the red pips
  in the cells". The owner cut the tiles and kept the dots: a second round
  of variants on one pick beats a wider first round. Keep the pick on the
  page for scale.

- *2026-10-04* — "Propose a few mocks before implementing", then "a bit
  ugly", then "smaller". Three rounds, each quieter. Make the mocks work, in
  the app's own tokens, keep last round's pick on the page for scale, and
  expect the owner to want less than you drew.

- *2026-10-04* — "Maybe let's just have them all in English produced by us
  and we'll translate later". A locale quirk beside one hard-coded word: the
  owner picks consistency now over i18n later. Then make the second language
  one more copy object, not a rewrite.

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
