import { describe, expect, it } from "vitest";
import type { Expense, Settlement } from "@bida/core";
import { entryOf, ledgerItems, ledgerRows, figureMatches, searchLedger, type LedgerRow } from "./ledger";

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

describe("ledgerItems", () => {
  const label = (ts: number) => `d${new Date(ts).getDate()}`;

  it("heads each day's run with one date line, keyed by the calendar day", () => {
    const items = ledgerItems(
      [expense("e1", { occurredAt: at(5, 9), createdAt: at(5, 9) }),
        expense("e2", { occurredAt: at(5, 8), createdAt: at(5, 8) })],
      [transfer("t1", { occurredAt: at(3, 9), createdAt: at(3, 9) })],
      label,
    );
    expect(items.map((i) => i.key)).toEqual(["day:2026-4-5", "e1", "e2", "day:2026-4-3", "t1"]);
    expect(items.filter((i) => i.kind === "day").map((i) => i.kind === "day" && i.label)).toEqual(["d5", "d3"]);
  });
});

describe("searchLedger", () => {
  const names: Record<string, string> = { "m-ana": "Ana", "m-bo": "Bo", "m-cy": "Cyril" };
  const items = ledgerItems(
    [
      expense("e-cafe", { description: "Café du Nord", occurredAt: at(5, 9), createdAt: at(5, 9) }),
      expense("e-taxi", {
        description: "Taxi", paidBy: "m-bo", occurredAt: at(4, 9), createdAt: at(4, 9),
        split: { mode: "equal", members: ["m-bo", "m-cy"] },
        currency: "MAD", amountMinor: 62000, rateToBase: "0.1", baseAmountMinor: 5712,
      }),
      expense("e-refund", {
        description: "Deposit back", kind: "income", occurredAt: at(4, 8), createdAt: at(4, 8), baseAmountMinor: 1700000,
        amountMinor: 1700000,
      }),
    ],
    [transfer("t-rent", { note: "rent", occurredAt: at(3, 9), createdAt: at(3, 9) })],
    (ts) => String(new Date(ts).getDate()),
  );
  const context = {
    nameOf: (id: string) => names[id],
    kindWord: (kind: string) => ({ expense: "Expense", income: "Income", transfer: "Transfer" })[kind] ?? "",
    tierLabel: (tier: string) => tier,
    base: "EUR",
  };
  const found = (query: string) =>
    searchLedger(items, query, context).filter((i) => i.kind === "row").map((i) => i.key);

  it("is the whole ledger for a blank query", () => {
    expect(searchLedger(items, "  ", context)).toBe(items);
  });

  it("finds a title whatever its case and accents, under a line saying where, with no date lines", () => {
    expect(searchLedger(items, "CAFE", context)).toEqual([
      { key: "tier:title", kind: "day", label: "title" },
      expect.objectContaining({ key: "e-cafe" }),
    ]);
  });

  it("sections by the best place a word was found, best first, each in the ledger's order", () => {
    // A transfer's two names are its title; an expense's payer is only its payer.
    const banana = ledgerItems(
      [
        expense("e-new", { description: "Lunch", occurredAt: at(6, 9), createdAt: at(6, 9) }),
        expense("e-banana", {
          description: "Bananas", paidBy: "m-bo", split: { mode: "equal", members: ["m-bo"] },
          occurredAt: at(2, 9), createdAt: at(2, 9),
        }),
      ],
      [transfer("t-back", { fromMember: "m-bo", toMember: "m-ana", occurredAt: at(5, 9), createdAt: at(5, 9) })],
      String,
    );
    expect(searchLedger(banana, "ana", context).map((i) => i.key))
      .toEqual(["tier:title", "t-back", "e-banana", "tier:payer", "e-new"]);
    expect(searchLedger(banana, "bo -> ana", context).map((i) => i.key)).toEqual(["tier:title", "t-back"]);
  });

  it("puts the row with more of the words in that place first, whatever its date", () => {
    const two = ledgerItems(
      [
        expense("e-one", {
          description: "Nord", paidBy: "m-cy", split: { mode: "equal", members: ["m-cy"] },
          occurredAt: at(6, 9), createdAt: at(6, 9),
        }),
        expense("e-both", { description: "Cyril’s Café du Nord", occurredAt: at(2, 9), createdAt: at(2, 9) }),
      ],
      [], String,
    );
    expect(searchLedger(two, "nord cyril nord", context).map((i) => i.key))
      .toEqual(["tier:title", "e-both", "e-one"]);
  });

  it("finds an entry by who paid, who it is split between, and either side of a transfer", () => {
    expect(found("bo")).toEqual(["t-rent", "e-taxi"]);
    expect(found("cyril")).toEqual(["e-taxi"]);
  });

  it("finds a transfer by its note", () => {
    expect(found("rent")).toEqual(["t-rent"]);
  });

  it("takes a currency only whole, and it is the one the entry was made in", () => {
    expect(found("mad")).toEqual(["e-taxi"]);
    expect(found("ma")).toEqual([]);
    expect(found("eur")).toEqual(["e-cafe", "e-refund", "t-rent"]);
  });

  it("takes a kind only whole, in the app's own word", () => {
    expect(found("income")).toEqual(["e-refund"]);
    expect(found("transfer")).toEqual(["t-rent"]);
    expect(found("expense")).toEqual(["e-cafe", "e-taxi"]);
    expect(found("incom")).toEqual([]);
  });

  it("finds a figure as entered or as converted", () => {
    expect(found("620")).toEqual(["e-taxi"]);
    expect(found("57.12")).toEqual(["e-taxi"]);
    expect(found("17,000")).toEqual(["e-refund"]);
  });

  it("keeps the ledger's order and wants every word, each in any field", () => {
    expect(found("ana")).toEqual(["t-rent", "e-cafe", "e-refund"]);
    expect(found("nord ana eur 10")).toEqual(["e-cafe"]);
    expect(found("taxi ana")).toEqual([]);
  });

  it("settles a tie in a section by recency, whatever else the rows match lower down", () => {
    const tied = ledgerItems(
      [
        // All three hold "o" in the title. Only the oldest also has it in its payer's name.
        expense("e-newest", { description: "Nord", occurredAt: at(6, 9), createdAt: at(6, 9) }),
        expense("e-middle", { description: "Nord again", occurredAt: at(5, 9), createdAt: at(5, 9) }),
        expense("e-oldest", {
          description: "Nord with Bo", paidBy: "m-bo", split: { mode: "equal", members: ["m-ana"] },
          occurredAt: at(2, 9), createdAt: at(2, 9),
        }),
      ],
      [], String,
    );
    expect(searchLedger(tied, "o eur", context).map((i) => i.key))
      .toEqual(["tier:title", "e-newest", "e-middle", "e-oldest"]);
  });
});

