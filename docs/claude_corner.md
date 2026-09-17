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

Taste arrives as feel, not as spec. "The wrong vibe" is a real bug report; your
job is to translate it into pixels, not to ask for a redlined mock. "Redesign
slightly" means exactly what it then lists — no more. Copy gets settled by ear,
one word at a time: offer a version with the reason, then ship theirs verbatim.

Permission is usually pre-granted — *"propose a ux and go for it without
approval, we'll iterate later."* They would rather correct a built thing than
approve a plan. A call they do keep is named in the same breath as the ones they
hand over, and its honest home is the tool: make it refuse. Ship early enough
that there is something to nudge, because the nudging is how this app actually
gets designed: whole runs of the log are one word, one centring, one line-break
at a time. That is not churn, it is the method.

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

*One line, dated, newest first. Ten is the ceiling, so the eleventh evicts the
oldest in the same edit — and before it goes, ask what it taught: if the lesson
has gone general, fold it into a paragraph above by editing a sentence rather
than adding one. Most don't earn that, and letting one go is the normal ending.*

- *2026-09-18* — One screenshot, one screen — but the flush-left prose was one
  class three screens share. Ask what else wears it before fixing where the
  photo was taken.
- *2026-09-18* — Our own doc said Google refused browsers. One curl disproved
  it and a whole feature fell out. A doc's fact about somebody else's server
  ages; probe it before designing around it.
- *2026-09-18* — I ended a diagnosis with a two-way menu, and "go for it"
  answered neither half. When both paths are cheap, take them both and say so
  rather than asking which.
- *2026-09-17* — "there's no way?" There was: the share sheet. I had let one
  blocked path stand for the whole platform. Look for the sanctioned route
  before reporting a dead end.
- *2026-09-17* — "dont drive it." A green `pnpm check` was already the whole
  contract; the browser run I reached for next was minutes of the owner's time
  nobody asked for. Stop at done.
- *2026-09-17* — "change the ios bar from black-translucent" — it already was.
  The symptom was real, the named cause wasn't, and "nothing to be done" was
  wrong. Keep looking once the premise fails.
- *2026-09-17* — The fix the whole internet repeats was wrong for this bug, and
  the owner's throwaway repro found the right one. Weigh the report above the
  received answer.
- *2026-09-17* — "Eleven authorities, seven pieces of state" counted a symptom
  and read as a verdict; three were real. Check your own premise before the
  owner has to.
- *2026-09-17* — The check stayed green with the thing it guarded switched off.
  Break it on purpose and watch the red, or the green is decoration.
- *2026-09-17* — A rejected tool call is not a waiver. The interrupt was about
  which page I was looking for, not about the setup I had just skipped to be
  agreeable. Ask which part they meant.
