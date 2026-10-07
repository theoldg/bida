import { describe, expect, it } from "vitest";
import { computeBalances } from "./balance.js";
import { readCsvGroup, type ImportPlan, type PlannedEntry } from "./import.js";
import { rateReproducing, seedFor, shapeEntry, shapeTransfer, type DayRate, type RateFor } from "./import-shape.js";
import { convertMinor, type CurrencyCode } from "./money.js";
import { memberIdFor } from "./names.js";
import { resolveEntrySplit, resolveSplit } from "./split.js";
import { readTricount } from "./tricount.js";
import { stateFromRows, type Expense, type Settlement } from "./types.js";

/**
 * Whatever shape is picked, the group written must balance exactly as the plan
 * the checksum approved — so every test that shapes a plan folds it through
 * `computeBalances` and compares.
 */

/**
 * Deterministic UUIDs, so a search is the same search every run: a counter up
 * front, so the tails a search walks never meet the next id, and a spread tail.
 */
function ids() {
  let n = 0;
  return () => {
    n += 1;
    const tail = ((n * 0x9e3779b97) % 2 ** 48).toString(16).padStart(12, "0");
    return `${n.toString(16).padStart(8, "0")}-0000-4000-8000-${tail}`;
  };
}

/**
 * Member ids as the app makes them. **Not `m0`, `m1`…**: ids alike but for a
 * last character hash into orders FNV rarely or never reaches, so a search
 * over them proves nothing about real groups.
 */
const idOf = (name: string) => memberIdFor("g", name);

/**
 * A clock a microsecond on per look — a generous budget, but one that ends, so
 * a search that can't succeed fails the test instead of hanging it — and one
 * out after the first look.
 */
function ticking() {
  let t = 0;
  return () => (t += 0.001);
}
function expired() {
  let t = 0;
  return () => (t += 1000);
}

const opts = (now: () => number = ticking()) => ({ newId: ids(), now });
const day = (d: string) => Date.parse(`${d}T00:00:00Z`);

function planned(over: Partial<PlannedEntry> & Pick<PlannedEntry, "amountMinor" | "paid" | "owed">): PlannedEntry {
  return {
    kind: "expense", description: "Dinner", categoryId: null,
    day: "2026-04-11", occurredAt: day("2026-04-11"), line: 1, ...over,
  };
}

/** Every entry and transfer shaped, written as rows, and balanced the way the app does. */
function land(plan: ImportPlan, now: () => number = ticking(), rateFor?: RateFor): {
  byName: Record<string, number>;
  expenses: Expense[];
  settlements: Settlement[];
} {
  const options = { newId: ids(), now, rateFor };
  const expenses = plan.entries.map((e): Expense => {
    const s = shapeEntry(e, plan.currency, idOf, options);
    return {
      id: s.id, groupId: "g", kind: e.kind, description: e.description,
      occurredAt: e.occurredAt, amountMinor: s.amountMinor, currency: s.currency,
      rateToBase: s.rateToBase, rateSource: s.rateSource,
      baseAmountMinor: convertMinor(s.amountMinor, s.currency, plan.currency, s.rateToBase),
      paidBy: Object.keys(s.payers)[0]!, payers: s.payers, split: s.split,
    };
  });
  const settlements = plan.transfers.map((t, i): Settlement => {
    const s = shapeTransfer(t, plan.currency, rateFor);
    return {
      id: `t${i}`, groupId: "g", fromMember: idOf(t.from), toMember: idOf(t.to),
      ...s, baseAmountMinor: convertMinor(s.amountMinor, s.currency, plan.currency, s.rateToBase),
      occurredAt: t.occurredAt,
    };
  });
  const state = stateFromRows({
    group: { id: "g", name: "g", baseCurrency: plan.currency, createdAt: 0 },
    members: plan.members.map((name) => ({ id: idOf(name), groupId: "g", name, colorSeed: 0 })),
    expenses,
    settlements,
  });
  const report = computeBalances(state);
  expect(report.problems).toEqual([]);
  const byName = Object.fromEntries(plan.members.map((name) => [name, report.byMember[idOf(name)] ?? 0]));
  return { byName, expenses, settlements };
}

