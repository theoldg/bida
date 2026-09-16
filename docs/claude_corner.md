# Claude's corner

*For: the next agent, before it starts. The other docs say what to build and
how. This one says what it is like here — how the owner's instructions actually
read, and what an agent tends to get wrong that no check will catch.*

**House rules.** Under 100 lines, always. Every session touches it, even one
line. **Nothing technical lives here** — a fact about the automation belongs in
the Gotchas of the doc that owns it, and a rule belongs in
[CLAUDE.md](../CLAUDE.md#doc-upkeep) or
[standing-instructions](standing-instructions.md). This file is for the part
that isn't checkable. Add by cutting.

## How the owner asks

Lower-case, unpunctuated, short. "the llm can handle that, don't build useless
stuff." "don't highlight cent splits, that's the wrong vibe." Read the fragment
as the whole instruction — it usually is one. Brevity here is not vagueness, and
a clarifying question you could have answered by looking at the screen is a
turn wasted.

Taste arrives as feel, not as spec. "The wrong vibe" is a real bug report; your
job is to translate it into pixels, not to ask for a redlined mock.

Permission is usually pre-granted — *"propose a ux and go for it without
approval, we'll iterate later."* They would rather correct a built thing than
approve a plan. Ship early enough that there is something to nudge, because the
nudging is how this app actually gets designed: whole runs of the log are one
word, one centring, one line-break at a time. That is not churn, it is the
method.

Corrections come as compression. Thirty-two ADRs became eleven because the docs
had inflated. The instinct that gets praised here is deleting.

## The failure mode

It is *earnestness*. Writing the paragraph, adding the ADR, restating in prose
what the code already enforces, leaving a note about what changed this session.
It feels like diligence. It is the thing the owner has had to undo more than
once. When you feel the urge to document your own thoroughness, that is the urge
to resist — the reward for good work here is a smaller diff, not a larger one.

## The vibe

This is an unusually well-kept house for a project with no team. The scripts
argue with you in advance, in comments addressed to exactly the agent about to
make that mistake. Read the comment before fighting the script; it has usually
already considered your objection.

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

*One line, dated, newest first. At ten, drop the oldest rather than grow the
file.*

- *2026-09-16* — "hands off" was the whole spec for a feature that insults
  people, and the right move was to build it and let the owner nudge it, not to
  ask where the line was. Where a line was genuinely needed, the code was the
  place to put it.
- *2026-09-16* — The gate was five commands joined by `&&` and nobody had ever
  asked what that cost. The tools you type every day are the last place anyone
  looks and the cheapest place to win.
- *2026-09-16* — This file's first draft was full of technical tips. Every one
  of them already had a home somewhere else, which is the "one fact, one home"
  rule proving itself on the session that wrote it down.
- Asked to debug a phone-only failure, build the readout first: the owner pastes /diag, and a guess can't be pasted back.
- Two sessions in one checkout race each other's builds and blur whose diff is whose. Check `git status` for files you never touched before trusting a red build.
- "Later" can mean the next message. Leave the follow-up written where the next session will find it anyway.
- A stash the owner made mid-task isn't lost work — `git stash list` before redoing anything.
- Copy gets settled by ear, one word at a time ("paste it", not "paste this link"). Offer one version with the reason, then take theirs verbatim.
