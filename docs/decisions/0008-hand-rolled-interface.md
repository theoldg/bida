# 0008 — Hand-rolled components, and the app draws its own dialogs

**Status:** Accepted · 2026-08-27 · dialogs 2026-08-30

**Context.** The original plan was shadcn/ui. Building the actual screens, no
primitive was ever copied in and `shadcn add` was never run: the markup and
class names were already finished, specific and directly portable, so copying a
primitive and re-skinning it would have been strictly more work. Separately, the
last screens still used the browser's own furniture — `prompt()` and `confirm()`
for adding, renaming and removing a member, discarding a draft and typing an
unlisted currency; `<select>` for every picker. The owner: *"Add member has ugly
native/browser input make it cooler"*, then *"make all selectors into a custom
dialog: currency, payer, etc."*

A browser dialog arrives in another app's typeface, over a grey bar that says
the *site* is asking — the one thing a home-screen app should never look like —
and holds exactly one line of text. A `<select>` on a phone opens a full-height
wheel in the OS's typeface that can show a name and nothing else.

## Decision

- **No UI library.** Components are hand-rolled; `package.json` carries no
  shadcn, Radix or icon dependency. Tokens (`--paper`, `--ink`, …) are used
  verbatim, never remapped onto a component library's variable names.
- **`components/dialog.tsx` is the app's dialog**: `Dialog` (the frame),
  `ConfirmDialog`, `PromptDialog` and `ChoiceDialog`. No `window.prompt`,
  `window.confirm` or `<select>` remains in `apps/web`, and `entries-check`
  asserts it over the whole form so the next one can't land quietly.
- **It is a real `<dialog>` opened with `showModal()`.** Focus, Escape and the
  inertness of the screen behind are the platform's; ours is the scrim, the
  hairline card and the buttons.
- **A picked field is a button, whole-row** — `.field > .pick`: the value, and a
  chevron as the only mark that it opens something.
- **The rows say what a `<select>` couldn't.** The payer arrives with *"you"*
  against your own name; the base currency says *"the group settles in this"*;
  each code carries its name from `Intl.DisplayNames`. A transfer's other side
  is listed as *"the other side — picking swaps them"*, which is the only
  reading of that tap that isn't a mistake. "Other…" hands over to
  `PromptDialog` rather than closing onto nothing.
- **The button says the act** ("Leave group", "Discard", "Add"), never "OK", and
  destructive keeps `--debit` as an outline.
- **A dialog is for a decision whose entire content is a sentence.** Where the
  decision needs the ledger on it, it stays a screen.

## Consequences

- One fewer dependency tree, and one fewer thing to migrate over a long life.
- **We give up shadcn's accessibility work.** Anything interactive has to get
  roles, focus and keyboard behaviour right itself — and `<dialog>` is most of
  what that would have bought.
- `<input type="date">` stays native and is the last of them. A calendar is not
  a short list, and the platform's is better than one we would draw.
- Two dialogs in a row means the first one's `onClose` must not fire over the
  second: the picker closes itself unless its pick opened the prompt.
- `pnpm shots` drives the dialogs rather than `prompt()` and `selectOption`, so
  the harness fails if they break.

## Rejected

- **Adopt shadcn and re-skin it** — more work than porting finished markup.
- **A headless dialog library, or our own focus trap** — the platform has one
  built in; `<dialog>` deleted fifteen lines of Tab-wrapping and Escape handling
  and added real inertness for a screen reader.
- **A `<select>` styled to look like ours** — only the closed state is stylable,
  which is the half that was already fine.
- **Keeping `confirm()` for the small ones** — two dialog languages in one app,
  and the small one is the one that reads as the browser interrupting.
- **A combobox that filters as you type** — nineteen currencies and a group of
  four don't need a search field.

**Revisit if** a screen needs a primitive with real accessibility complexity (a
combobox, a popover with focus management). Pulling in that one headless
primitive doesn't reverse this ADR — just note the exception where it happens.
