import { describe, expect, it } from "vitest";
import { computeBalances } from "./balance.js";
import { groupToCsv } from "./export.js";
import { ADA, ALL, GROUP, MARIE, MAD_RATE, OpBuilder, SAM, THEO, marrakechOps } from "./fixtures.test-helper.js";
import { foldOps } from "./fold.js";
import { ImportError, readCsvGroup, type ImportPlan } from "./import.js";
import { convertMinor } from "./money.js";
import type { Op } from "./ops.js";
import type { SplitSpec } from "./types.js";

const utcDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const EXPORTED_AT = Date.UTC(2026, 8, 18);
const dayToTimestamp = (day: string) => Date.parse(`${day}T00:00:00Z`);

const read = (rows: string[][]): ImportPlan => readCsvGroup(rows, { dayToTimestamp });

/**
 * Our own file, back into rows — blank lines and all, because tolerating the
 * three the shape carries is part of what is under test. Only good enough for
 * what `export.ts` emits; the real parser is `apps/web/lib/import/csv.ts`.
 */
function records(csv: string): string[][] {
  return csv.replace(/\n$/, "").split("\n").map((line) => {
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { cells.push(cell); cell = ""; }
      else cell += ch;
    }
    cells.push(cell);
    return cells;
  });
}

const csvOf = (ops: Op[]) =>
  groupToCsv(foldOps(ops), { formatDay: utcDay, exportedAt: EXPORTED_AT });

/** The balances a plan produces, by the same arithmetic the foot check uses. */
function balancesOf(plan: ImportPlan): Record<string, number> {
  const out: Record<string, number> = {};
  const move = (name: string, minor: number) => { out[name] = (out[name] ?? 0) + minor; };
  for (const name of plan.members) out[name] = 0;
  for (const e of plan.entries) {
    const sign = e.kind === "income" ? -1 : 1;
    for (const [n, m] of Object.entries(e.paid)) move(n, sign * m);
    for (const [n, m] of Object.entries(e.owed)) move(n, -sign * m);
  }
  for (const t of plan.transfers) { move(t.from, t.amountMinor); move(t.to, -t.amountMinor); }
  return out;
}

/** The refusal code, as an assertion that reads. */
function refusal(rows: string[][]): string {
  try {
    read(rows);
  } catch (err) {
    if (err instanceof ImportError) return err.code;
    throw err;
  }
  throw new Error("expected the file to be refused");
}

/** A minimal file: the five columns, two people, one row, one foot. */
function file(...body: string[][]): string[][] {
  return [
    ["Date", "Description", "Category", "Cost", "Currency", "ada", "theo"],
    [""],
    ...body,
  ];
}

const foot = (ada: string, theo: string) =>
  ["2026-09-18", "Total balance", " ", " ", "EUR", ada, theo];

/**
 * The round trip, which is the property the whole module is for: what
 * `export.ts` writes, read back, must reproduce every balance to the cent.
 * The payer figures are explicitly not part of that — a single number per
 * member cannot carry both sides — so these assert balances, and the payer
 * reading is pinned separately below.
 */
