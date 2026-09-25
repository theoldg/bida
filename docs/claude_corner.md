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

- *2026-09-25* — "Says paid by 2 people twice. Maybe 'payers'? What do you
  suggest?" Counter-offered "Paid by" alone, matching the sibling eyebrow's
  phrase style; "Just PAID BY is ok." When asked for a suggestion, give one
  answer with its reasons, and let their word lose gracefully.

- *2026-09-25* — "Propose options" for a settle-up explainer. Four layouts
  photographed, then the owner wrote the copy and asked to workshop it. The
  fix that landed was seat, not words: put the reader where the example's
  stranger is. Push throwaways off dev; the gate still read them.

- *2026-09-25* — "Explore the demo as Luke, a first-timer who just wants
  to know why they owe X." No build asked, so none made: walked it blind and
  reported the feel. The arithmetic was fine; what read wrong was who the
  screens say did things. A feel question wants a verdict, not a patch.

- *2026-09-25* — "Reshoot the screenshots for the readme after the recent ui
  changes." One command, six PNGs; still looked at every one before
  committing. A rerun script is only as good as the eyes on its output.

- *2026-09-25* — "Why is the euro sign so tiny? Argue with screenshots." It
  wasn't: same size, same cap height, a third the width. Proved that, then
  "make both bigger", then "same as the small digits". "Argue" wants
  measurement, but the feel was right; the fix followed it anyway.

- *2026-09-25* — "Go with A, remove the third line." Built, the band read
  "by ?" for a beat while the log loaded — there all along, unseen in grey
  small print, loud in an inverted block. Emphasis promotes its bugs too.

- *2026-09-25* — "give some attention to the start/bottom" of the history
  line. Four variants from a plain stop to a captioned start; the owner took
  the plainest. I sent contact sheets though a postcard below says phones
  one per image. Read the postcards before shooting, not after.

- *2026-09-25* — "Fix all", after a list of simplifications promised not to
  change the app. One didn't survive a closer read: each device setter's
  early return decides "unchanged" its own way. Report the one that fell and
  why; forcing it would have broken the promise the list was made under.

- *2026-09-25* — "scroll down a bit lower so the tip jar FAB isn't in the
  way." The spacer was a fixed 24px; the ledger's is a fixed 88, both blind to
  the home indicator. Sized it off the FAB's own variables. A gap with a
  number in it usually belongs to something else's size.

- *2026-09-25* — "Title it entry history and propose a few styles and labels"
  for the button. Built the title, then six variants behind a throwaway query
  switch, shot on the demo group one phone each. Ship the settled half; photograph
  the open half rather than listing it.

- *2026-09-25* — "Show them as individual pics pls, not enough pixels."
  Contact sheets of phones shrink to thumbnails on a phone, which is where the
  owner looks. Then B, explored, then B1 picked. Send one phone per image at
  2x; a sheet is for me to check the spread, not for them to judge it.

- *2026-09-25* — "Could the demo URL stay /demo? Explain, I'll think."
  Answered no to the ask as put and pitched the redirect. That fixed the
  copied link from every screen, where /demo would only fix one. "Do your
  version." When asked to explain, say which half of the ask does the work.
