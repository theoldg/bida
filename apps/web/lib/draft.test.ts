import { describe, expect, it, vi } from "vitest";
import { withDate } from "./format";
import {
  exactFigures, resolveSplit, splitParticipants, startOfLocalDay, type Expense, type Settlement, type SplitSpec,
} from "@bida/core";
import {
  activeSplit, arithmeticSplit, blankDraft, changeSplitTab, draftReceiptSplit, expenseDraft, newEntryKey,
  openSplitTab, receiptBill, retimed, splitSeed, tabAfterScan, transferDraft, withSplit,
  type EntryDraft, type SplitTab,
} from "./draft";

/**
 * Four tabs, four answers. Opening a tab is a handoff made **once**; from then
 * on each tab keeps what was typed into it, whatever the others say — so
 * leaving someone out under Evenly can't erase their parts, and a scan can't
 * overwrite all three.
 */

const A = "m-ana", B = "m-bo", C = "m-cy";
const MEMBERS = [A, B, C];

function expense(over: Partial<EntryDraft> = {}): EntryDraft {
  return { ...blankDraft("expense", A, "EUR", MEMBERS), amountText: "90.00", ...over };
}

/** Open a tab the way the form does: the inputs it gets, and the tab it is on. */
function open(draft: EntryDraft, tab: SplitTab): EntryDraft {
  return { ...draft, splitTab: tab, splits: openSplitTab(draft, tab) };
}

