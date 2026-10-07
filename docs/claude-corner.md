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

- *2026-10-07* — "Rate per expense … any other design decisions you need
  from me?" — it undid ADR-0005's last revision. Four asked questions got
  four answers, one with a rider ("also fetch on receipt scan"). Ask the
  calls that change data, decide the rest and list them.

- *2026-10-07* — "Too much text in the subtitles", then mid-build "show me
  designs first", with the rules for what may drop. Four mocks, "Ship A" (my
  pick). The constraints they give alongside a mock request are the spec.
  Then "animate the dock like the summary": reuse its clock, not its trigger.

- *2026-10-07* — "Make the group avatars little receipts, don't push", then
  bigger, torn both ends, no dots, "show me several", "ship it". The stop
  hook asked to push each turn; the owner's "don't push" outranks it until
  they say ship.

- *2026-10-07* — "Visually consolidate the top", I mocked three rethinks; "I
  meant more like the current layout but in a box". A vague brief about
  likeness wants the smallest literal move first, the bold ones after.

- *2026-10-07* — "Should we stop having the personal one unfolded?" — a
  question the second time, after my answer missed which fold. Answer with a
  pick, offer the change, wait: "fold it, leave the other ideas" came back.

- *2026-10-07* — Two screenshots: the ÷ breathes more on the form than on
  the summary. Measure the gap you see, not the margin you set: the form's
  column gap was the hidden 9px.

- *2026-10-07* — Two screenshots, "mock it up", then three one-line turns of
  tuning and "align left, and ship it". "Keep the existing special case" meant
  the line as it was, left-aligned and all: when a nudge says keep, check the
  original before obeying the adjective beside it.

- *2026-10-07* — "Pause and tell me when I'm contradicting an ADR". The
  owner moves fast and forgets old decisions; a quick "this undoes ADR-N, sure?"
  is welcome friction, not second-guessing. Ask once, then build.

- *2026-10-07* — "Should be only the link+icon (wash area)", in the same note
  as "clickable across the whole row". Not two rules: what the eye reads as
  one thing is one target, no more, no less. The wash names it. "Audit" meant
  look everywhere, then change only what breaks it.

- *2026-10-07* — "Least or most obvious first?" asked inside a build request,
  overturning a documented "point, don't explain". Answer with a pick and its
  reason, build that, and rewrite the doc's rule rather than defend it.

- *2026-10-06* — Brackets to a second line took four mock rounds: "roomier",
  "centred", then "ship that" — and mid-ship, "actually, smaller sizes". A
  live size toggle on the mock let them pick 12px alone. A ship order can be
  recalled: commit only once they stop tuning.

- *2026-10-06* — "Show me some designs before shipping", then "Ship slim
  band", not my pick. Five tabs on the real stylesheet made the choice a tap.
  A shared class reaches past the screen asked about: check what else wears it.
