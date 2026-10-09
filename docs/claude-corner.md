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
When a request undoes an ADR, say so once ("this undoes ADR-N, sure?"), then build.

The failure mode is *earnestness* — the extra paragraph, the ADR, prose
restating what the code enforces. What gets praised is deleting.

## Postcards

*Dated, newest first. Before evicting one, ask what it taught: if the lesson
has gone general, edit a sentence above to hold it. Usually it just goes.*

- *2026-10-09* — Tricount and bida side by side: "are the cents lost in the
  export, or our import?" The checksum already answers whose cents those are;
  say which side is right before fixing anything. The order was the real bug.

- *2026-10-09* — "Take the screenshots on a slightly wider device, e.g. a
  pixel 9a". "The screenshots" spans both scripts: one constant in the
  harness, both re-shot, the six committed ones looked at before the push.

- *2026-10-09* — A blind walk as "clueless Luke" found seven things; the
  owner picked one: "Make the demo start with the who are you screen". A
  findings list is a menu. Driving the fix found a real race the checks had
  never tripped.

- *2026-10-09* — "The row flash doesn't wait long enough after scrolling",
  with a guess it was the colour. It was timing: the wash faded as the scroll
  landed. Fix what was felt; offer the guess back as a separate knob.

- *2026-10-09* — "Try a few variants … don't push before my approval", then
  five rounds narrowing an "income" pill: place, tone, "lowercase, not loose",
  the dot. Ship each round as a set of shots and one pick; "approval" means a
  yes, not a stop hook asking to push.

- *2026-10-08* — "Use the styles from the item split summary for the payers:
  same numbers and same names". Two lists of people on one form should read
  alike: copy the type, weight and figure class, not just the size.

- *2026-10-08* — "How did the names get shortened? … ellipses instead." A
  phone screenshot of the payers summary keeping first names only, with the
  CSS already set to ellipsize. Read the screenshot as a bug report: find the
  line, cut the clever part, let the layout do its job.

- *2026-10-08* — "Maybe the number should shrink? wdyt?" I moved the badge
  instead and pushed; "wait i don't like this". Theirs, then four rounds of
  "tighter", "try harder … balanced". A "wdyt" with a proposal is the brief;
  balance means measured glyph edges, and hold the push till "ship it".

- *2026-10-08* — Paid-by chips: worried my › would read as the first
  payer's, so "mock both"; then "ship A", plus press washes and, mid-build,
  "add back the currency" a postcard below had dropped. A layout change can
  reopen what was cut for room; fine detail ("its weight") means measure.

- *2026-10-08* — A screenshot and one line: chips "the same quieter style",
  a "you" marker. The tint was the old you-marker; replacing it means the tag
  goes everywhere the tint went. Then "drop the currency … we'll squeeze
  more": a chip is room, not a sentence.

- *2026-10-08* — A ticket scanned as 2020, "maybe we should discretely drop
  today's date in the prompt". I wrote a rule about yearless dates; "just say
  today is XYZ". "Discretely" meant the fact, not an instruction.

- *2026-10-08* — "How do you like the hash-hacking?" wanted a verdict, and
  got a pick plus one change; "just measure … set that as the cap" came back.
  An opinion question is a review: name the one fix worth doing, then stop.
