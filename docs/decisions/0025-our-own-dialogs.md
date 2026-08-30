# 0025 — The app draws its own dialogs; a consequence doesn't always need a route

**Status:** Accepted · 2026-08-30

**Context.** The owner, on the last screens still using the browser's furniture:
*"Add member has ugly native/browser input make it cooler. Same for the 'abandon
editing' popup. On the 'confirm leave group' page the button shouldn't be at the
very bottom of the screen, i think it can be under the text. This page can be
custom popup like 'confirm abandon editing'."*

Five interactions were `prompt()` or `confirm()`: adding a member, renaming one,
removing one, discarding a half-typed expense, and typing a currency code the
picker doesn't list. A browser dialog arrives in another app's typeface, over a
grey bar that says the *site* is asking — the one thing a home-screen app should
never look like — and it holds exactly one line of text, which is why
[standing-instructions](../standing-instructions.md#interface) ruled that
consequences get a screen instead. `/g/leave` was that screen: a paragraph, and
a button pinned to the bottom of an otherwise empty phone, a thumb's travel away
from the sentence it answers.

## Decision

- **`components/dialog.tsx` is the app's dialog**: `Dialog` (the frame),
  `ConfirmDialog` (a paragraph and an act) and `PromptDialog` (one field). No
  `window.prompt` or `window.confirm` remains in `apps/web`.
- **It is a real `<dialog>` opened with `showModal()`.** Focus, Escape, and the
  inertness of the screen behind are the platform's; ours is the scrim, the
  hairline card and the buttons. The element fills the viewport and paints the
  scrim itself, which also makes "tapped outside the card" a target check.
- **The rule was about `confirm()`, not about dialogs.** A dialog we draw has
  room for as many sentences as the consequence needs, so the leave
  confirmation is now one on the People list, with its button directly under the
  paragraph. `/g/leave` and `route.leave` are gone.
- **The button says the act** ("Leave group", "Discard", "Add"), never "OK", and
  destructive keeps `--debit` as an outline. A prompt opens on its field with
  the old value selected; a confirm opens on neither button.

**Where a screen still wins:** when the decision needs the ledger on it —
`/g/restore` shows the version coming back, `/g/settle` the transfer being
recorded. A dialog is for a decision whose entire content is a sentence.

## Consequences

- One route fewer, and the People screen owns every change to who is in the
  group: naming, adding, removing, leaving.
- `pnpm shots` can no longer photograph the leave confirmation by URL, and it
  drove `prompt()` to seed members. Both now go through the dialogs, so the
  harness fails if they break.
- The old screen's "this phone isn't anyone here yet" empty state is gone with
  it: the row that opens the dialog only exists once you've claimed a name.

## Rejected

- **A headless dialog library.** [ADR-0008](0008-hand-rolled-css-not-shadcn.md)
  already settled this, and the platform has one built in.
- **A hand-rolled overlay with our own focus trap.** It was written first, and
  `<dialog>` deleted it: fifteen lines of Tab-wrapping and Escape handling that
  the browser does better, plus real inertness for a screen reader.
- **Keeping `confirm()` for the small ones** (removing a member) and drawing
  only the big ones. Two dialog languages in one app, and the small one is the
  one that reads as the browser interrupting.