describe("the Marrakech trip, exported and read back", () => {
  const ops = marrakechOps();
  const state = foldOps(ops);
  const plan = read(records(csvOf(ops)));

  it("finds the people, in the file's own column order", () => {
    expect(plan.members).toEqual([ADA, MARIE, SAM, THEO]);
  });

  it("takes the currency from the file, which is the group's base", () => {
    expect(plan.currency).toBe("EUR");
  });

  it("reads back every expense, and no transfers", () => {
    expect(plan.entries).toHaveLength(7);
    expect(plan.transfers).toEqual([]);
    expect(plan.dropped).toEqual([]);
  });

  it("reproduces every balance to the cent", () => {
    expect(balancesOf(plan)).toEqual(computeBalances(state).byMember);
  });

  it("agrees with the file's own foot, which is what let it through at all", () => {
    expect(plan.stated).toEqual(computeBalances(state).byMember);
  });

  it("gives every entry a split that sums to its cost", () => {
    for (const e of plan.entries) {
      expect(Object.values(e.owed).reduce((a, b) => a + b, 0)).toBe(e.amountMinor);
      expect(Object.values(e.paid).reduce((a, b) => a + b, 0)).toBe(e.amountMinor);
    }
  });

  it("recovers the single payer exactly, because one positive column is lossless", () => {
    const riad = plan.entries.find((e) => e.description.startsWith("Riad"))!;
    expect(riad.paid).toEqual({ [MARIE]: 58000 });
    // 580 four ways, and the payer's own quarter is what they owe.
    expect(riad.owed).toEqual({ [ADA]: 14500, [MARIE]: 14500, [SAM]: 14500, [THEO]: 14500 });
  });

  it("keeps the day, as local midnight of the date in the cell", () => {
    const riad = plan.entries.find((e) => e.description.startsWith("Riad"))!;
    expect(riad.day).toBe("2026-04-03");
    expect(riad.occurredAt).toBe(Date.UTC(2026, 3, 3));
  });

  it("carries no category, because every row of ours says General", () => {
    expect(plan.entries.every((e) => e.categoryId === null)).toBe(true);
  });
});

describe("the category column", () => {
  it("comes in verbatim, on the entry's own categoryId", () => {
    const plan = read(file(
      ["2026-04-03", "Dinner", "Dining out", "30.00", "EUR", "-15.00", "15.00"],
      [""],
      foot("-15.00", "15.00"),
    ));
    expect(plan.entries[0]!.categoryId).toBe("Dining out");
    // And never in the description, which is the invention that would survive
    // a re-export as part of what somebody typed.
    expect(plan.entries[0]!.description).toBe("Dinner");
  });

  it("drops the two protocol tokens, which are not categories anybody picked", () => {
    const plan = read(file(
      ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
      ["2026-04-04", "Lunch", "", "10.00", "EUR", "-5.00", "5.00"],
      foot("-20.00", "20.00"),
    ));
    expect(plan.entries.map((e) => e.categoryId)).toEqual([null, null]);
  });
});

describe("a transfer", () => {
  it("is the Payment token plus the shape of one: two figures, equal and opposite", () => {
    const plan = read(file(
      ["2026-04-06", "Payment", "Payment", "20.00", "EUR", "20.00", "-20.00"],
      foot("20.00", "-20.00"),
    ));
    expect(plan.entries).toEqual([]);
    expect(plan.transfers).toEqual([{
      from: ADA, to: THEO, amountMinor: 2000, note: null,
      day: "2026-04-06", occurredAt: Date.UTC(2026, 3, 6), line: 3,
    }]);
  });

  it("keeps a note somebody wrote, and drops the one that is only the token", () => {
    const plan = read(file(
      ["2026-04-06", "Settling up at the airport", "Payment", "20.00", "EUR", "20.00", "-20.00"],
      foot("20.00", "-20.00"),
    ));
    expect(plan.transfers[0]!.note).toBe("Settling up at the airport");
  });

  it("is not a description that happens to say payment — nothing reads the description", () => {
    const plan = read(file(
      ["2026-04-06", "payment for dinner", "General", "20.00", "EUR", "20.00", "-20.00"],
      foot("20.00", "-20.00"),
    ));
    expect(plan.transfers).toEqual([]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]!.description).toBe("payment for dinner");
  });

  it("falls back to an expense when the category says Payment and the shape disagrees", () => {
    // Three people moved, so this is not one person paying another whatever
    // the category says. Read as an expense it loses nothing.
    const rows = [
      ["Date", "Description", "Category", "Cost", "Currency", "ada", "sam", "theo"],
      ["2026-04-06", "Payment", "Payment", "30.00", "EUR", "20.00", "-10.00", "-10.00"],
      ["2026-09-18", "Total balance", " ", " ", "EUR", "20.00", "-10.00", "-10.00"],
    ];
    const plan = read(rows);
    expect(plan.transfers).toEqual([]);
    expect(plan.entries[0]!.kind).toBe("expense");
    expect(plan.entries[0]!.categoryId).toBeNull();
  });

  it("survives the round trip of a real one", () => {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
    for (const [i, id] of [ADA, THEO].entries()) {
      b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
    }
    b.push("settlement", "s-1", "create", {
      fromMember: ADA, toMember: THEO, amountMinor: 2000, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 2000, occurredAt: Date.UTC(2026, 3, 6), note: "Cash",
    }, ADA);
    const plan = read(records(csvOf(b.ops)));
    expect(plan.transfers).toHaveLength(1);
    expect(balancesOf(plan)).toEqual(computeBalances(foldOps(b.ops)).byMember);
  });
});

