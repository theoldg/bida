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

- *2026-11-21* — "what's up with the penny here?" on a screenshot. I had
  tucked the split's rounding cent into a line, so 1.66 sat beside a tag
  saying 1.67. The fix was saying the cent on its own line: shown sums must
  check by hand, or the owner will check them.

- *2026-11-20* — "Use the most expensive days and nights type expense as the
  source of truth for who's checked". Two questions it left open — a date
  that stay doesn't reach, a date moved after — answered as the trip would:
  the priciest stay reaching the day, followed until touched.

- *2026-11-20* — "prototype without pushing", then "make it a separate
  screen … reuse as many styles from the item assigner as possible … push to
  dev". My mock drew a new grid; the answer was the one we had. Sketch a new
  screen in an old screen's parts first.

- *2026-11-16* — "Why aren't the payers sorted by amount here?" A why on a
  screenshot is a fix, not a question. The form already sorted them; the entry
  screen took core's id order. Where one screen does it right, the answer is
  "this one forgot", and the fix copies it.

- *2026-11-16* — "make them case insensitive: Teo --> Te, tobi --> To".
  The examples said two things: compare case-blind, and print capitalised —
  "tobi" came out "To", not "to". An example's output is part of the spec.

- *2026-11-15* — A screenshot of nine "nobody →" lines: "Handle the history
  better for this case". The case was the grid's first filling, so its heading
  became the split going by items too — the photo showed one symptom; the fix
  owed the sentence above it as well.

- *2026-11-13* — "Move Staś mode, the polish language control and the scan
  crop … to a separate screen … Use the same style as advanced settings".
  The style was a look, so the toggles became Settings' segmented pairs and
  the crop a chevron row — not the old buttons on a new page.

- *2026-11-03* — "Are you sure you're reading them right? There's a consistent
  upwards bias". I'd called it the model's noise; a synthetic bill proved my
  reading right, and their two photos proved the bias real. When the owner sees
  a pattern in the pictures, check your own code first, then show it.

- *2026-11-03* — "Make the receipt image viewers zoomable (preferably keeping
  the exit cross in position)". Two viewers drew pinch twice; one now. Closing
  on the lift let the tap's click reopen the miniature underneath — the old
  code's on-click close was a reason, not an accident.

- *2026-11-03* — "build a backstop … and tell me what else to do on
  cloudflare". Buckets and a production migration waited for the owner's own
  word, which came in one line. Two drive sessions shared one queue and split
  my commands between them: look for strays first.

- *2026-11-03* — "Is anyone actually using bida?" I read eight long-lived
  groups as friends' trips: "just me testing". And my weekly buckets filed
  Mondays a week early, so the owner's own count of November corrected mine.
  Usage numbers: ask whose they are before telling their story.

- *2026-11-01* — "the space under the expense link is too small. Adjust it
  tastefully". A negative margin had tucked the link's tap padding away, so
  the underline sat on the next line. Measured against the gap above it in
  the photo, not by eye in the CSS.
