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

- *2026-11-23* — "The 1 second wait seems useless … what is it for?" A doubt
  about a number: say what it bought and what it cost (tobi's entry, pocketed
  inside that second), offer the fix, and build on the yes. It came at once.

- *2026-11-23* — "Check out this group … anything bugged?" A live group is
  people's money: read it through the API, never join it. The NUL I called a
  blank gap draws as a box on the owner's phone. "Let's wait for more data":
  a look was asked for, not a build.

- *2026-11-22* — "get rid of the "36 nights" text … rename nights to days",
  then mid-push "also drop the count from who-had-what". Two ways in, one
  shape: trim its twin too. And "rename" meant the word only: I moved the
  history's dates to match and had to put them back.
- *2026-11-21* — "Add a spinner while images load in the expense viewer's
  miniature". The empty frame also stands for a photo not uploaded yet, which
  may wait hours; a spinner there would lie. It spins only while asked for.

- *2026-11-21* — "{Payer} dot {n people} [dot camera]": the brackets were the
  spec — the camera and its dot come only with a photo. A camera already sat
  in the sprite; the receipt glyph it replaced had no other use, so it went.

- *2026-11-21* — "the people at the table … also when entered through the scan
  fab": both doors meet at one grid, so one change covered them. Evenly's
  "Based on" note came along, since an unlit chip nobody pressed needs a why.

- *2026-11-21* — "Drop days mode completely … it can still be called days".
  The log is finished data, so "completely" stopped at the screen: old stays
  still say "day" and read as nights, new ones still write "night" so an old
  phone can read them.

- *2026-11-22* — A phone screenshot: "the editable fields have the nasty
  chevrons though. Do the same thing as for the expense date field". The
  read-only pair had been fixed last session; the editable ones beside them
  waited for the owner's thumb. Fix a kind of field, not the one in the photo.

- *2026-11-21* — "the read only who-stayed-when": a screen my clone didn't
  have — another session had pushed it an hour before. I chased a flash I
  couldn't make for ages. Unfamiliar names: fetch dev first. The flash and the
  Back mess were one cause — a screen passed through.

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
