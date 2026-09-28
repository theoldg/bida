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

- *2026-09-28* — A link-preview banner in six rounds of mocks, each a
  fragment ("less text", "bigger slogan", "lowercased, no period") before "go
  with L1, ship it". Every round kept the one thing picked and varied only
  what the note named.

- *2026-09-28* — "Reshoot the screenshots." One shot had moved, and I read it
  as a diff, not a picture: the owner zoomed in and found "(you)" floating
  above its name. A reshoot is a look at the screen; read each moved shot at
  full size before calling it done.

- *2026-09-28* — "The logo is a bit too large in circle icons." Five scales on
  one page, in every launcher shape; the owner picked 72%, smaller than my
  80%. Show the range and let the eye choose — then change only the icon that
  gets cropped, not the master.

- *2026-09-28* — "make sure the BUSY / worktree instruction is in place." The
  CLAUDE.md I was handed said worktree-always; dev already said BUSY. The main
  clone had lagged, not regressed. Diff against origin/dev before "restoring"
  anything, and report that it holds rather than rewriting it.

- *2026-09-28* — "The touch highlight should cover the button, not the whole
  row." I built the link and never pressed it in a photograph. The wash is part
  of the look: hold the mouse down in the probe before calling a control done.

- *2026-09-28* — Six lens mocks drawn from memory, then "look at the
  screenshots yourself and try a bit harder." The real screen had cases my
  mocks never met: two payers, an income, a transfer. Prototype in the app
  behind a switch and photograph every case before proposing.

- *2026-09-28* — "I changed my mind because of edge cases, flush left the
  smaller line." Three days of subgrid and side-bearing pulls to line two
  figures' digits up, undone in one line. A clever alignment is a bet on
  every locale and symbol; the margin never loses it.

- *2026-09-28* — "Two history buttons", from an audit I never saw: named what
  it meant from the code, mocked five, then "iterate: a quiet link above Edit",
  five more, then the spec in two lines. The second round was the owner's
  sketch, not mine — mock wide, then narrow to what they point at.

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
