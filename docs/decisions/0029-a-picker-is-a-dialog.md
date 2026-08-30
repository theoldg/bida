# 0029 — Picking a person is our dialog, not a `<select>`

**Status:** Accepted · 2026-08-30

**Context.** The owner, on the transfer form: *"move the words 'to' and 'from'
above the names and create a custom dialog for the person selection instead of
the browser native one."*

[ADR-0025](0025-our-own-dialogs.md) took `prompt()` and `confirm()` out of the
app but left `<select>`, which is the same intrusion by another route: on a
phone it opens a full-height wheel or sheet in the OS's typeface, and it can
show a name and nothing else — no avatar, and nowhere to say what picking a
particular name will do. The transfer form had two of them, one invisible over
each half of the `.transfer` card, and its labels sat *under* the faces they
named, so "From" was read after the person it qualified.

## Decision

- **`ChoiceDialog` is the third dialog** in `components/dialog.tsx`: a `Dialog`
  whose body is the app's own rows, each with a lead (an `Avatar`), a label and
  an optional `note`. The current choice carries `i-check` and picking it just
  closes.
- **A transfer's sides open it.** Each half of `.transfer` is a `<button>`, and
  the label goes above the person: eyebrow, avatar, name — the order the
  sentence is read in. The detail screen's card matches, since it is the same
  card.
- **The other side stays in the list, as a reversal.** A picker that can be
  used to say "send this to the person sending it" is a picker that produces
  the error message under the card. That row is annotated *"the other side —
  picking swaps them"* and does exactly that, which is the only reading of the
  tap that isn't a mistake.

## Consequences

- `ChoiceDialog` is generic over the value, so any short list can use it. It is
  not, yet: "Paid by", the currency chip and `<input type="date">` are still
  native. The first two are the same complaint one field lower and are worth
  converting when the owner asks; a date is a calendar, not a list.
- The screenshot harness drives the dialog (`pickSide`) rather than
  `selectOption`, and photographs it as `transfer-who`. `entries-check` asserts
  the sides carry no `<select>` and that the swap row swaps.

## Rejected

- **A `<select>` styled to look like ours.** The wheel is the browser's; only
  the closed state is stylable, which is the half that was already fine.
- **Leaving the other side out of the list.** Fewer rows, but the two halves
  then disagree about who exists, and the swap — the thing people actually
  want when they tap that name — has to be found on the arrow instead.
- **A screen for the picker.** One thought, one screen: choosing a name is not
  a different question from entering the transfer
  ([standing-instructions](../standing-instructions.md#interface)).
