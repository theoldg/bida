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

- *2026-10-21* — "The diag screen takes a while to open when there's a lot of
  logs". The guess was the database wait; a profile said layout, every 2s, of
  lines that hadn't changed. Measure before choosing which of the owner's
  offered fixes to build.

- *2026-10-21* — "The copy button wash should respect the margin here", then
  "(or at least have some margin)". The second line widened the first: an inset
  is enough. A press wash only shows while held, so drive learnt `down` to
  photograph one rather than guess it from the CSS.

- *2026-10-20* — "Equally rude but less specific so the model gets to be a
  bit more creative". Two example roasts and two lists of targets were a
  script it could only recite. Then "where else": in the reading, each example
  is a fixed misreading — keep those; only the jokes want room.

- *2026-10-19* — "Flash 'assign who had what' after scanning … not in quick
  split". The FAB's scan lands a screen before the button exists, so the
  flash is a mark left by the scan and taken by the button. Sample frames to
  see a flash: one shot at a guessed moment says nothing either way.

- *2026-10-19* — A receipt photo and "it doesn't work". No key here to scan
  with, but the paper did the arithmetic: three "discount included" notes, a
  sum matching only without them. Asked "would logs help?", say what the
  guess rests on — then build the log that makes the next one a reading.

- *2026-10-19* — "Update the screenshots". One script, six pictures, and all
  six moved — but a diff of every pixel says nothing. Set each beside its old
  self and look: the changes were the week's real ones, so the run went in
  as it came out.

- *2026-10-19* — ""Change bill" should be below the main button … Does that
  make sense?" The doc already said beneath. Then two redirects mid-build,
  ending on "try something different": no label, "Rescan". An interrupt is
  the review; drop the old idea whole, not half-kept.

- *2026-10-18* — "Sometimes shows me empty space instead of skeletons … no
  need to rewrite the app". The window was fine; only its spacer was blank.
  Painting the spacer as rows cost one CSS rule and covers any speed. "Not a
  huge deal" sizes the fix, not the care.

- *2026-10-18* — "When deleting a group, it jumps to the top of the list
  before animating". The fold was fine; the forget wrote one plumbing op first,
  and the list read it as activity. A motion bug can be a data bug a frame
  early: ask what the list saw before asking how it moved.

- *2026-10-18* — "Why do we need to send static txt through the worker that
  sounds dumb". It was a Next bug, fixed in 16; the upgrade was the fix. Then
  "look up more tricks": measure each one before reporting it. Six flags
  saved nothing, and a polyfill nobody runs was a tenth of the chunks.

- *2026-10-18* — A Reddit comment, forwarded: "fix the selection issue and
  check the target blank thing just in case". The CSS already said nothing
  selects; a scan of every screen's computed style found the two opt-ins that
  did. The links were already fine; "just in case" wants that said.

- *2026-10-18* — "The Reddit browser escape doesn't work", a /diag and no
  more. A tap I can't watch can't be fixed by guessing how it failed: put the
  host's own way out under the button, and say which guess the fix rests on.