describe("seedFor", () => {
  const people = (n: number) => Array.from({ length: n }, (_, i) => idOf(`p${i}`));
  const ones = (n: number) => Object.fromEntries(people(n).map((id) => [id, 1]));

  it("finds an id that hands a lone cent to whichever of three the source chose", () => {
    for (const lucky of people(3)) {
      const target = { ...Object.fromEntries(people(3).map((id) => [id, 333])), [lucky]: 334 };
      const id = seedFor(1000, ones(3), target, opts());
      expect(id).toBeDefined();
      expect(resolveSplit(1000, { mode: "equal", members: people(3) }, { tiebreakSeed: id! }).shares)
        .toEqual(target);
    }
  });

  it("solves the worst case — half the people a cent up — given the time", () => {
    const weights = ones(10);
    const target: Record<string, number> = {};
    people(10).forEach((id, i) => { target[id] = i % 2 === 0 ? 101 : 100; });
    const id = seedFor(1005, weights, target, opts());
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveSplit(1005, { mode: "shares", weights }, { tiebreakSeed: id! }).shares).toEqual(target);
  });

  it("gives up when the clock runs out", () => {
    const target: Record<string, number> = {};
    people(24).forEach((id, i) => { target[id] = i % 2 === 0 ? 101 : 100; });
    expect(seedFor(2412, ones(24), target, opts(expired()))).toBeUndefined();
  });

  it("refuses a target no seed reaches: two cents apart, or the cent on a smaller remainder", () => {
    const [a, b, c] = people(3) as [string, string, string];
    expect(seedFor(1000, ones(3), { [a]: 335, [b]: 333, [c]: 332 }, opts())).toBeUndefined();
    // 10 by 2:1 is 6.67/3.33: the cent can only go to the bigger remainder.
    expect(seedFor(1000, { [a]: 2, [b]: 1 }, { [a]: 666, [b]: 334 }, opts())).toBeUndefined();
    expect(seedFor(1000, { [a]: 2, [b]: 1 }, { [a]: 667, [b]: 333 }, opts())).toBeDefined();
  });

  it("takes any id when nothing is left over", () => {
    expect(seedFor(900, ones(3), Object.fromEntries(people(3).map((id) => [id, 300])), opts())).toBeDefined();
  });
});

describe("rateReproducing", () => {
  it("keeps the source's rate when it converts to the source's figure", () => {
    expect(rateReproducing(22000, "TWD", 1000, "JPY", "4.5454")).toBe("4.5454");
  });

  it("finds the shortest rate that does when the source's misses", () => {
    const rate = rateReproducing(22000, "TWD", 1000, "JPY", "4.4")!;
    expect(convertMinor(22000, "TWD", "JPY", rate)).toBe(1000);
    // 4.55 would make 1,001 yen.
    expect(rate).toBe("4.545");
  });

  it("reproduces any figure across 0-, 2- and 3-decimal currencies", () => {
    const pairs: [CurrencyCode, CurrencyCode][] = [
      ["JPY", "EUR"], ["EUR", "JPY"], ["KWD", "EUR"], ["EUR", "KWD"], ["JPY", "KWD"], ["USD", "EUR"],
    ];
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (const [from, to] of pairs) {
      for (let i = 0; i < 200; i++) {
        const local = 1 + (next() % 5_000_000);
        const base = 1 + (next() % 5_000_000);
        const rate = rateReproducing(local, from, base, to);
        expect(rate, `${local} ${from} -> ${base} ${to}`).toBeDefined();
        expect(convertMinor(local, from, to, rate!)).toBe(base);
      }
    }
  });

  it("has nothing for a zero on either side", () => {
    expect(rateReproducing(0, "USD", 100, "EUR")).toBeUndefined();
    expect(rateReproducing(100, "USD", 0, "EUR")).toBeUndefined();
  });
});

