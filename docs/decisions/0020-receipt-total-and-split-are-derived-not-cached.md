# 0020 — Receipt's total and split are derived at read time, never cached

**Status:** Accepted · 2026-08-28 · **Refines [0019](0019-receipt-mode-owns-the-total.md)**

**Context.** ADR-0019 made the amount "computed, not typed" while Receipt mode
has items: an effect on `/g/expense/edit` watched `receiptItems`/`receiptTip`
and wrote the sum into `draft.amountText` whenever they changed, and
`/g/expense/items`'s "Done" wrote the who-had-what grid into `draft.split`
separately. Both are caches of a value that's cheap to recompute, kept in
sync by an effect on one screen noticing a write made by another. The owner
kept hitting the same bug in different clothes: leaving "who had what" left
`amountText` holding whatever it was before that screen ran (often blank),
which `validateSplit` reads as **fully allocated** (`0 of 0`) rather than
incomplete, and blocked Save (`amountMinor > 0` failed). Their report: *"when
i exit the who had what screen the bottom bar says 0 out of 0 allocated and i
can't save the expense."* Patching that one gap (having `finish()` also pin
`amountText`) fixed the report but not the shape of the bug: two derived
values, two write sites, one implicit contract between them that nothing
enforces.

## Decision

**Nothing about Receipt mode is written into the draft except the raw
inputs** — `receiptItems`, `receiptTip`, `receiptInvolved`,
`receiptAssignments`. The total (`receiptTotalMinor`) and the split it
implies (`weightsFromItems`, wrapped in a `shares` spec) are computed fresh,
inline, in the one place both are read: `/g/expense/edit`'s render, which
feeds the same two values to the amount field, the split editor, `ready`, and
`save()`. `/g/expense/items`'s "Done" now writes only
`receiptInvolved`/`receiptAssignments`/`splitTab` and goes back — it doesn't
touch `split` or `amountText` at all.

There is no longer an effect anywhere that mirrors one draft field into
another. A value that used to need resyncing now has nothing to resync:
recomputing it is one non-blocking function call, cheaper than the bug.

## Consequences

- Reopening a saved Receipt-mode expense recomputes its total and split from
  `receiptItems`/`receiptTip`/`receiptAssignments` on the fly rather than
  trusting the stored `amountMinor`/`split` — which is correct, since those
  are exactly what produced the stored values at save time (same inputs, same
  seeded tiebreak), and now the only source of truth for either.
- `receiptSplit` is `null` — falling back to `draft.split` — until "who had
  what" has actually been visited (no assignments yet to derive from). This
  matches what already happened before a scan: the amount still locks to the
  items+tip total the moment items exist, but the split stays whatever it
  was until there's something to compute it from.
- `lib/scan/items.ts` is unchanged: `receiptTotalMinor` and `weightsFromItems`
  were already pure functions of their inputs. The bug was never in them —
  it was in caching their output and trusting a second screen to notice it
  had gone stale.

## Rejected

- **A merged `deriveReceiptSplit()` helper** bundling both functions into one
  call. Total and split have different availability (the total exists as
  soon as items do; the split needs assignments too), so forcing one return
  value would either compute the split before there's anything to assign, or
  block the total on an assignment it doesn't need. Two calls, made together
  in the one place that needs either, is the actual shape of the data.
