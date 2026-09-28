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

- *2026-09-28* — "make the import screen identical to the join screen". My
  crit said "one component" when they already were one; the owner read it
  literally and asked a sharper thing. Check a finding against the code before
  it goes in a file, then do exactly what was asked, add row and all.

- *2026-09-28* — "show me the 4 you marks so i can realize the gravity", then
  "i dont see anything particularly wrong". The photographs argued the other
  way: a finding that needs a gallery to be felt is taste, not a bug. Show it
  plainly, and let the owner's eye be the verdict.

- *2026-09-28* — "give a chevron to the kind switch", then mid-edit "but show
  me a few variants first". A one-line change still earned a look: stop, keep
  the edit as one of the variants, and publish the lot before committing.

- *2026-09-28* — "give it a good think and propose some designs", then "show
  me the tap feedback", then "ship it". Four variants, photographed in the app
  on the demo group so a row not yours was in frame. The press shot sold it:
  photograph the state a person meets, not only the one at rest.

- *2026-09-28* — "remove these items with which i disagree": three of my crit
  findings (red for a received transfer, green's two meanings, the loud swap)
  were the owner's deliberate choices. A crit lists what I'd change, not what
  is wrong; expect a cull, and cut cleanly without arguing.

- *2026-09-28* — "Remove the middle one and fall back to multiline as soon as
  inline stops fitting comfortably." Three layouts for one sum was one too
  many; "comfortably" meant slack, not the exact pixel. Fewer shapes beats a
  ladder that covers every width.

- *2026-09-28* — "Remember about the no round corners rule." My mocks carried
  1px radii copied from nowhere; the owner caught it, then picked the pip I had
  argued for in words. Mock in the design system's own terms, and when asked
  "how do you like X", answer with a stance and its one catch.

- *2026-09-28* — "Go around the app and visually critique the screens", then
  "commit these to a file somewhere in docs." A crit said once in chat is
  lost at /clear; name each finding's shot so the next session can see it.

- *2026-09-28* — A screenshot of the payers screen: "swap the quiet corner
  Done for a large inked button, like other screens." One of the list the
  design system names had been left out. Next round: "stick it like the
  who-are-you screen." Copy the nearest sibling's whole behaviour, not its look.

- *2026-09-28* — "Fold Ben's items in the screenshots and reshoot." A shot's
  script had pressed a row open to show the feature; the screen already opens
  the viewer's own. Let the photograph show what a person sees on arrival.

- *2026-09-28* — "Show me variants", then "I don't understand the
  differences, the top row looks good": the baseline I'd drawn for comparison
  won over four that differed by where one line sat. Caption what each variant
  changes, and always offer today's shape, extended, as one.

- *2026-09-28* — A link-preview banner in six rounds of mocks, each a
  fragment ("less text", "bigger slogan", "lowercased, no period") before "go
  with L1, ship it". Every round kept the one thing picked and varied only
  what the note named.
