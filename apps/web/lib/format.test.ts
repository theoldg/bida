import { describe, expect, it } from "vitest";
import { minorToDecimalString, parseMinor, validateSplit } from "@hajsik/core";
import { bare, countText, distinctInitials, initials, splitFooter } from "./format";

describe("splitFooter", () => {
  it("never reports a zero total as a satisfied split", () => {
    // The owner's recurring report, reproduced: an expense whose amount is
    // still blank, split "as amounts" with everyone on zero. validateSplit is
    // arithmetically right that 0 === 0, but "€0.00 of €0.00 allocated" would
    // claim the split is settled when there is nothing to settle. It says
    // nothing at all instead — the missing amount is the amount field's to
    // report, and it flashes red on a refused Save.
    const check = validateSplit(0, { mode: "exact", amounts: { a: 0, b: 0 } });
    expect(check.ok).toBe(true);
    expect(splitFooter(check, "EUR")).toBeNull();
  });

  it("says nobody is included before it mentions the total", () => {
    const check = validateSplit(0, { mode: "equal", members: [] });
    expect(splitFooter(check, "EUR")).toEqual({ ok: false, text: "Nobody is included yet" });
  });

  it("reports a real allocation once there is a total", () => {
    const check = validateSplit(4500, { mode: "exact", amounts: { a: 2500, b: 2000 } });
    const foot = splitFooter(check, "EUR");
    expect(foot).toMatchObject({ ok: true });
    expect(foot?.text).toContain("allocated");
  });

  it("reports a shortfall and an excess against a real total", () => {
    const under = splitFooter(validateSplit(4500, { mode: "exact", amounts: { a: 2500, b: 1000 } }), "EUR");
    expect(under).toMatchObject({ ok: false });
    expect(under?.text).toContain("left to split");

    const over = splitFooter(validateSplit(4500, { mode: "exact", amounts: { a: 4000, b: 1000 } }), "EUR");
    expect(over).toMatchObject({ ok: false });
    expect(over?.text).toContain("too much");
  });
});

describe("bare", () => {
  it("is display text, not something parseMinor can read back", () => {
    // Guards the doc comment: bare() groups thousands, so writing it into a
    // draft's `amountText` loses the amount outright (EUR) or silently
    // divides it by a thousand (JPY). Both were live bugs on the expense
    // form. Canonical text is minorToDecimalString's job.
    expect(bare(123450, "EUR")).toBe("1,234.50");
    expect(() => parseMinor(bare(123450, "EUR"), "EUR")).toThrow();
    expect(parseMinor(bare(25000, "JPY"), "JPY")).toBe(25);

    expect(parseMinor(minorToDecimalString(123450, "EUR"), "EUR")).toBe(123450);
    expect(parseMinor(minorToDecimalString(25000, "JPY"), "JPY")).toBe(25000);
  });
});

// An avatar is a name's first character, and a name can start with one the
// browser stores as two code units. Half a surrogate pair renders as "�".
describe("initials", () => {
  it("keeps an emoji whole", () => {
    expect(initials("🐙 Kraken")).toBe("🐙K");
    expect(initials("🐙")).toBe("🐙");
  });

  it("still does what it did for letters", () => {
    expect(initials("ada lovelace")).toBe("AL");
    expect(initials("Prince")).toBe("P");
  });

  it("tells emoji names apart without splitting one", () => {
    const out = distinctInitials([
      { id: "a", name: "🐙🐙" },
      { id: "b", name: "🐙🦑" },
    ]);
    expect(out.get("a")).toBe("🐙🐙");
    expect(out.get("b")).toBe("🐙🦑");
  });
});

describe("countText", () => {
  it("says nothing about the ordinary case", () => {
    expect(countText({ n: 1, d: 1 })).toBe(null);
  });

  it("counts whole ones", () => {
    expect(countText({ n: 2, d: 1 })).toBe("2");
    expect(countText({ n: 6, d: 3 })).toBe("2");
  });

  it("writes a share of one in lowest terms", () => {
    expect(countText({ n: 1, d: 2 })).toBe("1/2");
    expect(countText({ n: 2, d: 6 })).toBe("1/3");
    expect(countText({ n: 3, d: 4 })).toBe("3/4");
  });

  it("puts the whole ones in front of the rest", () => {
    expect(countText({ n: 3, d: 2 })).toBe("1 1/2");
    expect(countText({ n: 7, d: 3 })).toBe("2 1/3");
  });

  it("has nothing to say about nothing", () => {
    expect(countText({ n: 0, d: 3 })).toBe(null);
  });
});