/**
 * The sign of the `Cost` column is the only thing in the file that says which
 * way an entry runs — and it turns the member columns round with it. Getting
 * that backwards leaves every row still summing to zero and the foot still
 * matching, so the checksum cannot catch it. These tests are what holds it.
 */
describe("an income, which runs the other way through one amount column", () => {
  const b = new OpBuilder();
  b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
  for (const [i, id] of [ADA, THEO].entries()) {
    b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
  }
  b.push("expense", "e-deposit", "create", {
    kind: "income", description: "Deposit refunded", occurredAt: Date.UTC(2026, 3, 8),
    amountMinor: 30000, currency: "EUR", rateToBase: "1", baseAmountMinor: 30000,
    paidBy: THEO, split: { mode: "equal", members: [ADA, THEO] } satisfies SplitSpec,
  }, THEO);
  const ops = b.ops;
  const plan = read(records(csvOf(ops)));

  it("is read as an income, from the negative cost and nothing else", () => {
    expect(plan.entries[0]!.kind).toBe("income");
    expect(plan.entries[0]!.amountMinor).toBe(30000);
  });

  it("puts the receiver back on the paid side, not the owed side", () => {
    expect(plan.entries[0]!.paid).toEqual({ [THEO]: 30000 });
    expect(plan.entries[0]!.owed).toEqual({ [ADA]: 15000, [THEO]: 15000 });
  });

  it("reproduces the balances, which are the other way round from an expense", () => {
    const balances = computeBalances(foldOps(ops)).byMember;
    expect(balances[THEO]).toBeLessThan(0);
    expect(balancesOf(plan)).toEqual(balances);
  });
});

describe("several positive columns, which are a guess that adds up", () => {
  const b = new OpBuilder();
  b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
  for (const [i, id] of ALL.entries()) {
    b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
  }
  // 500 put in by two people, consumed by two others: both payers come out
  // above their own share, so two columns are positive and there is no
  // lossless reading of who handed over what.
  b.push("expense", "e-boat", "create", {
    description: "Boat", occurredAt: Date.UTC(2026, 3, 9),
    amountMinor: 50000, currency: "EUR", rateToBase: "1", baseAmountMinor: 50000,
    paidBy: SAM, payers: { [SAM]: 40000, [ADA]: 10000 },
    split: { mode: "shares", weights: { [SAM]: 1, [MARIE]: 1 } },
  }, SAM);
  const ops = b.ops;
  const plan = read(records(csvOf(ops)));

  it("apportions the cost across them, exactly", () => {
    const paid = plan.entries[0]!.paid;
    expect(Object.values(paid).reduce((a, x) => a + x, 0)).toBe(50000);
    expect(Object.keys(paid).length).toBeGreaterThan(1);
  });

  it("never sends anybody's owed below zero", () => {
    for (const minor of Object.values(plan.entries[0]!.owed)) expect(minor).toBeGreaterThan(-1);
  });

  it("still reproduces every balance to the cent, which is the promise", () => {
    expect(balancesOf(plan)).toEqual(computeBalances(foldOps(ops)).byMember);
  });

  it("is deterministic: the same file reads the same way twice", () => {
    const again = read(records(csvOf(ops)));
    expect(again.entries[0]!.paid).toEqual(plan.entries[0]!.paid);
  });
});

/**
 * Our own writer emits a row of nothing but zeros for an expense
 * `computeBalances` could not apportion, so a round trip of our own file has
 * to survive one — and it contributes nothing to any column, so dropping it
 * leaves the foot intact.
 */
