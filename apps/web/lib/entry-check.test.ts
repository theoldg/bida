import { describe, expect, it } from "vitest";
import type { ExchangeRate } from "@bida/core";
import { checkEntry, needsRate } from "./entry-check";
import { blankDraft, type EntryDraft } from "./draft";
import { copy } from "./copy";

/**
 * The arithmetic behind one grey button, as plain questions — a rate
 * defaulting to "1", a transfer to someone who left, an Items tab over a
 * split no receipt produced — rather than a disabled attribute on a mounted
 * form.
 */

const THEO = "m-theo", MARIE = "m-marie", GONE = "m-gone";
const MEMBERS = [THEO, MARIE];
const NAMES: Record<string, string> = { [THEO]: "Theo", [MARIE]: "Marie", [GONE]: "Bruno" };

/** One row of the group's registry: 1 `code` is worth `r` of the base. */
function rate(code: string, r: string): ExchangeRate {
  return { id: code, groupId: "g", rate: r, source: "typed", asOf: 0 };
}

function check(draft: EntryDraft, rates: ExchangeRate[] = [], liveMembers = MEMBERS) {
  return checkEntry({
    draft,
    base: "EUR",
    rates: Object.fromEntries(rates.map((r) => [r.id, r])),
    liveMembers,
    nameOf: (id) => NAMES[id] ?? copy.unknown,
  });
}

/** A saveable expense, which each test then breaks in exactly one way. */
function expense(over: Partial<EntryDraft> = {}): EntryDraft {
  return {
    ...blankDraft("expense", THEO, "EUR", MEMBERS),
    amountText: "40.00",
    description: "Dinner",
    ...over,
  };
}

