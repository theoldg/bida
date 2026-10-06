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

- *2026-10-06* — "What's up with the variable sodas price??" with the receipt
  beside it. A cent the owner can see is a bug, not rounding: find which
  tap turned one printed line into three, and fix the arithmetic there.

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
