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
translate it into pixels, not a redlined mock. A breakage comes the same way —
a screenshot, "sometimes", no console — and a repro matching that symptom is
not yet the cause. "Redesign slightly" means what it then lists, "make it
slightly harder" means take the affordance away, not warn twice. Copy settles
by ear, one word at a time: offer a version with the reason, then ship theirs.

Permission is usually pre-granted — *"propose a ux and go for it without
approval, we'll iterate later."* They would rather correct a built thing than
approve a plan. "i thought i said i wanted that" is a spec arriving late, not a
complaint: build it, skip the archaeology. A call they do keep is named in the
same breath as the ones they hand over, and its honest home is the tool: make
it refuse. Ship early enough to be nudged — whole runs of the log are one word,
one centring, one line-break at a time. Not churn: the method.

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

- *2026-09-20* — Asked to fact-check one delete warning against the code, and
  found a different screen — the success one — was the copy that had actually
  drifted from what deleting now does.
- *2026-09-21* — Same Discard, dead on one install and fine on another, same
  version. Three theories off the code, all wrong; one trace settled it. The
  variable was a number I had not thought to read.
- *2026-09-21* — Twice I explained an iPhone paste bug from search summaries;
  twice the fetched page said the opposite. The owner's "works fine on android"
  cut more than all the reading.
- *2026-09-21* — Asked to explain one bug, I led with the more interesting
  concept next door, and had to be asked twice what it had to do with the
  symptom. Catch them up on the bug they have.
- *2026-09-21* — "the lock and messenger link are resolved": two watches closed
  on a phone I cannot see, and one of them hid a line still marked unfixed. Ask
  what resolved covers before deleting it.
- *2026-09-21* — "hide the install banner in the demo": the card's own comment
  already carried the rule — draw it only once there is a group to lose. The
  demo was an instance of one written down.
- *2026-09-21* — A phone in hand closed four watches in one message. The
  clipboard retry I had reasoned out so carefully was three extra taps: a
  retry the person has to approve is not a retry.
- *2026-09-21* — Asked to animate one button, its neighbour's comment said the
  two confirm "the same way". Doing only the one named would have quietly made
  that sentence false.
- *2026-09-21* — "drop the minus, it's already red and says you owe". The same
  reason took the plus with it. Ask whether the argument is symmetric before
  fixing only the half you were handed.
- *2026-09-21* — "figure it out, other online tools manage it." They were
  telling me where the answer was, not that I was clever. Three published
  clients had the protocol; reasoning had none of it.
