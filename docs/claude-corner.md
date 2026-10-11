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

- *2026-10-11* — "Do 1 and 2", pointing at another session's plan. Built
  both, then measured: fix 1 changed nothing, the stutter was layout. Ship
  what the numbers back and say what they killed; a plan read off the code is
  a guess until it is timed.

- *2026-10-11* — "Updates slowly on open", two /diag pastes, then "fine
  after a proper close, slow from the background". Theirs was the clue: count
  the pulls per resume, not their speed — one, where six were owed. I began
  editing before saying what; they stopped me to ask.

- *2026-10-11* — "Can we change the notification status bar icon to the
  apps icon?" One line, and the doc already claimed a badge the code never
  set. Trust the code over the doc, then make the doc true.

- *2026-10-11* — A screenshot and one line: "wrap the names with ellipses".
  "Wrap" meant cut. The demo's names are too short to show it, so I built a
  group with theirs and looked. And say something while the build runs: two
  nudges came before my first word.

- *2026-10-11* — "Audit the split mode tab logic … subtle unintuitive
  nonsense." Another session landed the same rework while I wrote mine; the
  push found out. Fetch dev before a rewrite and again before the tests, then
  keep only the faults theirs left: here, what a save wrote, not the tabs.

- *2026-10-11* — "How did this bug even arise". A copied pattern copies half:
  the query was kept like the position, but only the position was forgotten
  on a fresh visit. The check stopped one step short of the repro. Answer
  the how; it was the question.

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
