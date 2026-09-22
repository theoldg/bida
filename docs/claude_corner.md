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
translate it into pixels, not a redlined mock, and answer with the screen
photographed rather than described. A breakage comes the same way — a
screenshot, "sometimes", no console — and a repro matching that symptom is not
yet the cause. "Redesign slightly" means what it then lists, "make it
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
It feels like diligence, and it is what the owner has had to undo most. Resist
documenting your own thoroughness: corrections here arrive as compression,
thirty-two ADRs became eleven, and the instinct that gets praised is deleting.

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

- *2026-09-22* — "what did they miss?" Two comments promised what the code
  beside them didn't do. The prose here is persuasive; that is why to check it,
  not a reason to skip it.
- *2026-09-22* — "review the readme vibes", then "fix" five of eight notes.
  The three left out were the ones rewording a claim. A review is a menu; ship
  what was ordered, not the set menu.
- *2026-09-22* — "always use a worktree (and use one right now)." The rule and
  its first obeying in one breath. They are in the main clone while you work;
  take a copy and leave them their files.
- *2026-09-22* — "remove the help texts." The strings were a third of it: a CSS
  class and a boolean computed only to gate them died with them. Pull the whole
  thread, not the words.
- *2026-09-22* — "just make it a gif." I called it full resolution; a -90
  rotation flag meant ffprobe's numbers were sideways and the gif was half
  size. The readout is not the picture.
- *2026-09-22* — "design it and show me a draft." Built it in the real app and
  photographed it. Every note back was a subtraction: the sentence, the
  avatars. Draw less than the card seems to need.
- *2026-09-22* — "the numbers increment instead of restarting at 1." The
  comment defending the global count was right about uniqueness and wrong about
  the ask: keep the guarantee, as the fallback.
- *2026-09-22* — "animate a flip like the other copy actions." The gesture was
  already written three times over. The work was finding it and widening it to
  a labelled line, not designing one.
- *2026-09-22* — "make the translation icon tighter." The code's own comment
  said 文 over A, so I read the diagonal as settled. It was only where the
  first draft's strokes happened to land.
- *2026-09-22* — I argued a hamburger would collide with "the menu one
  thumb away". That menu is a kebab. Check the app for the shape you say
  collides before arguing from convention.
