import { describe, expect, it } from "vitest";
import type { Expense, Settlement } from "@bida/core";
import { entryOf, ledgerRows, type LedgerRow } from "./ledger";

const at = (d: number, h = 0, min = 0) => new Date(2026, 3, d, h, min).getTime();

const expense = (id: string, over: Partial<Expense>): Expense => ({
  id, groupId: "g", description: id, occurredAt: at(4), amountMinor: 1000,
  currency: "EUR", rateToBase: "1", baseAmountMinor: 1000, paidBy: "m-ana",
  split: { mode: "equal", members: ["m-ana"] }, ...over,
} as Expense);

const transfer = (id: string, over: Partial<Settlement>): Settlement => ({
  id, groupId: "g", fromMember: "m-ana", toMember: "m-bo", amountMinor: 1000,
  currency: "EUR", rateToBase: "1", baseAmountMinor: 1000, occurredAt: at(4), ...over,
} as Settlement);

const ids = (rows: LedgerRow[]) => rows.map((r) => entryOf(r).id);

/**
 * The merged order is the one a person reads, and it is decided here rather
 * than by either table's own sort. It broke silently once: the row copied the
 * fields the comparator wanted, and a new one (`dateOnly`) was never copied.
 */
describe("ledgerRows", () => {
  it("interleaves the two tables by day, newest first", () => {
    const rows = ledgerRows(
      [expense("e-old", { occurredAt: at(2, 9), createdAt: at(2, 9) })],
      [transfer("t-new", { occurredAt: at(5, 9), createdAt: at(5, 9) })],
    );
    expect(ids(rows)).toEqual(["t-new", "e-old"]);
  });

  // The question this file exists for: several receipts backdated to one day.
  // None of them knows an hour, so the day cannot order them — the order they
  // were added in is the only fact there is, newest addition at the top.
  it("orders a day's timeless entries by when they were added, newest first", () => {
    const rows = ledgerRows([
      expense("first-added", { occurredAt: at(4), dateOnly: true, createdAt: at(6, 10) }),
      expense("last-added", { occurredAt: at(4), dateOnly: true, createdAt: at(6, 12) }),
      expense("second-added", { occurredAt: at(4), dateOnly: true, createdAt: at(6, 11) }),
      expense("dinner", { occurredAt: at(4, 20), createdAt: at(4, 20) }),
    ], []);
    expect(ids(rows)).toEqual(["last-added", "second-added", "first-added", "dinner"]);
  });

  it("keeps a timeless entry in its own day, not above the next one", () => {
    const rows = ledgerRows([
      expense("timeless", { occurredAt: at(4), dateOnly: true, createdAt: at(9, 9) }),
      expense("next-morning", { occurredAt: at(5, 8), createdAt: at(5, 8) }),
    ], [transfer("late-night", { occurredAt: at(3, 23), createdAt: at(3, 23) })]);
    expect(ids(rows)).toEqual(["next-morning", "timeless", "late-night"]);
  });
});
