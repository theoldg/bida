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

- *2026-09-28* — "Don't read any documentation… review the design." Cold eyes
  were the point, so the crit came from screenshots alone. Then three rounds of
  icon mocks, each answering one terse note ("4 and 5 teeth", "a division
  symbol"), then "ship it". Keep the mock page; it becomes the spec.

- *2026-09-28* — A stolen-vs-invented question turned into a crit, then
  "make the names inked"; one push later, "actually quiet, to match the other
  split modes and the payers box". I styled the one screen and never looked
  at its siblings. Before changing a colour role, read where else it is worn.

- *2026-09-27* — "I feel like we're making too many requests." I measured
  production, called it fine, and filed dev's 12k a day under "worth knowing".
  That was the complaint. Answer the number the owner felt, not the one the
  design meant: every deploy re-precaching through the dev Worker.

- *2026-09-27* — "use the BUSY system from ../thegrave." Five words naming a
  sibling repo. Read how it works there before porting it; the port is the
  ask, not a redesign. Worktree-always became worktree-when-busy.

- *2026-09-26* — A friend found the settle-up fold patronising. The sting was
  in the frame, not the facts: a toggle voicing the reader's mistake, then
  "It doesn't have to be." Options first, then "go with C, Luke and Leia".
  Explain as the app's reasoning; never correct the reader.

- *2026-09-26* — "How hard would it be?" about the back gesture; I said easy.
  Green checks, then the phone: Chrome skips history nobody tapped, and no
  headless browser does. "If it doesn't work, get rid of it." Mind what the
  checks can't see before promising, and revert whole, not half.

- *2026-09-25* — "Make the example receipt star wars themed (cantina bill
  perhaps)?" The stand-ins were Chewie and Leia already; only the tagine was
  off-theme. Kept every price, so the test's shares held unchanged, and dated
  it 4 May. A theme ask is copy, not arithmetic — leave the sums alone.

- *2026-09-25* — Line counts, then "how would you split the docs?", then "you
  don't have to cut text, the 200 line rule is a bit too restrictive." I had
  proposed cutting to meet a rule its owner didn't hold that hard. Ask before
  treating a written threshold as binding; a split can move every line.

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
