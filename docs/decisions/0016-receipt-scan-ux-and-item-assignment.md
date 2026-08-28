# 0016 — Receipt scan UX: item assignment writes an ordinary `shares` split

**Status:** Accepted · 2026-08-28

**Context.** Core, the Worker passthrough and the client scan lib were built
and live-verified first ([receipt-scanning.md](../receipt-scanning.md)); the
button, its states and the privacy line were left for the owner to design. The
owner: *"a selection of involved users, assigning an initial for each (eg John
and Jane should end up as Jo and Ja) with a coloured chip, then a table with
columns as users and rows as items."*

That table is restaurant bill splitting in shape — the entity `product.md`
lists as deliberately deferred, with line items as "a new entity with its own
op kinds." Building that entity now would mean a schema change nobody asked
for yet, for a UI feature the owner asked for today.

## Decision

- **Assign items, but don't store them.** `/g/expense/items` (reached only
  right after a scan finds line items) is a per-item who-had-it grid. "Done"
  reduces it to an ordinary `SplitSpec` with `mode: "shares"` and writes that
  to the draft — nothing new on the op log, no line-item entity, no schema
  change. The seam `product.md` describes for real bill-splitting (line items
  as their own entity) is still there, untouched, for whenever that's built.
- **Weights, not amounts.** Each item's printed amount is divided evenly among
  its checked members via `resolveSplit` (the same largest-remainder rule as a
  real split), summed per member, and used as a `shares` weight. Weights are a
  ratio against the real, FX-converted total — so they can stay denominated in
  the receipt's own currency's minor units without a conversion step. This
  reuses `packages/core`'s tested arithmetic instead of adding new arithmetic
  in the UI layer, which is why `resolveSplit` runs once per item (`apps/web`
  composes it; `packages/core` is unchanged except exporting the already-tested
  `cleanAmountText`).
- **Every item defaults to everyone involved**, then the owner unchecks who
  didn't have it — the common case (everyone shares most of the bill) needs
  zero taps, and an item nobody's assigned to is a validation error, not a
  silently dropped weight.
- **Distinct initials, not the app's usual `initials()`.** The existing avatar
  initials (`AB` for first+last name) collide constantly on a one-name-per-
  person group — "John" and "Jane" both read "J". `distinctInitials()` grows
  each name's prefix only as far as needed to stay unique across the group
  being shown, which is why "John"/"Jane" become "Jo"/"Ja" rather than "J"/"J"
  or "JO"/"JA". It's local to the items screen, not a replacement for
  `Avatar`'s initials elsewhere, which don't have this collision problem at
  two letters.
- **Colour reuses the member's existing `colorSeed` tone** (`tone()`,
  `a-0`..`a-5`) rather than inventing a second palette — the same six colours
  the rest of the app already uses to mean "this person."

## Consequences

- A future real bill-splitting entity can still be built exactly as
  `product.md` describes; this ADR doesn't foreclose it, it just doesn't build
  it today.
- The computed split is `shares`, so the expense form shows it under "As
  parts" — accurate (line items ARE arbitrary weights), if a little abstract
  next to the receipt the owner just photographed. Acceptable for a first cut.
- Scanning is offered only for a new expense (`!draft.expenseId`) — rescanning
  over an edit would silently overwrite fields somebody may have already
  corrected.

## Rejected

- **A new `lineItem` entity now**, per `product.md`'s seam. Real scope
  creep for a screen the owner asked to be "minimal/flexible" — no schema
  change without the owner deciding the split needs to be re-editable
  per-item after saving, which nothing today asks for.
- **`exact` amounts instead of `shares` weights.** Exact mode needs amounts in
  the expense's base currency; the receipt is read in its own currency, so
  every item would need converting through the (possibly still being typed)
  FX rate before it could be assigned. Weights sidestep that entirely.