describe("figureMatches", () => {
  it("reads a whole number as the start of the whole part", () => {
    expect(figureMatches("17", "17000.00")).toBe(true);
    expect(figureMatches("17", "17.50")).toBe(true);
    expect(figureMatches("7", "17.00")).toBe(false);
    expect(figureMatches("50", "17.50")).toBe(false);
  });

  it("reads a mark as the decimal one, comma or dot, with the cents still being typed", () => {
    expect(figureMatches("17.5", "17.50")).toBe(true);
    expect(figureMatches("17,50", "17.50")).toBe(true);
    expect(figureMatches("17.", "17.50")).toBe(true);
    expect(figureMatches("17.5", "170.50")).toBe(false);
    expect(figureMatches("17.6", "17.50")).toBe(false);
  });

  it("reads a mark before three digits as grouping too", () => {
    expect(figureMatches("17,000", "17000.00")).toBe(true);
    expect(figureMatches("1.250,5", "1250.50")).toBe(true);
    expect(figureMatches("1,250", "1.250")).toBe(true);
  });

  it("matches a currency with no cents, and nothing that isn't a number", () => {
    expect(figureMatches("25", "25000")).toBe(true);
    expect(figureMatches("25.0", "25000")).toBe(false);
    expect(figureMatches("a1", "1.00")).toBe(false);
    expect(figureMatches(".5", "0.50")).toBe(false);
  });
});
