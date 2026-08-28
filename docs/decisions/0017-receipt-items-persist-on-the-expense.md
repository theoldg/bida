# 0017 — Receipt items persist on the expense, not just the draft

**Status:** Accepted · 2026-08-28 · **Partially supersedes [0016](0016-receipt-scan-ux-and-item-assignment.md)**

**Context.** ADR-0016 built the who-had-what grid but decided the parsed
receipt (`scanItems`, `scanTip`) is thrown away the moment "Done" reduces it
to an ordinary `shares` split — it lived only in the session-local
`ExpenseDraft`, gone as soon as the draft was cleared. The owner asked for the
grid to be reopenable later, and said the underlying data "should obviously
be stored on the server" — not just kept around in one tab's `sessionStorage`.

**Decision.** The parsed bill becomes four ordinary, optional fields on
`Expense` itself: `receiptItems`, `receiptTip`, `receiptInvolved`,
`receiptAssignments`. They travel through `addExpense`/`editExpense` exactly
like `description` or `categoryId` — plain keys in the op's `patch` — so they
sync, replay and fold with no change to `Op`, `fold.ts`, the D1 schema (`patch`
is already schemaless JSON) or the Dexie schema (unindexed fields need no
migration). `ExpenseDraft` gained matching field names so the value flows
through unchanged from scan → draft → save.

`/g/expense/edit` shows an "Edit who-had-what (N items)" link whenever the
draft carries `receiptItems`, for a new expense being composed or one already
saved — reopening writes straight back into the same grid, `receiptInvolved`
and `receiptAssignments` seeding the checkboxes exactly as they were left
instead of resetting to "everyone had everything".

**Consequences.**
- The seam ADR-0016 preserved for a future real `lineItem` entity is
  untouched — this is still an ordinary field on `Expense`, not a new
  `EntityKind` or op kind.
- A receipt's line items and the tip line are now on the log permanently,
  same trust level as the description and amount already there (ADR-0016's
  "Trust" section already covers what the model saw; this is what a person
  chose to keep).
- Every edit-save now writes all four receipt fields, even unchanged ones —
  the same pattern `editExpense`'s caller already uses for every other field
  on this form (`input` is always fully populated, not diffed field-by-field
  except payers/amount). Harmless: idempotent, and the fields are small.

**Rejected.**
- **A new `receiptScans` table/entity.** Nothing here needs its own lifecycle,
  identity or op kind — it is data about one expense, not a thing edited on
  its own.
