# 0021 — Leaving Receipt mode hands the total back; a zero total is never "allocated"

**Status:** Accepted · 2026-08-28 · **Refines [0020](0020-receipt-total-and-split-are-derived-not-cached.md)**

**Context.** Fourth report in this family: *"when toggling back from receipt
mode to equal split it also seems to think the total is zero"*, and the
familiar `$0 out of $0 allocated`. Both are one bug.

ADR-0020 made Receipt's total derived at read time and written nowhere. That
derivation was gated on the active tab:

```ts
const receiptLocksAmount = activeTab === "receipt" && hasReceiptItems;
const receiptTotal = receiptLocksAmount ? receiptTotalMinor(...) : null;
amountMinor = receiptTotal !== null ? receiptTotal : parseMinor(draft.amountText)
```

The moment `activeTab` stopped being `"receipt"` the total evaporated and the
amount fell back to `amountText` — which nothing had ever written, because the
scan only fills it from the OCR's reading of the *printed* total, and the model
routinely reads every line item while missing that one line. Zero total, Save
greyed out; one more tap onto "As amounts" and `validateSplit(0, {all zeros})`
scores 0-of-0 as a **satisfied** split, printing the reported string.

The shape of the mistake: ADR-0019 kept `amountText` in step with an effect,
0020 deleted the effect as a stale cache — correctly, it broke the who-had-what
exit — but deleted the handoff along with it, leaving the amount with nowhere
to live once Receipt stopped owning it.

## Decision

- **Leaving Receipt for an arithmetic tab writes the derived total into
  `amountText`, once** (`handOffReceiptTotal`, `lib/scan/items.ts`). This is
  not a reinstated mirror: the split already makes exactly this handoff, via
  `convertSplitMode`, and this is its missing other half. It fires only on the
  receipt → arithmetic transition, so switching between two arithmetic tabs
  never snaps a hand-typed amount back to the bill.
- **A zero total is never rendered as a satisfied split.** `splitFooter`
  (`lib/format.ts`) owns the footer's wording *and* its verdict; with nothing
  to divide it says "Enter an amount to split", which also explains the
  disabled Save. The nonsense string is now unreachable rather than guarded at
  each call site that can reach a zero total.
- **The amount field locks on a derived number, not on merely having items.**
  A scan whose every line is unreadable used to leave it disabled *and* empty:
  no way to type an amount, no way to save.

## Consequences

- `bare()` is display-only, and said so nowhere. It is `Intl`-grouped, so
  writing it into canonical text loses money: `parseMinor` throws on
  "1,234.50" (amount silently 0) and reads JPY "25,000" as **25**. Both were
  live on the expense form — reopening any expense over ~1000 major units to
  edit it, in *any* mode, showed a zero or hundredfold-wrong total. Canonical
  text is core's `minorToDecimalString`; `bare`'s doc comment now says so.
- The recurrence is a testing fact, not a reasoning one: `weightsFromItems`
  and `receiptTotalMinor` were always right and always tested, while the
  wiring between the two screens that read them never was. Both new functions
  are pure and tested, including a round-trip that the handoff's text parses
  back to the total it came from.

## Rejected

- **Deriving the receipt total on every tab.** It would fix the symptom and
  make the amount field unownable — you could never take the number back by
  hand, which is the entire point of switching to Evenly.
- **Guarding "0 of 0" at the call site.** It is reachable from any mode with a
  blank amount, receipt or not; the third fix in a row at one call site is the
  pattern this ADR is trying to end.