describe("a row that carries no money", () => {
  const b = new OpBuilder();
  b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
  for (const [i, id] of [ADA, THEO].entries()) {
    b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
  }
  b.push("expense", "e-ok", "create", {
    description: "Lunch", occurredAt: Date.UTC(2026, 3, 3), amountMinor: 3000,
    currency: "EUR", rateToBase: "1", baseAmountMinor: 3000, paidBy: ADA,
    split: { mode: "equal", members: [ADA, THEO] },
  }, ADA);
  // A split naming nobody: `resolveSplit` throws on it, so `export.ts` writes
  // the row with every column zero rather than lose what somebody typed.
  b.push("expense", "e-broken", "create", {
    description: "Broken", occurredAt: Date.UTC(2026, 3, 4), amountMinor: 1000,
    currency: "EUR", rateToBase: "1", baseAmountMinor: 1000, paidBy: ADA,
    split: { mode: "equal", members: [] },
  }, ADA);
  const plan = read(records(csvOf(b.ops)));

  it("is dropped, and named so the summary can say so", () => {
    expect(plan.dropped).toEqual([{ line: 4, description: "Broken" }]);
  });

  it("leaves the checksum standing, which is why dropping it is allowed at all", () => {
    expect(balancesOf(plan)).toEqual(plan.stated);
  });
});

describe("what the shape says about the bytes, read liberally", () => {
  it("accepts a byte-order mark, which a round trip through Excel adds", () => {
    const rows = file(
      ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
      foot("-15.00", "15.00"),
    );
    rows[0]![0] = `﻿Date`;
    expect(read(rows).entries).toHaveLength(1);
  });

  it("does not mind how the header is capitalised, or padded", () => {
    const rows = file(
      ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
      foot("-15.00", "15.00"),
    );
    rows[0] = [" DATE ", "description", "Category", " cost", "CURRENCY", "ada", "theo"];
    expect(read(rows).members).toEqual([ADA, THEO]);
  });

  it("treats blank lines as structure wherever they fall, not as the end of the file", () => {
    const plan = read([
      ["Date", "Description", "Category", "Cost", "Currency", "ada", "theo"],
      [""], [""],
      ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
      ["", "", "", "", "", "", ""],
      ["2026-04-04", "Lunch", "General", "10.00", "EUR", "-5.00", "5.00"],
      [""],
      foot("-20.00", "20.00"),
    ]);
    expect(plan.entries).toHaveLength(2);
  });

  it("finds the foot by its words, never by where it sits", () => {
    const plan = read(file(
      foot("-15.00", "15.00"),
      ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
    ));
    // Read as an expense the foot would be a 0-cost row, and the balances
    // would come out double.
    expect(plan.entries).toHaveLength(1);
  });

  it("pads a short row out, because every spreadsheet drops trailing empties", () => {
    const plan = read([
      ["Date", "Description", "Category", "Cost", "Currency", "ada", "sam", "theo"],
      // Theo's cell is simply not there, which is nought rather than a mystery.
      ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
      ["2026-09-18", "Total balance", " ", " ", "EUR", "-15.00", "15.00", "0.00"],
    ]);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]!.paid).toEqual({ sam: 3000 });
    expect(plan.entries[0]!.owed).toEqual({ ada: 1500, sam: 1500 });
  });
});

