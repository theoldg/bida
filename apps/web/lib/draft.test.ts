import { describe, expect, it } from "vitest";
import { resolveSplit, splitParticipants, type SplitSpec } from "@hajsik/core";
import {
  activeSplit, activeSplitTab, blankDraft, draftReceiptSplit, legacyPercent, newEntryKey,
  openSplitTab, receiptWeights, splitSeed, withSplit, type EntryDraft, type SplitTab,
} from "./draft";

/**
 * Four tabs, four answers.
 *
 * The split editor used to hold one `SplitSpec` and convert it on every tab
 * switch, so the tabs edited each other: leaving somebody out under Evenly
 * deleted the parts they had under As parts, As amounts would only let you
 * type for whoever Evenly had ticked, and a scan overwrote all three. What is
 * checked here is that opening a tab is a handoff made **once** — and that
 * from then on each tab keeps what was typed into it, whatever the others say.
 */

const A = "m-ana", B = "m-bo", C = "m-cy";
const MEMBERS = [A, B, C];

function expense(over: Partial<EntryDraft> = {}): EntryDraft {
  return { ...blankDraft("expense", A, "EUR", MEMBERS), amountText: "90.00", ...over };
}

/** Open a tab the way the form does: the inputs it gets, and the tab it is on. */
function open(draft: EntryDraft, tab: SplitTab, totalMinor = 9000): EntryDraft {
  return { ...draft, splitTab: tab, splits: openSplitTab(draft, tab, totalMinor) };
}

describe("the arithmetic tabs are independent", () => {
  it("hands a first-time tab what is on screen, so even-then-nudge still works", () => {
    const d = open(expense(), "exact");
    expect(d.splits.exact).toEqual({ mode: "exact", amounts: { [A]: 3000, [B]: 3000, [C]: 3000 } });
  });

  it("keeps somebody in As parts after Evenly leaves them out", () => {
    // The reported bug, in three taps: give Cy two parts, go back to Evenly,
    // drop Cy, come back. Cy's two parts are still there.
    let d = open(expense(), "shares");
    d = { ...d, splits: withSplit(d.splits, { mode: "shares", weights: { [A]: 1, [B]: 1, [C]: 2 } }) };
    d = open(d, "equal");
    d = { ...d, splits: withSplit(d.splits, { mode: "equal", members: [A, B] }) };
    d = open(d, "shares");
    expect(d.splits.shares).toEqual({ mode: "shares", weights: { [A]: 1, [B]: 1, [C]: 2 } });
    expect(splitParticipants(activeSplit(d))).toEqual([A, B, C]);
  });

  it("keeps the amounts typed into As amounts when Evenly changes", () => {
    let d = open(expense(), "exact");
    d = { ...d, splits: withSplit(d.splits, { mode: "exact", amounts: { [A]: 5000, [B]: 4000 } }) };
    d = open(d, "equal");
    d = { ...d, splits: withSplit(d.splits, { mode: "equal", members: [C] }) };
    d = open(d, "exact");
    expect(d.splits.exact).toEqual({ mode: "exact", amounts: { [A]: 5000, [B]: 4000 } });
  });

  it("leaves the other tabs alone when one of them is edited", () => {
    const d = open(open(expense(), "shares"), "exact");
    const next = { ...d, splits: withSplit(d.splits, { mode: "exact", amounts: { [A]: 9000 } }) };
    expect(next.splits.equal).toEqual(d.splits.equal);
    expect(next.splits.shares).toEqual(d.splits.shares);
  });

  it("still divides the whole total, whichever tab was opened first", () => {
    // A seeded tab is money, so it has to add up: 9000 over three people is
    // 3000 each, and 10 000 over three is one of them a cent heavier.
    for (const first of ["equal", "shares", "exact"] as const) {
      for (const total of [9000, 10_000, 1]) {
        const d = open(expense(), first, total);
        const spec = activeSplit(d);
        const allocated = spec.mode === "exact"
          ? Object.values(spec.amounts).reduce((a, b) => a + b, 0) : total;
        expect(allocated).toBe(total);
      }
    }
  });
});

