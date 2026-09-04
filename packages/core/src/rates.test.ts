import { describe, expect, it } from "vitest";
import { foldOps } from "./fold.js";
import { computeBalances, assertBalanced } from "./balance.js";
import { atCurrentRates, currenciesInUse, rateFor, repriceEntry } from "./rates.js";
import { emptyGroupState, type ExchangeRate, type GroupState } from "./types.js";
import { MAD_RATE, marrakechOps, OpBuilder, GROUP, THEO } from "./fixtures.test-helper.js";

function row(id: string, rate: string, extra: Partial<ExchangeRate> = {}): ExchangeRate {
  return { id, groupId: GROUP, rate, source: "typed", asOf: 0, ...extra };
}

/**
 * The Marrakech fixture, plus whatever rate ops a test wants on the end of it.
 * A pair list rather than an object, so a test can set a rate and then remove
 * it — which is two ops on one currency, and the interesting case.
 */
function marrakechWith(...rates: [code: string, rate: string | null][]): GroupState {
  const b = new OpBuilder("rates", 1_744_600_000_000);
  for (const [code, rate] of rates) {
    if (rate === null) b.push("rate", code, "delete", {}, THEO);
    else b.push("rate", code, "create", { rate, source: "typed", asOf: 0, deletedAt: null }, THEO);
  }
  return foldOps([...marrakechOps(), ...b.ops]);
}

describe("rateFor", () => {
  const rates = { MAD: row("MAD", "0.0921") };

  it("answers 1 for the group's own currency without a row", () => {
    expect(rateFor({}, "EUR", "EUR")).toBe("1");
  });

  it("answers with the registry's number", () => {
    expect(rateFor(rates, "EUR", "MAD")).toBe("0.0921");
  });

  it("has nothing to say about a currency with no row", () => {
    expect(rateFor(rates, "EUR", "PLN")).toBeUndefined();
  });

  it("has nothing to say about a deleted row, or a rate that isn't one", () => {
    expect(rateFor({ MAD: row("MAD", "0.0921", { deletedAt: 1 }) }, "EUR", "MAD")).toBeUndefined();
    expect(rateFor({ MAD: row("MAD", "0") }, "EUR", "MAD")).toBeUndefined();
    expect(rateFor({ MAD: row("MAD", "abc") }, "EUR", "MAD")).toBeUndefined();
  });
});

describe("repriceEntry", () => {
  const entry = { amountMinor: 62000, currency: "MAD", rateToBase: "0.0921", baseAmountMinor: 5710 };

  it("values the entry at the registry rather than at what it was saved with", () => {
    const out = repriceEntry(entry, "EUR", { MAD: row("MAD", "0.093") });
    expect(out.rateToBase).toBe("0.093");
    expect(out.baseAmountMinor).toBe(5766);
  });

  it("leaves an entry whose currency the registry doesn't know", () => {
    expect(repriceEntry(entry, "EUR", {})).toBe(entry);
    expect(repriceEntry(entry, "EUR", {}).baseAmountMinor).toBe(5710);
  });

  it("returns the very same object when the registry agrees with the entry", () => {
    expect(repriceEntry(entry, "EUR", { MAD: row("MAD", "0.0921") })).toBe(entry);
  });

  it("passes a base-currency entry through at 1", () => {
    const eur = { amountMinor: 58000, currency: "EUR", rateToBase: "1", baseAmountMinor: 58000 };
    expect(repriceEntry(eur, "EUR", {})).toBe(eur);
  });

  // A rate arrives from another phone; a wrong one must cost that row its
  // repricing and nothing else. Balances render or the app is a white screen.
  it("keeps what was stored when the conversion won't fit", () => {
    const huge = { amountMinor: 9_000_000_000_000_000, currency: "MAD", rateToBase: "1", baseAmountMinor: 5710 };
    const out = repriceEntry(huge, "EUR", { MAD: row("MAD", "999999999") });
    expect(out).toBe(huge);
  });
});