describe("checkEntry", () => {
  it("lights Save on an ordinary expense in the group's own currency", () => {
    const c = check(expense());
    expect(c.ready).toBe(true);
    expect(c.blocker).toBeNull();
    expect(c.amountMinor).toBe(4000);
    expect(c.baseMinor).toBe(4000);
    expect(c.foreign).toBe(false);
  });

  it("holds Save on an expense with no words on it", () => {
    // A transfer's words are a note; an expense without a name is a row nobody
    // can identify a week later.
    const c = check(expense({ description: "  " }));
    expect(c.ready).toBe(false);
    expect(c.titleMissing).toBe(true);
    expect(c.amountMissing).toBe(false);
    const t = check({ ...expense({ description: "" }), kind: "transfer" });
    expect(t.ready).toBe(true);
    expect(t.titleMissing).toBe(false);
  });

  it("holds Save on an amount of nothing", () => {
    expect(check(expense({ amountText: "" })).amountMissing).toBe(true);
    expect(check(expense({ amountText: "0" })).amountMissing).toBe(true);
    expect(check(expense({ amountText: "" })).ready).toBe(false);
    expect(check(expense({ amountText: "0" })).ready).toBe(false);
    expect(check(expense()).amountMissing).toBe(false);
  });

  describe("a currency the group has no rate for", () => {
    it("holds Save, and says so by pointing rather than in words", () => {
      const c = check(expense({ currency: "MAD" }));
      expect(c.ready).toBe(false);
      // The form's rate badge blooms on the refused Save; nothing is written
      // under the fields, because the number is not set on this screen.
      expect(c.blocker).toBeNull();
      // Not silently 1:1 — that is how a 500 MAD dinner was banked as €500.
      expect(c.groupRate).toBeUndefined();
      expect(c.baseMinor).toBe(0);
    });

    it("converts at the group's rate once it has one", () => {
      const c = check(expense({ currency: "MAD", amountText: "500.00" }), [rate("MAD", "0.0921")]);
      expect(c.ready).toBe(true);
      expect(c.foreign).toBe(true);
      expect(c.baseMinor).toBe(4605); // 50000 × 0.0921
    });

    it("treats a conversion out of safe-integer range as no base amount", () => {
      // Each of these is in range on its own; the product is not. This runs in
      // a render body, so the alternative to `rateOk` is a white screen.
      const c = check(expense({ currency: "MAD", amountText: "999999999999" }),
        [rate("MAD", "999999999")]);
      expect(c.rateOk).toBe(false);
      expect(c.ready).toBe(false);
      expect(c.baseMinor).toBe(0);
    });
  });

  describe("somebody named on the entry has left", () => {
    it("holds Save and names them, when they are the payer", () => {
      const c = check(expense({ paidBy: GONE }));
      expect(c.ready).toBe(false);
      expect(c.blocker).toBe(copy.form.goneMember("Bruno"));
    });

    it("holds Save when they are only in the split", () => {
      const c = check(expense({ splits: { equal: { mode: "equal", members: [THEO, GONE] } } }));
      expect(c.ready).toBe(false);
      expect(c.blocker).toBe(copy.form.goneMember("Bruno"));
    });

    it("holds Save on a transfer to them — the settle-up row that offered it", () => {
      // The balances screen still lists a departed member's balance and offers to
      // square it off. Following that row must not open a saveable transfer.
      const c = check({
        ...blankDraft("transfer", THEO, "EUR", MEMBERS),
        amountText: "30.00", fromMember: THEO, toMember: GONE,
      });
      expect(c.ready).toBe(false);
      expect(c.blocker).toBe(copy.form.goneMember("Bruno"));
    });
  });

  it("holds a transfer whose two sides are one person", () => {
    const c = check({
      ...blankDraft("transfer", THEO, "EUR", MEMBERS),
      amountText: "30.00", fromMember: THEO, toMember: THEO,
    });
    expect(c.ready).toBe(false);
  });

  describe("Receipt mode", () => {
    const items = [{ label: "Steak", amount: "30.00" }, { label: "Coffee", amount: "10.00" }];

    it("holds Save on the tab with no bill behind it", () => {
      const c = check(expense({ splitTab: "receipt" }));
      expect(c.ready).toBe(false);
      // Nothing beside Save: the refusal is the scan control blooming, so this
      // says only that a step is outstanding — never which sentence to print.
      expect(c.blocker).toBeNull();
      expect(c.receiptMissing).toBe(true);
    });

    it("holds Save on a scanned bill nobody has assigned", () => {
      // The tab is a claim that the split was read off a receipt. Without this
      // a scan whose grid was never filled in went out evenly, saying it
      // hadn't.
      const c = check(expense({ splitTab: "receipt", receiptItems: items }));
      expect(c.ready).toBe(false);
      expect(c.receiptMissing).toBe(true);
    });

    it("derives the amount and the split once the grid is filled in", () => {
      const c = check(expense({
        amountText: "1.00", // ignored: the bill is what the entry is worth
        splitTab: "receipt",
        receiptItems: items,
        receiptInvolved: [THEO, MARIE],
        receiptAssignments: [[THEO], [MARIE]],
      }));
      expect(c.ready).toBe(true);
      expect(c.receiptTotal).toBe(4000);
      expect(c.receiptLocksAmount).toBe(true);
      expect(c.amountMinor).toBe(4000);
      // Theo had the €30 steak, Marie the €10 coffee.
      expect(c.effectiveSplit).toEqual({ mode: "receipt", weights: { [THEO]: 3000, [MARIE]: 1000 } });
    });

    it("reads its split off the bill, not off the tab it was opened over", () => {
      // The As parts tab still holds 3:1 in the draft (`draft.test.ts`); what
      // this expense is worth to each comes from the receipt alone.
      const draft = expense({
        splits: { shares: { mode: "shares", weights: { [THEO]: 3, [MARIE]: 1 } } },
        splitTab: "receipt",
        receiptItems: items,
        receiptInvolved: [THEO, MARIE],
        receiptAssignments: [[THEO], [MARIE]],
      });
      const c = check(draft);
      expect(c.receiptSplit).toEqual({ mode: "receipt", weights: { [THEO]: 3000, [MARIE]: 1000 } });
      expect(c.effectiveSplit).toBe(c.receiptSplit);
      expect(draft.splits.shares).toEqual({ mode: "shares", weights: { [THEO]: 3, [MARIE]: 1 } });
    });

    it("never locks the amount field on a bill worth nothing", () => {
      // Disabled *and* empty is a screen with nothing to type in and a Save
      // that will never light.
      const c = check(expense({ splitTab: "receipt", receiptItems: [{ label: "x", amount: "0" }] }));
      expect(c.receiptLocksAmount).toBe(false);
    });

    it("is not a thing an income has", () => {
      const c = check(expense({ kind: "income", splitTab: "receipt", receiptItems: items }));
      expect(c.canScan).toBe(false);
      expect(c.blocker).toBeNull();
      expect(c.receiptMissing).toBe(false);
      expect(c.ready).toBe(true);
    });
  });

  it("checks co-payers against the amount in the entry's own currency", () => {
    // 40.00 typed, 25.00 accounted for: the number people check against a
    // receipt is the one they typed, not its converted twin.
    const c = check(expense({ payers: { [THEO]: 2000, [MARIE]: 500 } }));
    expect(c.ready).toBe(false);
    expect(c.blocker).not.toBeNull();
    expect(check(expense({ payers: { [THEO]: 3000, [MARIE]: 1000 } })).ready).toBe(true);
  });
});

describe("needsRate", () => {
  it("is false for the group's own currency, and true for one it has never priced", () => {
    expect(needsRate({}, "EUR", "EUR")).toBe(false);
    expect(needsRate({}, "EUR", "MAD")).toBe(true);
    expect(needsRate({ MAD: rate("MAD", "0.0921") }, "EUR", "MAD")).toBe(false);
  });

  it("asks nothing of a group that hasn't loaded", () => {
    expect(needsRate({}, undefined, "MAD")).toBe(false);
  });
});