describe("Receipt is a fourth answer, not a fourth way of writing one", () => {
  const items = [{ label: "Steak", amount: "60.00" }, { label: "Coffee", amount: "30.00" }];

  it("does not touch the arithmetic tabs a scan lands on top of", () => {
    let d = open(expense(), "shares");
    d = { ...d, splits: withSplit(d.splits, { mode: "shares", weights: { [A]: 3, [B]: 1 } }) };
    // What the scan handler writes: the bill, and the tab it belongs to.
    d = { ...d, receiptItems: items, splitTab: "receipt" };
    expect(d.splits.shares).toEqual({ mode: "shares", weights: { [A]: 3, [B]: 1 } });
    expect(openSplitTab(d, "receipt", 9000)).toBe(d.splits);
    expect(activeSplit(open(d, "shares"))).toEqual({ mode: "shares", weights: { [A]: 3, [B]: 1 } });
  });

  it("hands nothing on to an arithmetic tab opened after it", () => {
    // Ana had the €60 steak, Bo the €30 coffee — a real receipt split. Leaving
    // Receipt for a tab nothing has been typed into starts it where it would
    // have started unscanned: evenly, over everyone. The grid's weights are
    // the grid's answer, and As parts is not where it gets to say it.
    const d = expense({
      receiptItems: items,
      splitTab: "receipt",
      receiptInvolved: [A, B],
      receiptAssignments: [[A], [B]],
    });
    expect(activeSplit(d)).toEqual({ mode: "receipt", weights: { [A]: 6000, [B]: 3000 } });
    expect(open(d, "exact").splits.exact)
      .toEqual({ mode: "exact", amounts: { [A]: 3000, [B]: 3000, [C]: 3000 } });
    expect(open(d, "shares").splits.shares)
      .toEqual({ mode: "shares", weights: { [A]: 1, [B]: 1, [C]: 1 } });
  });

  it("still shows the bill's own split while Receipt is the tab showing", () => {
    // Nothing above is a licence to lose the answer: the receipt tab derives
    // it from the grid, every read, and that is what a save writes.
    const d = expense({
      receiptItems: items,
      splitTab: "receipt",
      receiptInvolved: [A, B],
      receiptAssignments: [[A], [B]],
    });
    const after = open(d, "shares");
    expect(activeSplit({ ...after, splitTab: "receipt" }))
      .toEqual({ mode: "receipt", weights: { [A]: 6000, [B]: 3000 } });
  });

  it("is where a draft with a bill and no chosen tab starts", () => {
    expect(activeSplitTab(expense({ receiptItems: items, splitTab: undefined }))).toBe("receipt");
  });
});

describe("a legacy percent split", () => {
  const bps: SplitSpec = { mode: "percent", bps: { [A]: 6000, [B]: 4000 } };
  /** How an expense saved before the tabs existed is seeded: no tab of its own. */
  const saved = expense({ splits: withSplit({}, bps), splitTab: undefined });

  it("shows under As parts, with nothing pressed, until a tab is tapped", () => {
    expect(activeSplitTab(saved)).toBe("shares");
    expect(legacyPercent(saved)).toEqual(bps);
    expect(activeSplit(saved)).toEqual(bps);
  });

  it("converts away for good on the first tap", () => {
    const d = open(saved, "shares");
    expect(legacyPercent(d)).toBeNull();
    expect(d.splits.percent).toBeUndefined();
    expect(d.splits.shares).toEqual({ mode: "shares", weights: { [A]: 1, [B]: 1 } });
  });
});

describe("a blank draft", () => {
  it("opens on Evenly with everybody in it", () => {
    const d = blankDraft("expense", A, "EUR", MEMBERS);
    expect(activeSplitTab(d)).toBe("equal");
    expect(activeSplit(d)).toEqual({ mode: "equal", members: MEMBERS });
  });

  it("never defaults a transfer's note — only settle up's prefill does that", () => {
    const d = blankDraft("transfer", A, "EUR", MEMBERS);
    expect(d.description).toBe("");
  });
});

/**
 * The cent the form quotes is the cent the ledger keeps.
 *
 * `resolveSplit` hands the leftover minor unit out by `tiebreakSeed`, and the
 * seed is the entry's id — so a draft pricing its rows under a placeholder
 * showed the extra cent on one person's row and wrote it to another's. The
 * draft allocates the id it will be written under, and every screen prices
 * under `splitSeed`.
 */