describe("shapeEntry", () => {
  it("writes an even split as Evenly, the cent where the source put it", () => {
    const e = planned({ amountMinor: 1000, paid: { Ana: 1000 }, owed: { Ana: 333, Bo: 334, Cy: 333 } });
    const s = shapeEntry(e, "EUR", idOf, opts());
    expect(s.split).toEqual({ mode: "equal", members: [idOf("Ana"), idOf("Bo"), idOf("Cy")].sort() });
    expect(s.currency).toBe("EUR");
    expect(s.rateSource).toBeNull();
    expect(resolveSplit(1000, s.split, { tiebreakSeed: s.id }).shares)
      .toEqual({ [idOf("Ana")]: 333, [idOf("Bo")]: 334, [idOf("Cy")]: 333 });
  });

  it("writes uneven amounts as Amounts", () => {
    const e = planned({ amountMinor: 1000, paid: { Ana: 1000 }, owed: { Ana: 600, Bo: 400 } });
    expect(shapeEntry(e, "EUR", idOf, opts()).split).toEqual({ mode: "exact", amounts: { [idOf("Ana")]: 600, [idOf("Bo")]: 400 } });
  });

  it("writes the source's parts as Parts", () => {
    const e = planned({ amountMinor: 1000, paid: { Ana: 1000 }, owed: { Ana: 667, Bo: 333 }, parts: { Ana: 2, Bo: 1 } });
    expect(shapeEntry(e, "EUR", idOf, opts()).split).toEqual({ mode: "shares", weights: { [idOf("Ana")]: 2, [idOf("Bo")]: 1 } });
  });

  it("calls parts all alike Evenly", () => {
    const e = planned({ amountMinor: 900, paid: { Ana: 900 }, owed: { Ana: 300, Bo: 300, Cy: 300 }, parts: { Ana: 1, Bo: 1, Cy: 1 } });
    expect(shapeEntry(e, "EUR", idOf, opts()).split.mode).toBe("equal");
  });

  it("falls back to Amounts when the search runs out of time", () => {
    const owed: Record<string, number> = {};
    for (let i = 0; i < 24; i++) owed[`p${i}`] = i % 2 === 0 ? 101 : 100;
    const e = planned({ amountMinor: 2412, paid: { p0: 2412 }, owed });
    expect(shapeEntry(e, "EUR", idOf, opts(expired())).split.mode).toBe("exact");
  });

  it("keeps a foreign entry in its own currency, at a rate that lands on the base figure", () => {
    const e = planned({
      amountMinor: 1000, paid: { Ana: 1000 }, owed: { Ana: 500, Bo: 500 },
      local: { currency: "TWD", amountMinor: 22000, rate: "4.5454" },
    });
    const s = shapeEntry(e, "JPY", idOf, opts());
    expect(s).toMatchObject({
      currency: "TWD", amountMinor: 22000, rateToBase: "4.5454", rateSource: "imported",
      split: { mode: "equal" }, payers: { [idOf("Ana")]: 22000 },
    });
  });

  it("writes a foreign split's amounts in its own currency, and they still give the base shares", () => {
    const e = planned({
      amountMinor: 1001, paid: { Ana: 1001 }, owed: { Ana: 700, Bo: 301 },
      local: { currency: "TWD", amountMinor: 22000, rate: null },
    });
    const s = shapeEntry(e, "JPY", idOf, opts());
    expect(s.currency).toBe("TWD");
    expect(s.split.mode).toBe("exact");
    const baseAmountMinor = convertMinor(s.amountMinor, s.currency, "JPY", s.rateToBase);
    expect(baseAmountMinor).toBe(1001);
    expect(resolveEntrySplit({ id: s.id, amountMinor: s.amountMinor, baseAmountMinor, split: s.split }).shares)
      .toEqual({ [idOf("Ana")]: 700, [idOf("Bo")]: 301 });
  });
});

