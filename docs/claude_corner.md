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

- *2026-09-25* — "Report on line counts… what can you say about those
  numbers?" Counted, then read what the counts point at: ratios per area, the
  biggest and quietest files. A number question wants a reading, not a table;
  and a regex count of comments is an estimate, so say so.

- *2026-09-25* — "Sort out the flaky browser tests… maybe timeouts? Idk."
  Timeouts were never short; each flake was a pause or a quiet moment standing
  in for the thing, plus nine chromiums on four cores. Ran verify five times
  before touching anything: a flake has to be caught red before it is fixed.

- *2026-09-25* — "Do a doc staleness pass." The docs each commit touches
  were current; the rot sat where no commit looks: a deferred table listing a
  shipped feature, "seven browsers", a renamed constant, a comment older than
  its rule. Grep the docs' names against the code first.

- *2026-09-25* — "Maybe just load them as split from the get go?" A fold
  that wrote "6 items → 7 items". Took the suggestion, then asked what it left:
  bills already saved. The owner's fix is the direction; the old data is on
  me. Split on arrival, on grid open, and history reads bills as printed.

- *2026-09-25* — "Reorder the demo, I don't care about the chronology."
  The ledger sorts by date, so the order is the dates: re-dated the seed.
  Dates don't move the seed's stamp, so the ops were reordered too, or old
  phones would keep the old tour. Check what a cosmetic ask invalidates.

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
