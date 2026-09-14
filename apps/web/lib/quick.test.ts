import { describe, expect, it } from "vitest";
import { memberIdFor } from "@bida/core";
import { blankDraft, type EntryDraft } from "./draft";
import { quickShares, quickSummaryText, type QuickPerson } from "./quick";

/**
 * A quick split's arithmetic is the receipt grid's, read as money rather than
 * as weights — which is only sound because nothing here converts (ADR-0035).
 * So what has to hold is that the figures shown to four people at a table add
 * up to the bill they are looking at, discounts, tax and tip included.
 */

const CRED = "cred-1";
const person = (name: string): QuickPerson => ({ id: memberIdFor(CRED, name), name });
const ANA = person("Ana"), BO = person("Bo"), CY = person("Cy");
const PEOPLE = [ANA, BO, CY];

function bill(over: Partial<EntryDraft> = {}): EntryDraft {
  return {
    ...blankDraft("expense", "", "EUR", PEOPLE.map((p) => p.id)),
    description: "Bar Zahra",
    receiptItems: [
      { label: "Tagine", amount: "18.00", quantity: null },
      { label: "Couscous", amount: "14.50", quantity: null },
      { label: "Mint tea", amount: "6.30", quantity: null },
    ],
    receiptInvolved: PEOPLE.map((p) => p.id),
    // Ana had the tagine, Bo the couscous, and the tea was shared by all three.
    receiptAssignments: [[ANA.id], [BO.id], PEOPLE.map((p) => p.id)],
    ...over,
  };
}

const sum = (shares: { minor: number }[]) => shares.reduce((t, s) => t + s.minor, 0);

describe("what each person owes", () => {
  it("adds up to the bill", () => {
    const { totalMinor, shares } = quickShares(bill(), PEOPLE);
    expect(totalMinor).toBe(3880);
    expect(sum(shares)).toBe(totalMinor);
  });

  it("still adds up with a tip, a tax and a discount on it", () => {
    // Every awkward one at once: an odd tip to divide three ways, tax on top,
    // and a deduction that comes off — each spread in proportion to what was
    // ordered, none of them tickable (ADR-0016).
    const { totalMinor, shares } = quickShares(bill({
      receiptTip: "5.55",
      receiptTax: "1.11",
      receiptDiscounts: [{ label: "2 for 1", amount: "3.33" }],
    }), PEOPLE);
    expect(totalMinor).toBe(3880 + 555 + 111 - 333);
    expect(sum(shares)).toBe(totalMinor);
  });

  it("keeps somebody who was there and ordered nothing, at zero", () => {
    const { shares } = quickShares(bill({
      receiptAssignments: [[ANA.id], [BO.id], [ANA.id, BO.id]],
    }), PEOPLE);
    expect(shares.map((s) => s.name)).toEqual(["Ana", "Bo", "Cy"]);
    expect(shares.find((s) => s.name === "Cy")?.minor).toBe(0);
  });

  it("leaves out somebody who wasn't at the table", () => {
    const { shares } = quickShares(bill({
      receiptInvolved: [ANA.id, BO.id],
      receiptAssignments: [[ANA.id], [BO.id], [ANA.id, BO.id]],
    }), PEOPLE);
    expect(shares.map((s) => s.name)).toEqual(["Ana", "Bo"]);
  });
});

describe("the text it hands over", () => {
  it("is the merchant, the total, and everybody's own lines", () => {
    const draft = bill();
    const { totalMinor, shares } = quickShares(draft, PEOPLE);
    expect(quickSummaryText(draft.description, totalMinor, shares, draft.currency)).toBe(
      [
        "Bar Zahra: 38.80",
        "",
        "Ana: 20.10",
        "  Tagine: 18.00",
        "  Mint tea ×1/3: 2.10",
        "Bo: 16.60",
        "  Couscous: 14.50",
        "  Mint tea ×1/3: 2.10",
        "Cy: 2.10",
        "  Mint tea ×1/3: 2.10",
      ].join("\n"),
    );
  });

  it("says Total where the scan read no name", () => {
    const draft = bill({ description: "" });
    const { totalMinor, shares } = quickShares(draft, PEOPLE);
    expect(quickSummaryText("", totalMinor, shares, draft.currency).split("\n")[0])
      .toBe("Total: 38.80");
  });

  it("names a deduction the way the bill printed it", () => {
    const draft = bill({ receiptDiscounts: [{ label: "2 for 1", amount: "3.00" }] });
    const { totalMinor, shares } = quickShares(draft, PEOPLE);
    const text = quickSummaryText(draft.description, totalMinor, shares, draft.currency);
    expect(text).toContain("2 for 1: -");
  });
});