describe("the arithmetic tabs are independent", () => {
  // Evenly is everyone sharing the rest of nothing typed, so typing one
  // figure re-divides the others rather than over-filling the column.
  it("hands a first-time tab what is on screen, so even-then-nudge still works", () => {
    const d = open(expense(), "exact");
    expect(d.splits.exact).toEqual({ mode: "exact", amounts: {}, rest: [A, B, C] });
    expect(resolveSplit(9000, activeSplit(d)).shares).toEqual({ [A]: 3000, [B]: 3000, [C]: 3000 });
  });

  // Nobody is handed a zero figure: opened before the amount is typed, everyone
  // shares the rest, and the shares arrive with the amount.
  it("hands a first-time As amounts everyone sharing while the total is still zero", () => {
    const d = open(expense({ amountText: "" }), "exact");
    expect(d.splits.exact).toEqual({ mode: "exact", amounts: {}, rest: [A, B, C] });
    expect(splitParticipants(activeSplit(d))).toEqual([A, B, C]);
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

  // Parts are not amounts: whoever held one arrives in, sharing the rest.
  it("hands As amounts who was in As parts, and none of the parts", () => {
    let d = open(expense(), "shares");
    d = { ...d, splits: withSplit(d.splits, { mode: "shares", weights: { [A]: 2, [B]: 1 } }) };
    d = open(d, "exact");
    expect(d.splits.exact).toEqual({ mode: "exact", amounts: {}, rest: [A, B] });
    expect(resolveSplit(9000, activeSplit(d)).shares).toEqual({ [A]: 4500, [B]: 4500 });
  });

  it("starts As amounts in the entry's own currency, not the base", () => {
    // 90.00 MAD: the fields are dirham.
    const d = open(expense({ currency: "MAD" }), "exact");
    expect(resolveSplit(9000, activeSplit(d)).shares).toEqual({ [A]: 3000, [B]: 3000, [C]: 3000 });
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
        // Same currency, so the typed amount is the base total As amounts divides.
        const d = open(expense({ amountText: (total / 100).toFixed(2) }), first);
        const spec = activeSplit(d);
        const allocated = spec.mode === "exact"
          ? Object.values(resolveSplit(total, spec).shares).reduce((a, b) => a + b, 0) : total;
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
    expect(openSplitTab(d, "receipt")).toBe(d.splits);
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
    expect(open(d, "exact").splits.exact).toEqual({ mode: "exact", amounts: {}, rest: [A, B, C] });
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

  it("reopens a saved bill on Items, with Evenly's split underneath", () => {
    const d = expenseDraft({
      id: "e1", groupId: "g", description: "Dinner", occurredAt: 1000, amountMinor: 9000, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 9000, paidBy: A,
      split: { mode: "receipt", weights: { [A]: 6000, [B]: 3000 } },
      receiptItems: items, receiptInvolved: [A, B], receiptAssignments: [[A], [B]],
    }, A, MEMBERS);
    expect(d.splitTab).toBe("receipt");
    expect(activeSplit(d)).toEqual({ mode: "receipt", weights: { [A]: 6000, [B]: 3000 } });
    expect(arithmeticSplit(d)).toEqual({ mode: "equal", members: MEMBERS });
  });
});

describe("changeSplitTab", () => {
  const items = [{ label: "Steak", amount: "60.00" }, { label: "Coffee", amount: "30.00" }];

  // Items derives the amount; leaving it must not leave an expense worth zero.
  it("hands the bill's total to the amount field leaving Items", () => {
    const d = expense({ amountText: "", receiptItems: items, splitTab: "receipt" });
    expect(changeSplitTab(d, "shares")).toMatchObject({ splitTab: "shares", amountText: "90.00" });
  });

  it("keeps the typed amount everywhere else", () => {
    const d = expense({ amountText: "12.00" });
    expect(changeSplitTab(d, "exact").amountText).toBe("12.00");
    expect(changeSplitTab({ ...d, splitTab: "receipt" }, "equal").amountText).toBe("12.00");
    expect(changeSplitTab(d, "receipt").amountText).toBe("12.00");
  });

  it("opens the tab it moves to, and only that one", () => {
    const next = changeSplitTab(expense(), "exact");
    expect(next.splits).toEqual({
      equal: { mode: "equal", members: MEMBERS },
      exact: { mode: "exact", amounts: {}, rest: MEMBERS },
    });
  });
});

describe("a blank draft", () => {
  it("opens on Evenly with everybody in it", () => {
    const d = blankDraft("expense", A, "EUR", MEMBERS);
    expect(d.splitTab).toBe("equal");
    expect(activeSplit(d)).toEqual({ mode: "equal", members: MEMBERS });
  });

  it("never defaults a transfer's note — only settle up's prefill does that", () => {
    const d = blankDraft("transfer", A, "EUR", MEMBERS);
    expect(d.description).toBe("");
  });

  // Every typed entry starts with a time of day; only a backdated scan says
  // otherwise. Midnight is an ordinary moment, not a sentinel.
  it("starts with a time of day, midnight included", () => {
    const midnight = new Date(2026, 3, 4).getTime();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(midnight);
      const d = blankDraft("expense", A, "EUR", MEMBERS);
      expect(d.occurredAt).toBe(midnight);
      expect(d.dateOnly).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a draft that edits a saved entry", () => {
  const saved: Expense = {
    id: "e1", groupId: "g", description: "Dinner", occurredAt: 1000, createdAt: 900,
    amountMinor: 123450, currency: "EUR", rateToBase: "1", baseAmountMinor: 123450, paidBy: B,
    split: { mode: "exact", amounts: { [A]: 23450, [B]: 100000 } },
  };

  it("reads the amount back as text parseMinor takes, never grouped", () => {
    expect(expenseDraft(saved, A, MEMBERS).amountText).toBe("1234.50");
  });

  it("opens on the entry's own tab, holding its split", () => {
    const d = expenseDraft(saved, A, MEMBERS);
    expect(d.splitTab).toBe("exact");
    expect(activeSplit(d)).toEqual(saved.split);
    expect(d.recordedAt).toBe(900);
  });

  // Saved with its rest's figures filled in (`settleRest`); reopened, the rest
  // still float and only the typed figure reads as typed.
  it("reopens As amounts knowing who shared the rest", () => {
    const split = { mode: "exact" as const, amounts: { [A]: 23450, [B]: 50000, [C]: 50000 }, rest: [B, C] };
    const d = expenseDraft({ ...saved, split }, A, MEMBERS);
    expect(d.splits.exact).toEqual(split);
    expect(exactFigures(123450, split)).toEqual({ [A]: 23450, [B]: 50000, [C]: 50000 });
    expect(exactFigures(150000, split)).toEqual({ [A]: 23450, [B]: 63275, [C]: 63275 });
  });

  it("leaves a receipt's weights off the arithmetic tabs and keeps the bill", () => {
    const items = [{ label: "Soup", amount: "4.00" }];
    const d = expenseDraft(
      { ...saved, split: { mode: "receipt", weights: { [A]: 1 } }, receiptItems: items }, A, MEMBERS,
    );
    expect(d.splitTab).toBe("receipt");
    expect(d.splits).toEqual({ equal: { mode: "equal", members: MEMBERS } });
    expect(d.receiptItems).toEqual(items);
  });

  it("gives a transfer its own two sides and its note", () => {
    const s: Settlement = {
      id: "s1", groupId: "g", fromMember: C, toMember: B, amountMinor: 500, currency: "EUR",
      rateToBase: "1", baseAmountMinor: 500, occurredAt: 1000, note: "Taxi",
    };
    const d = transferDraft(s, A, MEMBERS);
    expect(d).toMatchObject({ kind: "transfer", entryId: "s1", fromMember: C, toMember: B, description: "Taxi" });
  });
});

/**
 * An entry's clock is the one read when it was recorded — the form has a date
 * and no time — so the day it is moved to decides whether that reading still
 * means anything. A backdated receipt is one instance of this, not a rule of
 * its own.
 */
describe("choosing a day", () => {
  const started = new Date(2026, 3, 4, 8, 39, 12, 345).getTime();
  const draft = (over: Partial<EntryDraft> = {}): EntryDraft =>
    ({ ...blankDraft("expense", A, "EUR", MEMBERS, started), ...over });

  it("drops the time when the day is not the one it was recorded on", () => {
    const moved = retimed(draft(), withDate(started, "2026-04-02"));
    expect(moved.dateOnly).toBe(true);
    expect(startOfLocalDay(moved.occurredAt)).toBe(new Date(2026, 3, 2).getTime());
  });

  it("gives the reading back when the day comes back", () => {
    const moved = retimed(draft(), withDate(started, "2026-04-02"));
    const back = retimed(draft(moved), withDate(moved.occurredAt, "2026-04-04"));
    expect(back).toEqual({ occurredAt: started, dateOnly: false });
  });

  // A backdated receipt corrected to today must not show the 00:00 its stamp
  // was parked at: the scan's own reading is the time it has.
  it("stamps a corrected backdated receipt with the reading, not its midnight", () => {
    const receipt = draft({ occurredAt: new Date(2026, 3, 2).getTime(), dateOnly: true });
    expect(retimed(receipt, withDate(receipt.occurredAt, "2026-04-04")))
      .toEqual({ occurredAt: started, dateOnly: false });
  });

  // Re-picking the day an entry is already on is not an edit, and must not
  // move the stamp by the seconds between opening the form and saving it.
  it("leaves a stamp alone when the day it is on is picked again", () => {
    const d = draft({ occurredAt: new Date(2026, 3, 4, 20, 15).getTime() });
    expect(retimed(d, withDate(d.occurredAt, "2026-04-04")))
      .toEqual({ occurredAt: d.occurredAt, dateOnly: false });
  });
});

/**
 * The cent the form quotes is the cent the ledger keeps. `resolveSplit` hands
 * the leftover minor unit out by `tiebreakSeed`, which is the entry's id — so
 * the draft allocates the id it will be written under, and every screen
 * prices under `splitSeed`.
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
 * A bill on the grid, and the same bill once Done has written it down. Every
 * line divides three ways with a cent left over, the one thing that could
 * differ if the grid and the save seeded differently (€22.25 shown, €22.24
 * saved). `receiptBill` is the one place that names a seed.
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
    const onTheGrid = receiptBill(d, BILL, HAD.map((row) => new Set(row)), new Set(MEMBERS)).weights;
    expect(draftReceiptSplit(d)).toEqual({ mode: "receipt", weights: onTheGrid });
  });

  it("hands the leftover cents out by the entry's own id", () => {
    // Not a constant: two drafts of the same bill must be able to give the
    // spare cent to different people, or every bill in the app rounds in one
    // person's favour — and a screen that hardcodes a seed passes silently.
    const readings = new Set(["a", "b", "c", "d", "e", "f"].map((id) =>
      JSON.stringify(receiptBill(
        scanned({ newEntryId: id }), BILL, HAD.map((row) => new Set(row)), new Set(MEMBERS),
      ).weights)));
    expect(readings.size).toBeGreaterThan(1);
  });

  it("still hands out every minor unit of the bill", () => {
    const weights = receiptBill(scanned(), BILL, HAD.map((row) => new Set(row)), new Set(MEMBERS)).weights;
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
    expect(newEntryKey("expense", { title: undefined })).toBe(newEntryKey("expense"));
  });

  it("separates entries a link asked for differently", () => {
    const keys = [
      newEntryKey("expense"),
      newEntryKey("income"),
      newEntryKey("transfer"),
      // The tip screen's named expense: a "+" left half-filled must not be
      // what the donation link lands on.
      newEntryKey("expense", { title: "Coffee for bida" }),
      newEntryKey("expense", { title: "Something else" }),
    ];
    // A blank-expense key collision would land the tip screen on an abandoned
    // "+" draft.
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * A scan is a round trip to a model, and the tab bar stays live while it runs.
 * What is checked here is that the answer landing does not overrule a person
 * who has since decided this expense splits some other way.
 */
describe("where a scan leaves the split editor", () => {
  it("claims Items when the tab hasn't moved since the scan started", () => {
    expect(tabAfterScan(expense({ splitTab: "receipt" }), "receipt", true)).toBe("receipt");
  });

  it("claims Items for /g/scan, which seeds a draft and never touches its tab", () => {
    expect(tabAfterScan(expense({ splitTab: "equal" }), "equal", true)).toBe("receipt");
  });

  it("leaves the tab alone when somebody moved off it while the model read", () => {
    expect(tabAfterScan(expense({ splitTab: "equal" }), "receipt", true)).toBeUndefined();
  });

  it("claims it again once they come back to Items before the answer lands", () => {
    const left = expense({ splitTab: "equal" });
    expect(tabAfterScan(left, "receipt", true)).toBeUndefined();
    expect(tabAfterScan({ ...left, splitTab: "receipt" }, "receipt", true)).toBe("receipt");
  });

  it("claims nothing off a bill with no lines — that is an ordinary expense", () => {
    expect(tabAfterScan(expense({ splitTab: "equal" }), "equal", false)).toBeUndefined();
  });
});