describe("a CSV's even rows", () => {
  it("come in as Evenly and still balance to the foot", () => {
    const rows = [
      ["Date", "Description", "Category", "Cost", "Currency", "Ana", "Bo", "Cy"],
      ["2026-04-11", "Dinner", "General", "10.00", "EUR", "6.67", "-3.34", "-3.33"],
      ["2026-04-12", "Taxi", "General", "9.00", "EUR", "-3.00", "6.00", "-3.00"],
      ["2026-04-12", "Wine", "General", "5.00", "EUR", "-1.00", "-2.00", "3.00"],
      ["2026-04-13", "Total balance", "", "", "EUR", "2.67", "0.66", "-3.33"],
    ];
    const plan = readCsvGroup(rows, { dayToTimestamp: day });
    const { byName, expenses } = land(plan);
    expect(byName).toEqual(plan.stated);
    expect(expenses.map((e) => e.split.mode)).toEqual(["equal", "equal", "exact"]);
  });
});

describe("a tricount in two currencies, split by parts", () => {
  function member(name: string) {
    return { RegistryMembershipNonUser: { alias: { display_name: name } } };
  }
  function alloc(name: string, value: string, extra: Record<string, unknown> = {}) {
    return { amount: { value, currency: "JPY" }, membership: member(name), type: "AMOUNT", ...extra };
  }
  const payload = {
    Response: [{
      Registry: {
        title: "Taiwan",
        memberships: ["Ana", "Bo", "Cy"].map(member),
        all_registry_entry: [
          { RegistryEntry: {
            description: "Ramen", date: "2026-03-02 12:00:00.000000", type_transaction: "NORMAL",
            amount: { value: "-1000", currency: "JPY" }, membership_owned: member("Ana"),
            allocations: [alloc("Ana", "-334"), alloc("Bo", "-333"), alloc("Cy", "-333")],
          } },
          { RegistryEntry: {
            description: "Night market", date: "2026-03-03 20:00:00.000000", type_transaction: "NORMAL",
            amount: { value: "-1000", currency: "JPY" },
            amount_local: { value: "-220.00", currency: "TWD" }, exchange_rate: "4.5454",
            membership_owned: member("Bo"),
            allocations: [
              alloc("Ana", "-500", { type: "RATIO", share_ratio: 2 }),
              alloc("Bo", "-250", { type: "RATIO", share_ratio: 1 }),
              alloc("Cy", "-250", { type: "RATIO", share_ratio: 1 }),
            ],
          } },
          { RegistryEntry: {
            description: "Gone", date: "2026-03-03 21:00:00.000000", type_transaction: "NORMAL",
            status: "DELETED", amount: { value: "-9999", currency: "JPY" }, membership_owned: member("Cy"),
            allocations: [alloc("Ana", "-9999")],
          } },
          { RegistryEntry: {
            description: "", date: "2026-03-04 09:00:00.000000", type_transaction: "BALANCE",
            amount: { value: "-500", currency: "JPY" },
            amount_local: { value: "-110.00", currency: "TWD" }, exchange_rate: "4.5454",
            membership_owned: member("Cy"), allocations: [alloc("Bo", "-500")],
          } },
        ],
      },
    }],
  };

  const plan = readTricount(payload, { dayToTimestamp: day });

  it("leaves out an entry somebody deleted", () => {
    expect(plan.entries.map((e) => e.description)).toEqual(["Ramen", "Night market"]);
  });

  it("reads what each entry was spent as, and the parts it was split by", () => {
    expect(plan.entries[1]).toMatchObject({
      local: { currency: "TWD", amountMinor: 22000, rate: "4.5454" },
      parts: { Ana: 2, Bo: 1, Cy: 1 },
    });
    expect(plan.transfers[0]!.local).toEqual({ currency: "TWD", amountMinor: 11000, rate: "4.5454" });
  });

  it("writes them Evenly, by Parts and in TWD, balancing exactly as the tricount does", () => {
    const { byName, expenses, settlements } = land(plan);
    expect(byName).toEqual(plan.stated);
    expect(expenses.map((e) => [e.split.mode, e.currency])).toEqual([["equal", "JPY"], ["shares", "TWD"]]);
    expect(settlements[0]).toMatchObject({ currency: "TWD", amountMinor: 11000, baseAmountMinor: 500 });
  });

  it("ignores a spent-as figure it cannot read, rather than refusing what imports today", () => {
    const broken = structuredClone(payload);
    const night = broken.Response[0]!.Registry.all_registry_entry[1]!.RegistryEntry as Record<string, unknown>;
    night["amount_local"] = { value: "lots", currency: "TWD" };
    const again = readTricount(broken, { dayToTimestamp: day });
    expect(again.entries[1]!.local).toBeUndefined();
    expect(land(again).expenses[1]!.currency).toBe("JPY");
  });
});

