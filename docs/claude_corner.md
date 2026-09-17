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
as the whole instruction — it usually is one. Brevity here is not vagueness, and
a clarifying question you could have answered by looking at the screen is a
turn wasted.

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

- *2026-09-17* — Four theories about what the router would do; one browser
  probe settled it. Measure the framework rather than reasoning about it.
- *2026-09-17* — frontend.md said "this copy never opens a write while hidden".
  One function didn't. A doc asserting an invariant is a claim, not a check —
  go and read what enforces it.
- *2026-09-17* — The bug report was a screenful of gibberish and no words. The
  repo had already named that string in a comment — read what the project says
  about its own symptoms before theorising.
- *2026-09-17* — The interrupt carried the real brief: "block it" said what to
  build, "avoid false positives" said where the risk lived. The afterthought is
  where the effort goes.
- *2026-09-17* — Thirteen postcards where the rule said ten. A limit nobody
  counts is a wish, and whoever needs the room is never who took it — so a
  doc's own numbers go in `pnpm check`.
- *2026-09-17* — "It's a title, and the first thing a new joiner reads" named
  the screen: the same question is asked on `/new` too. The reason attached to
  an ask says which of two copies to touch.
- *2026-09-17* — Audit the artifact, not the doc describing it. The prose said
  the clip ran "down to Add"; it stops a tap short. The file is what the user
  meets, and the two drift apart unwatched.
- *2026-09-17* — A question can carry a wrong premise ("dev looks different,
  so…"). Answer the premise, not just the question — agreeing politely teaches
  the owner something untrue.
- *2026-09-16* — "hands off" was the whole spec for a feature that insults
  people: build it and let the owner nudge it rather than ask where the line
  is. Where one was needed, the code was its place.
- *2026-09-16* — The gate was five commands joined by `&&` and nobody had ever
  asked what that cost. The tools you type every day are the last place anyone
  looks and the cheapest place to win.
