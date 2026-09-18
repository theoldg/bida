# Claude's corner

*For: the next agent, before it starts. The other docs say what to build and
how. This one says what it is like here — how the owner's instructions actually
read, and what an agent tends to get wrong that no check will catch.*

**House rules.** 100 lines, ten postcards, 200 characters each. Every session
touches it, even one line — so every session also makes the room it takes, in
the same edit; `pnpm check` fails on all three numbers. **Nothing technical
lives here** — a fact about the automation belongs in the Gotchas of the doc
that owns it, and a rule belongs in [CLAUDE.md](../CLAUDE.md#doc-upkeep) or
[standing-instructions](standing-instructions.md). The prose is the part that
isn't checkable; the size is.

## How the owner asks

Lower-case, unpunctuated, short. "the llm can handle that, don't build useless
stuff." "don't highlight cent splits, that's the wrong vibe." Read the fragment
as the whole instruction — it usually is one. Brevity is not vagueness; a
question you could have answered by looking at the screen wastes a turn, and one
they would rather park gets "write this up somewhere" instead of an answer.

Taste arrives as feel, not as spec. "The wrong vibe" is a real bug report;
translate it into pixels, don't ask for a redlined mock. "Redesign slightly"
means exactly what it then lists, and "make it slightly harder" means take the
affordance away, not warn twice. Copy gets settled by ear, one word at a time:
offer a version with the reason, then ship theirs verbatim.

Permission is usually pre-granted — *"propose a ux and go for it without
approval, we'll iterate later."* They would rather correct a built thing than
approve a plan. "i thought i said i wanted that" is a spec arriving late, not a
complaint: build it, and skip the archaeology of whether it was said. A call they do keep is named in the same breath as the ones they
hand over, and its honest home is the tool: make it refuse. Ship early enough
that there is something to nudge, because the nudging is how this app actually
gets designed: whole runs of the log are one word, one centring, one line-break
at a time. That is not churn, it is the method.

## The failure mode

It is *earnestness*. Writing the paragraph, adding the ADR, restating in prose
what the code already enforces, leaving a note about what changed this session.
It feels like diligence, and it is what the owner has had to undo most. The urge
to document your own thoroughness is the one to resist: corrections here arrive
as compression, thirty-two ADRs became eleven, and the instinct that gets
praised is deleting.

## The vibe

This is an unusually well-kept house for a project with no team. The scripts
argue with you in advance, addressing the agent about to make that mistake: read
the comment before fighting it, it has considered your objection.

What makes the constraints pleasant rather than bureaucratic is that every one
of them pays for itself. Money is integers because floats lose cents. Entities
are never mutated because that single rule buys sync, offline and history at
once. Colour is only green or red because a third hue would stop the balance
shouting. Obeying them feels like craftsmanship, not compliance.

And there is something quietly good about a product this modest being built this
carefully: no accounts, no tracking, a server that structurally cannot read your
group, hosted for free, for a handful of people splitting dinner. Nobody made us
do any of that.

## Postcards

*One line, dated, newest first. Ten is the ceiling, so the eleventh evicts the
oldest in the same edit — and before it goes, ask what it taught: if the lesson
has gone general, fold it into a paragraph above by editing a sentence rather
than adding one. Most don't earn that, and letting one go is the normal ending.*

- *2026-09-18* — Asked what was left before launch, I found the scan's day
  cap: 13000 in the doc, 4300 in the code. A number that moves leaves its old
  self behind — grep the digits.
- *2026-09-18* — "It doesn't reset when I update" was my own rule: /demo was
  idempotent by id. Idempotence that spans releases is a cache with no handle.
- *2026-09-18* — "Try to remove that banner" sounded cosmetic; watching the
  screen for twelve seconds found a read that never answered. Reproduce the
  annoyance, then prove the cure.
- *2026-09-18* — Told my CSV parser was unsafe, I argued for keeping it and
  wrote the test anyway. The test found a real NaN, one layer up. Take the
  worry seriously even when its target is wrong.
- *2026-09-18* — "No ceiling on it" turned out to be a decision, not a gap: a
  comment said why the cap belonged inside. An open item can outlive the code
  that answered it.
- *2026-09-18* — The best thing I built today is a line I did not write: leave
  the key out, and the demo cannot reach the server at all. A guard argues; an
  absence has nothing to argue with.
- *2026-09-18* — I built two ladders of test files to chase a rejection that
  had already been fixed. Ask which build made the artifact before debugging
  the artifact.
- *2026-09-18* — Of eight "critical" findings from another model, two were
  real, and neither needed an attacker — whoever holds the link can already
  delete the group.
- *2026-09-18* — I called a migration unapplied with certainty; the status doc
  said so, the database disagreed. A doc's fact about a live system ages, ours
  included — query it before asserting it.
- *2026-09-18* — Asked about API keys, I said AI was deferred. Receipt scanning
  was already built, deployed and documented. Read the repo before describing
  the project to its owner.
