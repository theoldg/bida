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

- *2026-09-19* — "it resizes when i click it" was exact. A control that swaps
  itself out for another has to be measured in both states; the screenshot came
  with the evidence already in it.
- *2026-09-19* — A typed bill failed every read, on the photograph's prompt:
  its two safest rules — never multiply, always a total — are the two that make
  typed words unreadable. Ask whose page it is.
- *2026-09-19* — The dialog reopened holding what it had just read. Its own
  answer had moved the panel to its other shape, so React unmounted it and
  mounted a fresh one. Position in the tree is state.
- *2026-09-19* — Hunting over-engineering, the count that paid was of classes:
  all 503 hand-written, a whole build step under none of its own. Ask what a
  dependency earns, not what it cost.
- *2026-09-19* — I read "nothing behind the ledger" off a harness that had
  opened `/new` by address, and planned a fix for it. The shortcut in the check
  was the whole finding.
- *2026-09-19* — "Flaky on slower computers" was true and not about speed:
  every failure was a pause standing in for a condition, betting on a machine
  that was not the one running it.
- *2026-09-19* — The screen that reports a hang was hanging: two seconds
  promised, six spent, each question waiting out its own. A budget spent one
  at a time is no budget.
- *2026-09-19* — Asked for long-running bugs, the log named them by repetition:
  one hang fixed four times. The fifth case sat where the lesson had a name and
  no check behind it.
- *2026-09-19* — Auditing page loads, I listed every route's dead ends before
  hunting a bug. Each find was one screen departing from a pattern the others
  kept. Read the pattern, then the exceptions.
- *2026-09-19* — The sentence I was told to replace wasn't in my checkout: the
  work sat a branch ahead. `pnpm session` first isn't ceremony, it is how you
  find the thing you were sent for.
