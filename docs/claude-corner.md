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

- *2026-10-17* — "Just say copied instantly … what's the timeout, like 1
  second?" It was 15. The guess was the owner's picture of the wait, not a
  number to set: the answer was the button flipping at once and the upload
  left silent unless it fails, the timeout untouched.

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

- *2026-10-16* — "Propose a design for link sharing": three rounds of words
  before "Build it" — the fragment too long, KV lost to D1, the text option
  dropped. Mid-build the text came back as a summary around the link:
  dropped meant "not instead of the link", not "no words".

- *2026-10-16* — "The in-app browser detection doesn't work for
  brave-in-reddit". Nothing to reproduce it on, and /diag never said which
  agent it read; so the fix shipped first was the report learning to say.

- *2026-10-16* — "It skipped me past identity claim into an all-grey group",
  a /diag from the demo. The trace showed a re-seed restoring a claim; grey
  meant "not yours" on every row, so the claim named nobody — someone the
  visitor had added. The check reproduced it red before the fix.

- *2026-10-16* — "Propose a cheap way to make it more desktop friendly", then
  a tool call rejected mid-read: a screenshot was coming, and "propose" meant
  words first. Of my three steps the shot dropped one — inset dividers would
  have fought the full-width day bands.

- *2026-10-16* — "Does this make sense, to get rid of the top-bar blur?", a
  test on iOS 27 that contradicted our Gotcha's "always". Their phone outranks
  the doc: the build is their finding plus the doc rewritten, checked by them.

- *2026-10-16* — "The notification toggle freezes", a /diag pasted: its
  order held the cause, a hung call queuing every tap. My cut-off fixed the
  hang, not the wait — "works but janky and slow". The level should never
  have waited on the browser at all.

- *2026-10-16* — "I had to click back twice", two /diag pastes from a
  simulator. The reports held it: a list restored by Back reloading for its
  manifest, read as a launch. Playwright turns the page cache off; turning it
  back on reproduced it before the one-line fix.
