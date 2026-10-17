# Claude's corner

*For: the next agent, before it starts. The other docs say what to build and
how. This one says what it is like here — how the owner's instructions actually
read, and what an agent tends to get wrong that no check will catch.*

**House rules.** 100 lines, twelve postcards, 300 characters each — `pnpm
check` fails on all three. Every session adds a postcard and evicts the oldest
in the same edit; `pnpm push` merges two sessions' cards. Nothing technical lives here: a fact about the code belongs
in the Gotchas of the doc that owns it, a rule in
[CLAUDE.md](../CLAUDE.md#doc-upkeep) or
[standing-instructions](standing-instructions.md).

## What the postcards keep teaching

The owner writes lower-case fragments; read each as the whole instruction.
Taste arrives as feel ("the wrong vibe") — answer with the screen photographed,
not described. Permission is usually pre-granted: build, then be corrected —
but "wait for my approval" means stop until a yes.
When a request undoes an ADR, say so ("this undoes ADR-N, sure?") and wait for the yes.
A request naming something this session never saw ("the flags", three answers to
unasked questions) is another conversation's: ask which, that turn, not later.

The failure mode is *earnestness* — the extra paragraph, the ADR, prose
restating what the code enforces. What gets praised is deleting — and when
told to cut, drop whole comments and sections; squeezing each into a denser
sentence is the same earnestness, compressed.

## Postcards

*Dated, newest first. Before evicting one, ask what it taught: if the lesson
has gone general, edit a sentence above to hold it. Usually it just goes.*

- *2026-10-17* — "When i click fast it's buggy", the who-had-what grid on
  an iPhone. Three clicks in one frame reproduced it; the cause was a habit,
  not a line, and "look for similar bugs across the whole app" found it in
  the split steppers and payers too. Fix the pattern, not the screen named.

- *2026-10-17* — "Add an up/down chevron to the currency picker". refusals.md
  said the other chips carry no mark, on purpose: a one-liner can overrule a
  written rule, and then the rule's sentence goes in the same commit.

- *2026-10-17* — "Fix the flash that happens on deleting the last entry".
  A click showed it for one frame; a phone's tap for 260ms, since the tap on
  the dialog counted as a finger on the list. Drive a "flash" by touch, frame
  by frame, before deciding it is small.

- *2026-10-17* — "Adding an item to an already split bill accepts saving
  without assignment!" The cause was ten commits ahead of my clone: pull
  before tracing, or a bug in code you can't see reads as no bug. The fix
  was one question asked in two places, not two answers.

- *2026-10-17* — "Replace the trashcan … everywhere (new group, who am i, …)".
  The who-am-I list never had one; the list was the owner's map of where to
  look, not a promise each stop holds a bin. Three screens moved, one said so.

- *2026-10-17* — "All non-docked buttons travel slightly down when the
  keyboard opens", on both phones. It was this morning's fix for the add row:
  air that came only with the keys. Its check knew only a crowded list; the
  short one, where the act sits on the row, is the one a thumb meets first.

- *2026-10-17* — "So if the grid has the translation toggled on, the
  editable item names should be the English ones, right": a question that was
  the request. The display was the easy half; what a typed name saves was the
  design, and they answered it in one line once it was put to them.

- *2026-10-17* — "Just say copied instantly … what's the timeout, like 1
  second?" It was 15. Then "publish it as the page shows — argue if you
  dislike it". Its two costs (a row per answer viewed, a slow upload called
  failed) said in one breath, then built: "argue" is not "wait".

- *2026-10-17* — "Propose a manual item editor", then a round a reply. "The
  amount field should be editable" meant the count, not the total I'd
  recoloured: a vague noun over a screenshot is a question. And "wow, a whole
  new class of refusals": name what a new power breaks before they find it.

- *2026-10-17* — "Do you like it?", then "maybe just never auto-jump", then
  "make it rock solid". Freeing the scan opened a hole the old gate had hidden:
  a read in flight with nobody named left unasked, and its answer greeted the
  next visit. Each fix was deleted once to watch its check go red.

- *2026-10-17* — "The keyboard is too tight against the add someone row", a
  screenshot of /quick. The check had asserted the caret above the keys, and
  it was; the box around it was what got cut. Measuring the box turned all
  six docked screens red at once: a thumb sees the field, not its caret.

- *2026-10-17* — "Something about it is not great", of two buttons. I named
  three faults and rebuilt all three; the answers kept the arrangement, put
  the old button back and cut my new line. Fix what was felt, show it, and
  let the rest be asked for.
