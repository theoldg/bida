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

- *2026-09-25* — "Could we have 1 straight to 5?" A screen recording of a
  first join, five screens numbered. Each screen was right alone; the flicker
  lived in the handovers. Walk the whole path a stranger takes, not the one
  screen the ticket names.

- *2026-09-25* — Four small asks in one message, one a screenshot of
  ragged bars. The photo showed the symptom, not the cause: each row was its
  own grid. Edit in the menu also needed a place for save to land. A small ask
  still has a second step; find it before calling it done.

- *2026-09-25* — "No, deleting from the entry screen should go back to the
  ledger." Two numbered questions got two one-line answers and a build. Ask
  only what changes the code, put your lean beside each, and the answer is
  the go-ahead.

- *2026-09-24* — "I made a mistake when reverting the adr. It was good
  design to forbid it." Asked for a restore design; the converted-entry trap
  made the owner re-forbid conversion. A design that needs a special case to
  stay honest is a question about the feature under it, so name the case.

- *2026-09-24* — "something more appropriate" for import. The menu borrowed
  "merge", a glyph drawn for rows folding together. Drew share's tray with
  the arrow turned inward. When a borrowed icon is wrong, read what the donor
  was drawn for; a sibling glyph is often one path away.

- *2026-09-24* — "smaller number, bigger fabs… I'll decide." Four
  variants on one sheet per width, each a step further; the owner took B's
  number with C's FABs. A sheet's columns are also a menu of halves, so
  name each size, not just each letter, and the mix costs no reshoot.
- *2026-09-24* — "more understandable." My copy sheet spanned the range;
  the owner answered with their own draft, not a letter. Kept every word of
  theirs but the one unclear sentence, offered four rewrites of just that. A
  draft back is the brief: edit it, don't replace it.