describe("atCurrentRates", () => {
  it("moves every entry in the currency, and the balances with them", () => {
    const before = computeBalances(foldOps(marrakechOps()));
    const after = computeBalances(atCurrentRates(marrakechWith(["MAD", "0.1"])));
    expect(after.totalSpendMinor).toBeGreaterThan(before.totalSpendMinor);
    assertBalanced(after);
  });

  it("agrees with the frozen numbers when the registry says what the entries did", () => {
    const before = computeBalances(foldOps(marrakechOps()));
    const after = computeBalances(atCurrentRates(marrakechWith(["MAD", MAD_RATE])));
    expect(after.byMember).toEqual(before.byMember);
    expect(after.totalSpendMinor).toBe(before.totalSpendMinor);
  });

  it("leaves a group whose registry is empty exactly as it was", () => {
    const state = foldOps(marrakechOps());
    expect(atCurrentRates(state)).toBe(state);
  });

  // Removing a rate is not "the group has no idea what MAD is worth": it is
  // back to what each entry was saved with, which is what a group written
  // before the registry existed has for every one of its foreign entries.
  it("falls back to the frozen rate when the row is deleted", () => {
    const frozen = computeBalances(foldOps(marrakechOps()));
    const moved = atCurrentRates(marrakechWith(["MAD", "0.1"]));
    const removed = atCurrentRates(marrakechWith(["MAD", "0.1"], ["MAD", null]));
    expect(computeBalances(moved).byMember).not.toEqual(frozen.byMember);
    expect(computeBalances(removed).byMember).toEqual(frozen.byMember);
    expect(removed.expenses["e-nomad"]!.rateToBase).toBe(MAD_RATE);
  });

  it("reprices transfers too, not only expenses", () => {
    const b = new OpBuilder("t", 1_744_700_000_000);
    b.push("settlement", "s-1", "create", {
      fromMember: "ada", toMember: "theo", amountMinor: 50000, currency: "MAD",
      rateToBase: "0.0921", baseAmountMinor: 4605, occurredAt: 0,
    }, THEO);
    b.push("rate", "MAD", "create", { rate: "0.1", source: "typed", asOf: 0, deletedAt: null }, THEO);
    const state = atCurrentRates(foldOps([...marrakechOps(), ...b.ops]));
    expect(state.settlements["s-1"]!.baseAmountMinor).toBe(5000);
  });

  it("does nothing to a state with no group yet", () => {
    const state = emptyGroupState();
    expect(atCurrentRates(state)).toBe(state);
  });
});

describe("currenciesInUse", () => {
  it("names the currencies entries are written in, never the base one", () => {
    const used = currenciesInUse(foldOps(marrakechOps()));
    expect(used.map((c) => c.currency)).toEqual(["MAD"]);
    expect(used[0]!.entryCount).toBe(6);
    expect(used[0]!.rate).toBeUndefined();
  });

  it("carries the registry's row once there is one", () => {
    const used = currenciesInUse(marrakechWith(["MAD", "0.093"]));
    expect(used[0]!.rate?.rate).toBe("0.093");
  });

  it("includes a currency added ahead of being spent in", () => {
    const used = currenciesInUse(marrakechWith(["PLN", "0.23"]));
    expect(used.map((c) => c.currency)).toEqual(["MAD", "PLN"]);
    expect(used.find((c) => c.currency === "PLN")!.entryCount).toBe(0);
  });

  it("drops a removed rate that no entry is written in", () => {
    const used = currenciesInUse(marrakechWith(["PLN", "0.23"], ["PLN", null]));
    expect(used.map((c) => c.currency)).toEqual(["MAD"]);
  });

  // The currency the trip is actually being spent in is the row to reach for.
  it("puts the currency with the most entries first", () => {
    const b = new OpBuilder("p", 1_744_800_000_000);
    b.push("expense", "e-pln", "create", {
      description: "Pierogi", occurredAt: 0, amountMinor: 4500, currency: "PLN",
      rateToBase: "0.23", baseAmountMinor: 1035, paidBy: THEO,
      split: { mode: "equal", members: [THEO] }, attachmentIds: [],
    }, THEO);
    const used = currenciesInUse(foldOps([...marrakechOps(), ...b.ops]));
    expect(used.map((c) => [c.currency, c.entryCount])).toEqual([["MAD", 6], ["PLN", 1]]);
  });
});

describe("a rate is an op", () => {
  it("folds into the registry, and the last write wins per currency", () => {
    const b = new OpBuilder("r");
    b.push("rate", "MAD", "create", { rate: "0.09", source: "fetched", asOf: 1, deletedAt: null }, THEO);
    b.push("rate", "MAD", "update", { rate: "0.0921", source: "typed" }, THEO);
    const state = foldOps([...marrakechOps(), ...b.ops]);
    expect(state.rates["MAD"]).toMatchObject({
      id: "MAD", groupId: GROUP, rate: "0.0921", source: "typed", asOf: 1,
    });
  });

  it("tombstones like everything else", () => {
    const b = new OpBuilder("r");
    b.push("rate", "PLN", "create", { rate: "0.23", source: "typed", asOf: 1, deletedAt: null }, THEO);
    b.push("rate", "PLN", "delete", {}, THEO);
    const state = foldOps([...marrakechOps(), ...b.ops]);
    expect(state.rates["PLN"]!.deletedAt).toBeTruthy();
    expect(rateFor(state.rates, "EUR", "PLN")).toBeUndefined();
  });
});
