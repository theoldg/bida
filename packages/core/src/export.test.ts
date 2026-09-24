import { describe, expect, it } from "vitest";
import { computeBalances } from "./balance.js";
import { exportColumns, groupToCsv } from "./export.js";
import { ADA, GROUP, MARIE, OpBuilder, SAM, THEO, marrakechOps } from "./fixtures.test-helper.js";
import { foldOps } from "./fold.js";
import { emptyGroupState, type GroupState } from "./types.js";

/** The options the builder needs, fixed to UTC so the rows are pinned. */
const utcDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);
const EXPORTED_AT = Date.UTC(2026, 8, 18);
const csvOf = (state: GroupState) =>
  groupToCsv(state, { formatDay: utcDay, exportedAt: EXPORTED_AT });

/**
 * The file as records and cells, unquoted, without the two structural blank
 * lines (`theShapeOfTheFile` checks those).
 */
function parse(csv: string): string[][] {
  expect(csv.endsWith("\n\n")).toBe(true);
  return csv.trimEnd().split("\n").filter((line) => line !== "").map((line) => {
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

/** Every row nets to zero, so column totals are balances. */
function everyRowSumsToZero(csv: string): void {
  const rows = parse(csv);
  const members = rows[0]!.slice(5);
  for (const row of rows.slice(1, -1)) {
    const sum = row.slice(5).reduce((a, c) => a + Number(c), 0);
    expect(Math.abs(sum), `row ${row[1]} over ${members.length} columns`).toBeLessThan(0.0001);
  }
}

/** The foot, as the balances it claims to be: memberId -> minor units. */
function footMinor(csv: string, currency = "EUR"): Record<string, number> {
  const rows = parse(csv);
  const header = rows[0]!;
  const foot = rows[rows.length - 1]!;
  expect(foot[1]).toBe("Total balance");
  const out: Record<string, number> = {};
  for (let i = 5; i < header.length; i++) {
    out[header[i]!] = Math.round(Number(foot[i]) * 10 ** (currency === "TND" ? 3 : currency === "JPY" ? 0 : 2));
  }
  return out;
}

describe("the Marrakech trip, as a spreadsheet", () => {
  const state = foldOps(marrakechOps());
  const csv = csvOf(state);
  const rows = parse(csv);

  it("leads with Splitwise's own header, then one column per member", () => {
    expect(rows[0]).toEqual([
      "Date", "Description", "Category", "Cost", "Currency", "ada", "marie", "sam", "theo",
    ]);
  });

  it("writes one row per entry, plus the foot", () => {
    expect(rows).toHaveLength(1 + 7 + 1);
  });

  it("runs oldest first, unlike every screen in the app", () => {
    const dates = rows.slice(1, -1).map((r) => r[0]!);
    expect([...dates]).toEqual([...dates].sort());
    expect(dates[0]).toBe("2026-04-03");
  });

  it("states the cost in the group's base currency, never the one it was typed in", () => {
    const nomad = rows.find((r) => r[1]?.includes("Nomad"))!;
    // 620 MAD at 0.0921 — the registry's figure, not "620".
    expect(nomad[3]).toBe("57.10");
    expect(nomad[4]).toBe("EUR");
  });

  it("nets every row to zero", () => {
    everyRowSumsToZero(csv);
  });

  it("foots to the balances the Balances screen shows, to the cent", () => {
    expect(footMinor(csv)).toEqual(computeBalances(state).byMember);
  });

  it("dates the foot the day the file left, and leaves its cost cell blank", () => {
    // Exactly what a real export writes; importers parse `Date` strictly.
    expect(rows[rows.length - 1]!.slice(0, 5)).toEqual([
      "2026-09-18", "Total balance", " ", " ", "EUR",
    ]);
  });

  it("gives the payer their whole outlay and the sharers their share", () => {
    const riad = rows.find((r) => r[1]?.startsWith("Riad"))!;
    // €580 paid by Marie, split four ways: +580 − 145 for her, −145 each.
    expect(riad.slice(5)).toEqual(["-145.00", "435.00", "-145.00", "-145.00"]);
  });

  it("defaults a category nobody set to the word every importer falls back to", () => {
    expect(rows[1]![2]).toBe("General");
  });
});

describe("the three kinds of entry", () => {
  function tripWith(build: (b: OpBuilder) => void): GroupState {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
    for (const [i, id] of [ADA, MARIE].entries()) {
      b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
    }
    build(b);
    return foldOps(b.ops);
  }

  const expense = (b: OpBuilder, over: Record<string, unknown> = {}) =>
    b.push("expense", "e1", "create", {
      description: "Lunch", occurredAt: Date.UTC(2026, 0, 2),
      amountMinor: 1000, currency: "EUR", rateToBase: "1", baseAmountMinor: 1000,
      paidBy: ADA, split: { mode: "equal", members: [ADA, MARIE] }, ...over,
    }, ADA);

  it("books an expense as a positive cost", () => {
    const csv = csvOf(tripWith((b) => expense(b)));
    const row = parse(csv)[1]!;
    expect(row.slice(2)).toEqual(["General", "10.00", "EUR", "5.00", "-5.00"]);
  });

  it("books an income as the same row read backwards, with a negative cost", () => {
    const state = tripWith((b) => expense(b, { kind: "income", description: "Deposit back" }));
    const row = parse(csvOf(state))[1]!;
    expect(row[3]).toBe("-10.00");
    // Ada took the money in, so she is down by it; both share the benefit.
    expect(row.slice(5)).toEqual(["-5.00", "5.00"]);
    expect(footMinor(csvOf(state))).toEqual(computeBalances(state).byMember);
  });

  it("books a transfer as a Payment, which is the row an importer knows", () => {
    const state = tripWith((b) => b.push("settlement", "s1", "create", {
      fromMember: MARIE, toMember: ADA, amountMinor: 500, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 500, occurredAt: Date.UTC(2026, 0, 3),
      note: "Paying you back",
    }, MARIE));
    const row = parse(csvOf(state))[1]!;
    expect(row[1]).toBe("Paying you back");
    expect(row[2]).toBe("Payment");
    expect(row.slice(5)).toEqual(["-5.00", "5.00"]);
  });

  it("names a transfer with no note after what it is", () => {
    const state = tripWith((b) => b.push("settlement", "s1", "create", {
      fromMember: MARIE, toMember: ADA, amountMinor: 500, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 500, occurredAt: Date.UTC(2026, 0, 3),
    }, MARIE));
    expect(parse(csvOf(state))[1]![1]).toBe("Payment");
  });

  it("foots all three together to the balances, and nets every row", () => {
    const state = tripWith((b) => {
      expense(b);
      b.push("expense", "e2", "create", {
        description: "Prize", kind: "income", occurredAt: Date.UTC(2026, 0, 4),
        amountMinor: 700, currency: "EUR", rateToBase: "1", baseAmountMinor: 700,
        paidBy: MARIE, split: { mode: "equal", members: [ADA, MARIE] },
      }, MARIE);
      b.push("settlement", "s1", "create", {
        fromMember: MARIE, toMember: ADA, amountMinor: 250, currency: "EUR",
        rateToBase: "1", baseAmountMinor: 250, occurredAt: Date.UTC(2026, 0, 5),
      }, MARIE);
    });
    everyRowSumsToZero(csvOf(state));
    expect(footMinor(csvOf(state))).toEqual(computeBalances(state).byMember);
  });
});

describe("currencies whose minor unit isn't a hundredth", () => {
  function groupIn(currency: string, amountMinor: number): GroupState {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: currency, createdAt: 1 }, THEO);
    for (const [i, id] of [ADA, MARIE, SAM].entries()) {
      b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
    }
    b.push("expense", "e1", "create", {
      description: "Three ways", occurredAt: Date.UTC(2026, 0, 2),
      amountMinor, currency, rateToBase: "1", baseAmountMinor: amountMinor,
      paidBy: ADA, split: { mode: "equal", members: [ADA, MARIE, SAM] },
    }, ADA);
    return foldOps(b.ops);
  }

  it("writes a zero-decimal currency with no decimal point at all", () => {
    const state = groupIn("JPY", 1000);
    const row = parse(csvOf(state))[1]!;
    expect(row[3]).toBe("1000");
    // 1000 ÷ 3 is 334/333/333, and the row still nets to nothing.
    expect(row.slice(5).map(Number).reduce((a, b) => a + b, 0)).toBe(0);
    expect(footMinor(csvOf(state), "JPY")).toEqual(computeBalances(state).byMember);
  });

  it("writes a three-decimal currency to three places", () => {
    const state = groupIn("TND", 1000);
    const row = parse(csvOf(state))[1]!;
    expect(row[3]).toBe("1.000");
    // 1000 millimes ÷ 3 leaves one over; the seeded draw gives it to Ada on every device.
    expect(row.slice(5)).toEqual(["0.666", "-0.333", "-0.333"]);
    expect(footMinor(csvOf(state), "TND")).toEqual(computeBalances(state).byMember);
  });

  it("never lets a rounded share go missing", () => {
    for (const total of [1, 2, 7, 99, 100, 101, 1_000_001]) {
      everyRowSumsToZero(csvOf(groupIn("EUR", total)));
    }
  });
});

describe("what a person typed into a description", () => {
  function described(description: string): string[][] {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
    b.push("member", ADA, "create", { name: ADA, colorSeed: 1 }, THEO);
    b.push("expense", "e1", "create", {
      description, occurredAt: Date.UTC(2026, 0, 2),
      amountMinor: 100, currency: "EUR", rateToBase: "1", baseAmountMinor: 100,
      paidBy: ADA, split: { mode: "equal", members: [ADA] },
    }, ADA);
    return parse(csvOf(foldOps(b.ops)));
  }

  it("keeps a comma inside one cell", () => {
    expect(described("Dinner, wine")[1]![1]).toBe("Dinner, wine");
  });

  it("keeps quotes, doubled on the wire", () => {
    expect(described('The "good" cheese')[1]![1]).toBe('The "good" cheese');
  });

  it("quotes only the cells that need it", () => {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
    b.push("member", ADA, "create", { name: ADA, colorSeed: 1 }, THEO);
    b.push("expense", "e1", "create", {
      description: 'Dinner, "Nomad"', occurredAt: Date.UTC(2026, 0, 2),
      amountMinor: 100, currency: "EUR", rateToBase: "1", baseAmountMinor: 100,
      paidBy: ADA, split: { mode: "equal", members: [ADA] },
    }, ADA);
    // Line 1 is the blank under the header, so the entry is line 2.
    const line = csvOf(foldOps(b.ops)).split("\n")[2]!;
    expect(line).toBe('2026-01-02,"Dinner, ""Nomad""",General,1.00,EUR,0.00');
  });

  it("folds a newline into a space, so it can never read as a record break", () => {
    expect(described("Taxi\nfrom the airport")[1]![1]).toBe("Taxi from the airport");
    // Two newlines would otherwise look like the blank line ending the file.
    expect(described("Taxi\n\nfrom the airport")[1]![1]).toBe("Taxi from the airport");
  });

  it("leaves an unnamed entry's cell empty rather than inventing a word", () => {
    expect(described("")[1]![1]).toBe("");
  });
});

describe("a member who was removed but still owes", () => {
  const state = (() => {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
    for (const [i, id] of [ADA, MARIE].entries()) {
      b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
    }
    b.push("expense", "e1", "create", {
      description: "Lunch", occurredAt: Date.UTC(2026, 0, 2),
      amountMinor: 1000, currency: "EUR", rateToBase: "1", baseAmountMinor: 1000,
      paidBy: ADA, split: { mode: "equal", members: [ADA, MARIE] },
    }, ADA);
    b.push("member", MARIE, "delete", { deletedAt: Date.UTC(2026, 0, 3) }, ADA);
    return foldOps(b.ops);
  })();

  it("still gives them a column, or nothing would add up", () => {
    expect(parse(csvOf(state))[0]!.slice(5)).toEqual([ADA, MARIE]);
    expect(exportColumns(state).map((c) => c.departed)).toEqual([false, true]);
  });

  it("puts nothing in the header but their name — it is what an importer matches", () => {
    expect(parse(csvOf(state))[0]!).not.toContain("marie (removed)");
  });

  it("foots to the balances, departed member included", () => {
    expect(footMinor(csvOf(state))).toEqual(computeBalances(state).byMember);
  });
});

describe("an expense nothing can apportion", () => {
  const state = (() => {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
    for (const [i, id] of [ADA, MARIE].entries()) {
      b.push("member", id, "create", { name: id, colorSeed: i }, THEO);
    }
    b.push("expense", "e1", "create", {
      description: "Lunch", occurredAt: Date.UTC(2026, 0, 2),
      amountMinor: 1000, currency: "EUR", rateToBase: "1", baseAmountMinor: 1000,
      paidBy: ADA, split: { mode: "equal", members: [ADA, MARIE] },
    }, ADA);
    // Doesn't add up: `computeBalances` leaves it out.
    b.push("expense", "e2", "create", {
      description: "Broken", occurredAt: Date.UTC(2026, 0, 3),
      amountMinor: 900, currency: "EUR", rateToBase: "1", baseAmountMinor: 900,
      paidBy: ADA, split: { mode: "exact", amounts: { [ADA]: 100, [MARIE]: 100 } },
    }, ADA);
    return foldOps(b.ops);
  })();

  it("is a problem the balances already report", () => {
    expect(computeBalances(state).problems.map((p) => p.expenseId)).toEqual(["e2"]);
  });

  it("keeps the row, so the export loses nothing somebody typed", () => {
    const row = parse(csvOf(state)).find((r) => r[1] === "Broken")!;
    expect(row[3]).toBe("9.00");
  });

  it("apportions none of it, so the foot still matches the balances", () => {
    const row = parse(csvOf(state)).find((r) => r[1] === "Broken")!;
    expect(row.slice(5)).toEqual(["0.00", "0.00"]);
    expect(footMinor(csvOf(state))).toEqual(computeBalances(state).byMember);
  });
});

/**
 * The bytes, pinned: getting them wrong makes Tricount reject the file, and
 * no cell assertion would notice. Checked against a Splitwise export Tricount
 * accepts.
 */
describe("the bytes an importer actually reads", () => {
  const csv = csvOf(foldOps(marrakechOps()));

  it("ends its lines with LF, never CRLF", () => {
    expect(csv).not.toContain("\r");
  });

  it("opens on the header, with no byte-order mark in front of it", () => {
    expect(csv.startsWith("Date,")).toBe(true);
  });

  it("leaves a blank line under the header, above the foot, and at the end", () => {
    const lines = csv.split("\n");
    expect(lines[1]).toBe("");
    expect(lines[lines.length - 4]).toBe("");
    expect(csv.endsWith("\n\n")).toBe(true);
    // Exactly those blanks (LF split adds two for the trailing line); another
    // would end the import early for some readers.
    expect(lines.filter((l) => l === "")).toHaveLength(4);
  });
});

describe("the edges of the shape", () => {
  it("refuses a state with no group rather than guessing a currency", () => {
    expect(() => csvOf(emptyGroupState())).toThrow(/no group/);
  });

  it("writes a header and a foot for a group with nothing in it", () => {
    const b = new OpBuilder();
    b.push("group", GROUP, "create", { name: "T", baseCurrency: "EUR", createdAt: 1 }, THEO);
    b.push("member", ADA, "create", { name: ADA, colorSeed: 1 }, THEO);
    const rows = parse(csvOf(foldOps(b.ops)));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["2026-09-18", "Total balance", " ", " ", "EUR", "0.00"]);
  });

  it("orders columns by name, not by the order the fold happened to hand over", () => {
    expect(exportColumns(foldOps(marrakechOps())).map((c) => c.name))
      .toEqual([ADA, MARIE, SAM, THEO]);
  });
});
