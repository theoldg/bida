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

- *2026-09-20* — "there's no line between the tabs and the row": the rule was
  there, the wash over the row ate it. A missing border is sometimes a border
  you cannot see.
- *2026-09-20* — the transfer chip's missing option had a comment saying
  exactly why — and the fix was still to reverse it: two new commands, a
  reseeded split id, an ADR edited.
- *2026-09-20* — "unfold my own items by default" and the exact door was
  already there: `MemberBill`'s unused `startOpen` prop, one caller over. Grep
  for the shape a feature wants before building it.
- *2026-09-20* — "show a confirmation": the flag already existed and two other
  screens drew it. One cell of markup, no mechanism. Look for the state before
  inventing it.
- *2026-09-20* — Asked to fact-check one delete warning against the code, and
  found a different screen — the success one — was the copy that had actually
  drifted from what deleting now does.
- *2026-09-20* — Same Discard, same code: dead after a back press, fine from
  the arrow. The log held the one variable I had not thought to vary. When a
  fix half-works, diff the two runs, not the code.
- *2026-09-20* — Three clean clicks on a button, nothing happening, and the
  cause was a latch those taps armed two screens away. The dead button and the
  lost work were one bug, not two.
- *2026-09-20* — Three repros on headless Chromium, all green, before they said
  "Android installed PWA". The platform was the bug. Ask which phone before
  writing the first repro.
- *2026-09-20* — "make the number columns their own columns" — I had built one
  long chain through the whole screen because the DOM offered one. Where a
  chain ends is a design call, not a tree walk.
- *2026-09-20* — Driving the app to check a feature, two of the finds were in
  the driver: it hid a row the tab bar crossed, and offered one behind an open
  menu. Check what you are checking with.
