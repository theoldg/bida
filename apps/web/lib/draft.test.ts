import { describe, expect, it } from "vitest";
import { splitParticipants, type SplitSpec } from "@hajsik/core";
import {
  activeSplit, activeSplitTab, blankDraft, legacyPercent, openSplitTab, withSplit,
  type EntryDraft, type SplitTab,
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

  it("hands its own answer on to an arithmetic tab opened after it", () => {
    // Ana had the €60 steak, Bo the €30 coffee. Leaving Receipt for a tab
    // nothing has been typed into starts it from that, not from Evenly.
    const d = expense({
      receiptItems: items,
      splitTab: "receipt",
      receiptInvolved: [A, B],
      receiptAssignments: [[A], [B]],
    });
    expect(activeSplit(d)).toEqual({ mode: "shares", weights: { [A]: 6000, [B]: 3000 } });
    expect(open(d, "exact").splits.exact).toEqual({ mode: "exact", amounts: { [A]: 6000, [B]: 3000 } });
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
});