describe("what rounding ties break by", () => {
  it("is the id a new entry will be written under, not a placeholder", () => {
    const d = blankDraft("expense", A, "EUR", MEMBERS);
    expect(d.newEntryId).toBeTruthy();
    expect(d.newEntryId).not.toBe("new");
    expect(splitSeed(d)).toBe(d.newEntryId);
  });

  it("gives two drafts their own, so one person doesn't take every cent", () => {
    const one = blankDraft("expense", A, "EUR", MEMBERS);
    const two = blankDraft("expense", A, "EUR", MEMBERS);
    expect(one.newEntryId).not.toBe(two.newEntryId);
  });

  it("is the entry's own id once there is one to edit", () => {
    const d = { ...blankDraft("expense", A, "EUR", MEMBERS), entryId: "e-dinner" };
    expect(splitSeed(d)).toBe("e-dinner");
  });

  it("prices the form's rows exactly as the saved entry is priced", () => {
    // 10.00 three ways: two get 3.33 and one gets 3.34. Which one is the whole
    // question — the form and the ledger have to answer it the same way.
    const d = blankDraft("expense", A, "EUR", MEMBERS);
    const onForm = resolveSplit(1000, activeSplit(d), { tiebreakSeed: splitSeed(d) });
    const asWritten = resolveSplit(1000, activeSplit(d), { tiebreakSeed: d.newEntryId });
    expect(onForm.shares).toEqual(asWritten.shares);
    expect(Object.values(onForm.shares).reduce((a, b) => a + b, 0)).toBe(1000);
  });
});

/**
 * A bill on the grid, and the same bill once Done has written it down.
 *
 * Every line here divides three ways with a cent left over, which is the only
 * thing that can differ between the two readings — and did: the grid seeded
 * its rows with the string `"new"` while the form and the save used the id the
 * entry would be written under, so a €76.50 bill showed one person €22.25 and
 * saved them €22.24. `receiptWeights` is now the one place that names a seed.
 */
describe("a scanned bill prices the same on both screens", () => {
  const BILL = [
    { label: "Tagine", labelEn: null, amount: "14.50", quantity: null },
    { label: "Couscous", labelEn: null, amount: "16.00", quantity: null },
    { label: "Mint tea", labelEn: null, amount: "6.50", quantity: null },
  ];
  const HAD = [[A, B, C], [A, B, C], [A, B, C]];

  const scanned = (over: Partial<EntryDraft> = {}) => expense({
    splitTab: "receipt",
    receiptItems: BILL,
    receiptAssignments: HAD,
    receiptInvolved: MEMBERS,
    receiptTip: "5.00",
    ...over,
  });

  it("reads the rows being edited exactly as it reads the rows saved", () => {
    const d = scanned();
    // The grid holds its rows in component state until Done; the form reads
    // them off the draft. Same bill, so the same figures, to the minor unit.
    const onTheGrid = receiptWeights(d, BILL, HAD.map((row) => new Set(row)), new Set(MEMBERS));
    expect(draftReceiptSplit(d)).toEqual({ mode: "receipt", weights: onTheGrid });
  });

  it("hands the leftover cents out by the entry's own id", () => {
    // Not a constant: two drafts of the same bill must be able to give the
    // spare cent to different people, or every bill in the app rounds in one
    // person's favour — and a screen that hardcodes a seed passes silently.
    const readings = new Set(["a", "b", "c", "d", "e", "f"].map((id) =>
      JSON.stringify(receiptWeights(
        scanned({ newEntryId: id }), BILL, HAD.map((row) => new Set(row)), new Set(MEMBERS),
      ))));
    expect(readings.size).toBeGreaterThan(1);
  });

  it("still hands out every minor unit of the bill", () => {
    const weights = receiptWeights(scanned(), BILL, HAD.map((row) => new Set(row)), new Set(MEMBERS));
    // 14.50 + 16.00 + 6.50 + 5.00 tip.
    expect(Object.values(weights).reduce((a, b) => a + b, 0)).toBe(4200);
  });
});

/**
 * The string that decides whether a screen keeps the draft in front of it or
 * throws it away and seeds a blank. `/g/scan` writes a scanned draft under the
 * key the form will look for, so the two have to agree exactly — and the way
 * they disagree is silent: the scan lands on an empty form.
 */
describe("newEntryKey", () => {
  it("is the same for a blank expense however it is asked for", () => {
    expect(newEntryKey("expense")).toBe(newEntryKey(null));
    expect(newEntryKey(undefined)).toBe(newEntryKey("expense", {}));
    expect(newEntryKey("expense", { from: undefined, amount: 0 })).toBe(newEntryKey("expense"));
  });

  it("separates entries a link asked for differently", () => {
    const keys = [
      newEntryKey("expense"),
      newEntryKey("income"),
      newEntryKey("transfer"),
      newEntryKey("transfer", { from: "a", to: "b", amount: 500 }),
      newEntryKey("transfer", { from: "a", to: "b", amount: 700 }),
      newEntryKey("transfer", { from: "b", to: "a", amount: 500 }),
    ];
    // Settle-up used to land on whatever blank expense an abandoned "+" had
    // left behind, which is this set collapsing.
    expect(new Set(keys).size).toBe(keys.length);
  });
});