describe("currencies that are not two decimals", () => {
  it("round-trips a zero-decimal one", () => {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: "JPY", createdAt: 1 }, THEO);
    for (const [i, id] of [ADA, THEO].entries()) {
      b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
    }
    b.push("expense", "e-ramen", "create", {
      description: "Ramen", occurredAt: Date.UTC(2026, 3, 3), amountMinor: 3001,
      currency: "JPY", rateToBase: "1", baseAmountMinor: 3001, paidBy: ADA,
      split: { mode: "equal", members: [ADA, THEO] },
    }, ADA);
    const plan = read(records(csvOf(b.ops)));
    expect(plan.currency).toBe("JPY");
    expect(plan.entries[0]!.amountMinor).toBe(3001);
    expect(balancesOf(plan)).toEqual(computeBalances(foldOps(b.ops)).byMember);
  });

  it("round-trips a three-decimal one", () => {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: "TND", createdAt: 1 }, THEO);
    for (const [i, id] of [ADA, THEO, SAM].entries()) {
      b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
    }
    b.push("expense", "e-cafe", "create", {
      description: "Café", occurredAt: Date.UTC(2026, 3, 3), amountMinor: 10000,
      currency: "TND", rateToBase: "1", baseAmountMinor: 10000, paidBy: ADA,
      split: { mode: "equal", members: [ADA, THEO, SAM] },
    }, ADA);
    const plan = read(records(csvOf(b.ops)));
    expect(plan.currency).toBe("TND");
    expect(balancesOf(plan)).toEqual(computeBalances(foldOps(b.ops)).byMember);
  });

  it("refuses a cell with more decimals than the currency has, rather than round it", () => {
    const rows = [
      ["Date", "Description", "Category", "Cost", "Currency", "ada", "theo"],
      ["2026-04-03", "Ramen", "General", "30.50", "JPY", "-15.25", "15.25"],
      ["2026-09-18", "Total balance", " ", " ", "JPY", "-15", "15"],
    ];
    expect(refusal(rows)).toBe("bad-amount");
  });
});

