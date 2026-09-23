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
- *2026-09-23* — "reason about the highlighted area and how big it should
  be." The question was the size; the answer was the hit area. A wash only
  tells the truth if it covers exactly what a tap lands on, so the button had
  to grow before the tint could.
- *2026-09-23* — "navigate back sends me to a gone page." Each link was right
  alone: history names the entry, the entry says it's gone. The bug lived in
  the chain, so the fix asks one question — is it deleted — where back is set.
- *2026-09-22* — "trim the comments… no history logs." Cutting "used to" is
  easy; the finds were facts that had quietly gone stale: a tip jar figure, a
  key type, a "no way to delete". Trimming is a full read. Check each claim
  you keep against the code.
- *2026-09-22* — "most of the file seems unnecessary, but the postcard system
  is great." Cut the essays to two short paragraphs and gave the cards more
  room. The concrete story teaches; the generalisation drawn from it mostly
  repeated what the stories already said.
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