describe("a CSV in two currencies, priced by day", () => {
  const rows = [
    ["Date", "Description", "Category", "Cost", "Currency", "Ana", "Bo"],
    ["2026-04-03", "Dinner", "General", "30.00", "EUR", "15.00", "-15.00"],
    ["2026-04-04", "Tagine", "General", "301.00", "MAD", "-150.50", "150.50"],
    ["2026-04-05", "Riad", "General", "90.00", "EUR", "-45.00", "45.00"],
    ["2026-04-05", "Coffee", "General", "4.00", "EUR", "2.00", "-2.00"],
    ["2026-04-06", "Coffee", "General", "4.00", "EUR", "2.00", "-2.00"],
    ["2026-04-05", "Rugs", "General", "500.00", "MAD", "400.00", "-400.00"],
    ["2026-04-06", "Settling", "Payment", "100.00", "MAD", "100.00", "-100.00"],
    ["2026-09-18", "Total balance", " ", " ", "EUR", "-26.00", "26.00"],
    ["2026-09-18", "Total balance", " ", " ", "MAD", "349.50", "-349.50"],
  ];
  const plan = readCsvGroup(rows, { dayToTimestamp: day });
  const rates: Record<string, DayRate> = {
    "MAD 2026-04-04": { rate: "0.0921", source: "fetched" },
    "MAD 2026-04-05": { rate: "0.0925", source: "fetched" },
    "MAD 2026-04-06": { rate: "0.0925", source: "copied" },
  };
  const rateFor: RateFor = (currency, d) => rates[`${currency} ${d}`];

  it("writes each foreign row in its own currency at its own day's rate", () => {
    const { expenses, settlements } = land(plan, ticking(), rateFor);
    expect(expenses.map((e) => [e.description, e.currency, e.rateToBase, e.rateSource])).toEqual([
      ["Dinner", "EUR", "1", null],
      ["Tagine", "MAD", "0.0921", "fetched"],
      ["Riad", "EUR", "1", null],
      ["Coffee", "EUR", "1", null],
      ["Coffee", "EUR", "1", null],
      ["Rugs", "MAD", "0.0925", "fetched"],
    ]);
    expect(settlements[0]).toMatchObject({ currency: "MAD", amountMinor: 10000, rateToBase: "0.0925", rateSource: "copied" });
  });

  it("splits a foreign row Evenly when its own shares are even, Amounts when not", () => {
    const { expenses } = land(plan, ticking(), rateFor);
    expect(expenses[1]!.split.mode).toBe("equal");
    expect(expenses[5]!.split).toEqual({ mode: "exact", amounts: { [idOf("Ana")]: 10000, [idOf("Bo")]: 40000 } });
  });

  it("balances to the base foot plus the other foot at each row's rate, give or take each row's rounding", () => {
    const { byName } = land(plan, ticking(), rateFor);
    expect(byName["Ana"]! + byName["Bo"]!).toBe(0);
    // -26 EUR; owes 150.50 MAD at 0.0921; up 400 MAD and then 100 more, at 0.0925.
    expect(Math.abs(byName["Ana"]! - (-2600 - 1386 + 3700 + 925))).toBeLessThanOrEqual(2);
  });

  it("refuses to write a foreign row with no rate, rather than banking it at 1", () => {
    expect(() => land(plan, ticking(), () => undefined)).toThrow(/no rate for MAD/);
  });
});
