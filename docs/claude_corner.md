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

- *2026-09-24* — "spliit is not a pwa, the scan does not have itemized
  split." I'd trusted its README's feature list; its source said total-only
  scan, assets-only worker. The owner had used the rival, not read about it.
  When the code is one clone away, read it before ranking the threat.
- *2026-09-23* — "should always be present… what do you think?" Asked for a
  view, so gave one and built it: "Group history", since the rows above it each
  open an entry's own. A question inside an ask wants an answer, not a menu.
- *2026-09-23* — "clicking a notification lands on gone for a while." The
  screen was right about this phone; the phone just hadn't heard yet. Missing
  and not-yet-arrived look the same until a sync answers, so wait for one.
- *2026-09-23* — "this is it, the app is perfect." No ask in it, so no
  change to go looking for. The session still starts in a worktree, still
  writes its postcard. A finish line is a place to stop building, not to
  skip the ritual.
- *2026-09-23* — "it disappears after I open and collapse it." One state
  meant both "unfolded" and "held"; folding dropped the hold, and seen was
  already marked. When a flag answers two questions, closing one closes both.
- *2026-09-23* — "review the recent changes ux… is it useful?" Reading the
  code said yes. Two phones in the driver said the fold repeats the rows just
  under it, and counts a join as a change. Ask whether it's useful on a screen,
  not in the source.
- *2026-09-23* — "what happens when there's over 40 subscribers?" A 413 on
  the ops push: a sync jammed for good. The file I added the cap to warned
  against exactly that. "Can we not batch it?" — a limit per request is a
  reason to split the request, not to drop what doesn't fit.
- *2026-09-23* — "get started on notifications.md." The plan's core step
  wanted a title and a url; core has no copy and no routes. Built the facts,
  left the words to web, and said so rather than bending the package rule.
- *2026-09-23* — "write the adrs." The ADR bar says built things only, so
  the decision went into a design doc written as the ADR it becomes. Honour the
  ask and the rule at once, and say which one bent.
- *2026-09-23* — "make sure it looks good for long and short numbers." A
  mono font makes width arithmetic: the figure's size is a CSS formula of its
  length, no measuring. Photographed 320 to 430 wide with 1,500,120.50 UZS
  before believing the formula.
- *2026-09-23* — "make sure the correct area lights up." The press rule
  named `a.card`; the settle rows are buttons. Held a real press and
  photographed it rather than trusting the selector: whole card, nothing in
  the gaps, edge bar still on top.
- *2026-09-23* — "don't offer translation if the receipt is already in
  English." The toggle already hid when no line differed; the model just kept
  "translating" shorthand. The owner asked about the bill, so ask the model
  about the bill, once, not line by line.
