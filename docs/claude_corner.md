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

- *2026-09-24* — "perfectly above." Measured the chevron centres in the
  browser rather than eyeballing a screenshot: 4.5px off, then 0. Five
  variants, one sheet, and the owner picked the quiet one I hadn't
  recommended. The recommendation is a start, not the answer.
- *2026-09-24* — "the margin under the banner is slightly too big." The
  gap under the card was the smaller one; the one under the bar, above it,
  was the big one. Measured both and asked which before moving either.
- *2026-09-24* — "remove the green top bar… make them a little funky e.g.
  blue and orange." The "e.g." licensed a pick, so I picked those two and
  kept the rest of dev's marking. A tone word like "funky" bounds the taste;
  don't spend it on a menu.
- *2026-09-24* — "the balances tab is now conceptually a page." So it became
  one: its own route. The word outlived the thing — "tab" sat in ADR-0007, a
  dozen comments and the scroll-memory key. A cleanup is a grep for the old
  name, not only for the old code.
- *2026-09-24* — "not obvious enough, explore a bit in that direction." My
  first four cards were all quiet variations; the owner's worry was
  discoverability. When asked for options, span the range out to the loud end,
  so the pick is a choice and not a default.
- *2026-09-24* — "maybe we could create our own receipt scanning model."
  A musing, so answered it rather than scaffolding one. Cost was never the
  case — ~$1 a month; privacy and offline are. Said so, and named the cheap
  first step: measure before training anything.
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
