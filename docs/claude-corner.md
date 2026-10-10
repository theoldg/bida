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
not described. Permission is usually pre-granted: build, then be corrected —
but "wait for my approval" means stop until a yes.
When a request undoes an ADR, say so once ("this undoes ADR-N, sure?"), then build.

The failure mode is *earnestness* — the extra paragraph, the ADR, prose
restating what the code enforces. What gets praised is deleting.

## Postcards

*Dated, newest first. Before evicting one, ask what it taught: if the lesson
has gone general, edit a sentence above to hold it. Usually it just goes.*

- *2026-10-10* — "Audit the split tabs", then "explain and wait for my
  approval", then "percent splits … are safe to delete". The legacy case I'd
  been tiptoeing round was the tangle; ask whether old data is real before
  building around it.

- *2026-10-10* — "Do they feel crystal clear and aesthetic to you in the
  code?" I'd just shipped a fix; honest answer was no, three mechanisms for
  one question. "Do it." An aesthetics question about your own work wants
  the critique, not a defence.

- *2026-10-10* — "Reopening should remember who was rest … you have to figure
  it out." Six repros kept the rest; the cause was upstream: parts had arrived
  typed. When a bug won't reproduce, ask what wrote the data, not what reads it.

- *2026-10-10* — "I think i saw the install tutorial page briefly? What say
  you", then "Fix it". The owner's eye was right: the icon opens the
  tutorial's own route. A glimpse reported from a phone is a frame the
  prerender painted; sample every frame in a check rather than trust a
  screenshot.

- *2026-10-09* — "Investigate the bar flickering", then "do it however is
  best and cleanest". Measure the frames before guessing: two were blank.
  My first fix passed typecheck and drew no bar at all; only the check I'd
  written first said so. Run it after each edit, not once at the end.

- *2026-10-09* — "Scan the code for complex rules that may equivalently be
  expressed as simple rules", then "fix everything that seems like a no
  brainer". Try each on the suites before claiming "equivalent"; one of mine
  was equal by value, not identity. Taste calls are not no-brainers: leave them.

- *2026-10-09* — "Critique search", then "make the fixes that don't impact
  the UI", then "the code should be simple, stuff should be obvious". Half my
  critique died on contact with the code; say so. Write the check first: it
  found a real sliver. Stage before a throwaway edit: I reverted my rewrite.

- *2026-10-09* — "Is this trigger even a good idea?" then "critique the
  following design", then theirs built anyway: sections answered my objection
  to ranking. Give the critique straight, then build what they pick — and
  while they test locally, leave their running app alone.

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