describe("what it refuses, and why each one would have needed a guess", () => {
  it("a file that is not this shape", () => {
    expect(refusal([["Paid by", "Paid for", "Amount"], ["a", "b", "1"]])).toBe("header");
  });

  it("a header with nobody in it", () => {
    expect(refusal([["Date", "Description", "Category", "Cost", "Currency"]])).toBe("no-members");
  });

  it("two columns with the same name, whose balances would merge into one person", () => {
    expect(refusal([
      ["Date", "Description", "Category", "Cost", "Currency", "ada", "Ada"],
      ["2026-09-18", "Total balance", " ", " ", "EUR", "0.00", "0.00"],
    ])).toBe("duplicate-member");
  });

  it("a people column with no name in its header", () => {
    expect(refusal([
      ["Date", "Description", "Category", "Cost", "Currency", "ada", "", "theo"],
      ["2026-09-18", "Total balance", " ", " ", "EUR", "0.00", "0.00", "0.00"],
    ])).toBe("blank-member");
  });

  it("more than one currency, because v1 has no rate to price them against", () => {
    let code = "";
    let detail = "";
    try {
      read(file(
        ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
        ["2026-04-04", "Tagine", "General", "300.00", "MAD", "-150.00", "150.00"],
        foot("-165.00", "165.00"),
      ));
    } catch (err) {
      if (!(err instanceof ImportError)) throw err;
      code = err.code;
      detail = err.detail ?? "";
    }
    expect(code).toBe("mixed-currency");
    // Named, so the person knows which file to go and fix.
    expect(detail).toBe("EUR,MAD");
  });

  it("a currency cell that is not three letters", () => {
    expect(refusal(file(
      ["2026-04-03", "Dinner", "General", "30.00", "€", "-15.00", "15.00"],
      foot("-15.00", "15.00"),
    ))).toBe("unknown-currency");
  });

  it("a file with no foot, so there is no checksum to import against", () => {
    expect(refusal(file(
      ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
    ))).toBe("no-foot");
  });

  it("a date in any other format, because 01/02 is two days on two continents", () => {
    expect(refusal(file(
      ["03/04/2026", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
      foot("-15.00", "15.00"),
    ))).toBe("bad-date");
  });

  it("a date that parses and does not exist", () => {
    expect(refusal(file(
      ["2026-02-30", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
      foot("-15.00", "15.00"),
    ))).toBe("bad-date");
  });

  it("an amount that is not a number", () => {
    expect(refusal(file(
      ["2026-04-03", "Dinner", "General", "thirty", "EUR", "-15.00", "15.00"],
      foot("-15.00", "15.00"),
    ))).toBe("bad-amount");
  });

  it("a row whose people's figures do not sum to nothing", () => {
    expect(refusal(file(
      ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "10.00"],
      foot("-15.00", "10.00"),
    ))).toBe("row-not-zero");
  });

  it("a row where more was net-paid than the thing cost, which no split explains", () => {
    expect(refusal(file(
      ["2026-04-03", "Dinner", "General", "10.00", "EUR", "20.00", "-20.00"],
      foot("20.00", "-20.00"),
    ))).toBe("overpaid");
  });

  it("a row with more cells than the header has columns", () => {
    expect(refusal(file(
      ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00", "9.99"],
      foot("-15.00", "15.00"),
    ))).toBe("extra-cells");
  });

  it("a file with nothing in it but a foot", () => {
    expect(refusal(file(foot("0.00", "0.00")))).toBe("no-entries");
  });

  it("no rows at all", () => {
    expect(refusal([])).toBe("empty");
    expect(refusal([[""], ["", ""]])).toBe("empty");
  });

  it("a foot that disagrees with the rows above it", () => {
    expect(refusal(file(
      ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
      foot("-14.00", "14.00"),
    ))).toBe("checksum");
  });

  it("names the drift, so the refusal is worth reading", () => {
    try {
      read(file(
        ["2026-04-03", "Dinner", "General", "30.00", "EUR", "-15.00", "15.00"],
        foot("-14.00", "14.00"),
      ));
    } catch (err) {
      expect((err as ImportError).detail).toContain("-15.00 vs -14.00");
      return;
    }
    throw new Error("expected a refusal");
  });
});

/**
 * The property, over the fixture's own permutations: whatever the group holds,
 * exporting it and reading it back reproduces `computeBalances`. A foreign
 * currency is repriced before the export by the same `atCurrentRates` the app
 * uses, so the file is single-currency even when the group is not.
 */
describe("export then import, over a group with everything in it", () => {
  it("reproduces the balances whatever the entries are", () => {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
    for (const [i, id] of ALL.entries()) {
      b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
    }
    const eur = (mad: number) => convertMinor(mad, "MAD", "EUR", MAD_RATE);
    // An expense, an income, a co-sponsored one, an uneven shares split, and a
    // transfer — the five readings this module has, in one file.
    b.push("expense", "e-1", "create", {
      description: "Riad", occurredAt: Date.UTC(2026, 3, 3), amountMinor: 58000,
      currency: "EUR", rateToBase: "1", baseAmountMinor: 58000, paidBy: MARIE,
      split: { mode: "equal", members: ALL },
    }, MARIE);
    b.push("expense", "e-2", "create", {
      kind: "income", description: "Deposit back", occurredAt: Date.UTC(2026, 3, 4),
      amountMinor: 12000, currency: "EUR", rateToBase: "1", baseAmountMinor: 12000,
      paidBy: THEO, split: { mode: "equal", members: ALL },
    }, THEO);
    b.push("expense", "e-3", "create", {
      description: "Souk", occurredAt: Date.UTC(2026, 3, 5), amountMinor: 185000,
      currency: "MAD", rateToBase: MAD_RATE, baseAmountMinor: eur(185000), paidBy: MARIE,
      payers: { [MARIE]: 100000, [ADA]: 85000 },
      split: { mode: "shares", weights: { [MARIE]: 2, [ADA]: 1 } },
    }, MARIE);
    b.push("expense", "e-4", "create", {
      description: "Hammam, tips and all", occurredAt: Date.UTC(2026, 3, 6),
      amountMinor: 70000, currency: "MAD", rateToBase: MAD_RATE,
      baseAmountMinor: eur(70000), paidBy: SAM,
      split: { mode: "shares", weights: { [SAM]: 3, [ADA]: 2, [MARIE]: 2 } },
    }, SAM);
    b.push("settlement", "s-1", "create", {
      fromMember: ADA, toMember: MARIE, amountMinor: 5000, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 5000, occurredAt: Date.UTC(2026, 3, 7), note: null,
    }, ADA);

    const plan = read(records(csvOf(b.ops)));
    expect(plan.entries).toHaveLength(4);
    expect(plan.transfers).toHaveLength(1);
    expect(balancesOf(plan)).toEqual(computeBalances(foldOps(b.ops)).byMember);
  });
});
