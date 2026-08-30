# 0030 — Every picker is our dialog; the date is the exception

**Status:** Accepted · 2026-08-30 · completes
[ADR-0029](0029-a-picker-is-a-dialog.md)

**Context.** The owner: *"make all selectors into a custom dialog: currency,
payer, etc."* ADR-0029 converted a transfer's two sides and left the rest —
"Paid by" and the currency chip on the entry form, and the currency on
`/new` — as `<select>`, on the reasoning that they were the same complaint one
field lower and could wait. They are, and they didn't need to.

## Decision

- **No `<select>` in the app.** `ChoiceDialog` is every picker. The check
  asserts it over the whole form (`entries-check`: *no screen of the form has a
  `<select>`*), not just the transfer card, so the next one can't land quietly.
- **A picked field is a button, whole-row.** `.field > .pick` — the value, and
  a chevron pushed right as the only mark that it opens something. The row
  presses like every other tappable line; the label beside it is a `<span>`,
  since there is no longer a control for a `<label>` to point at.
- **The rows say what a `<select>` couldn't.** The payer arrives with an avatar
  and *"you"* against your own name; the base currency says *"the group settles
  in this"*; each code carries its name from `Intl.DisplayNames`, which is the
  thing the closed chip has no room for.
- **"Other…" is a row that hands over to `PromptDialog`.** Picking it opens the
  three-letter field rather than closing onto nothing, so an unlisted currency
  is typed instead of hunted for. `/new` lost its separate "Currency code"
  field to this.

## Consequences

- `<input type="date">` stays native, and is the last of them. A calendar is
  not a short list, and the platform's is better than the one we would draw
  ([ADR-0029](0029-a-picker-is-a-dialog.md) said the same).
- `ChoiceDialog`'s value type is now doing real work: the currency list mixes
  codes with the `OTHER_CURRENCY` sentinel, so the caller — not the dialog —
  decides what a pick means.
- Two dialogs in a row means the first one's `onClose` must not fire over the
  second. The picker closes itself unless its pick opened the prompt.

## Rejected

- **A combobox that filters as you type.** Nineteen currencies and a group of
  four don't need a search field; the one code that isn't listed has "Other…".
