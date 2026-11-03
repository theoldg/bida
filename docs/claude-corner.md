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

- *2026-11-01* — "add dummy rates in the demo", then mid-work: "this should
  not apply to other groups where someone set CRD". The obvious key was the
  currency; the owner meant the group. Same lesson as the CRD-suggestion card:
  "the demo" is an id, never a code that merely looks like it.

- *2026-11-01* — "Any questions?" on a history rework, answered as rules:
  "one or two names should be preferred to everyone, each". A rule, so it
  went to every phrase, not only the asked case. Then a demo's note "fixed"
  weeks ago: the phone kept an old seed — say why it still shows first.

- *2026-10-31* — "Remove the touch wash on the expense title edit field". One
  row, not the three that share the rule: a tap on a text field means "put the
  caret here", while Paid by and When open something. The press stays where
  the tap is a button press.

- *2026-10-28* — "dont suggest the made up CRD currency when creating a new
  group, even when it's the last used one". "Made up" named the demo, not a
  code; the quick split made the same guess from the same group, so it got the
  same skip without being asked.

- *2026-10-25* — "Doesn't work in messenger's in-app browser", and I chased
  iOS WebKit off a status bar until "my screenshot and diag are from android".
  Ask the platform before theorising; and a page missing from /diag may just
  be one the recorder never kept.

- *2026-10-25* — "This link doesn't work": one `%23` read as a chat's
  mangling, not ours, until a screenshot showed the whole message encoded and
  only its first colon spared: iOS took `CBS:` for a scheme. Ask for what
  arrived, whole, before blaming the carrier.

- *2026-10-24* — "People expect commit on blur… propose how", then "build and
  ship". It undid a September revert; git log said why, and the proposal met
  those reasons first. Then "box the refusal like the expense editor": the
  first photo found the box under the fold at rest, not only on refusal.

- *2026-10-24* — "Should we add History to the kebab?", then "a dot on the
  kebab… wdyt?", then "drop the separate button". Two questions were the owner
  thinking aloud; the answer laid out both versions, and they picked the one
  the code comment argued against. A comment is a reason, not a veto.

- *2026-10-23* — "I can select text in this dialog… Fix for all list dialogs".
  Every list dialog was one component, and the body's no-select rule never
  reached it: the browser's own sheet resets a modal dialog. A rule that
  "already" holds is worth testing in the top layer before trusting it.
