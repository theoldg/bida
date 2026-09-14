import { describe, expect, it } from "vitest";
import { minorToDecimalString, parseMinor, validateSplit } from "@bida/core";
import {
  bare, countText, distinctInitials, graphemes, groupDigits, initials, rateText, splitFooter, usd,
} from "./format";

describe("groupDigits", () => {
  it("groups the whole part and leaves the fraction alone", () => {
    expect(groupDigits("4800")).toBe("4\u202f800");
    expect(groupDigits("1234567.89")).toBe("1\u202f234\u202f567.89");
    expect(groupDigits("999")).toBe("999");
    expect(groupDigits("12.")).toBe("12.");
    expect(groupDigits("")).toBe("");
  });

  it("never touches the fraction, however long a rate makes it", () => {
    expect(groupDigits("0.0000555556")).toBe("0.0000555556");
  });
});

describe("rateText", () => {
  it("groups a rate the way the field you typed it into groups it", () => {
    expect(rateText("13000")).toBe("13\u202f000");
    expect(rateText("4.5")).toBe("4.5");
  });

  it("rounds to the asked-for digits first, then groups", () => {
    expect(rateText("13000.123456789", 6)).toBe("13\u202f000.1");
  });
});

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
describe("usd", () => {
  it("writes a plain dollar sign whatever the reader's locale is", () => {
    // The tip screen sets `$5` in copy and the share right under it; in a
    // non-US locale the Intl default would be "US$1.25" and the pair would
    // read as two different currencies.
    expect(usd(125)).toBe("$1.25");
    expect(usd(500)).toBe("$5.00");
  });
});

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

// The who-had-what grid's column headings. They set the column width, so the
// adversarial case — long names sharing a long prefix — must not be allowed to
// widen them: three graphemes, whatever the names.
describe("distinctInitials", () => {
  const codes = (names: string[]) => {
    const out = distinctInitials(names.map((name, i) => ({ id: String(i), name })));
    return names.map((_, i) => out.get(String(i))!);
  };

  it("grows a prefix only as far as it has to", () => {
    expect(codes(["Alice", "Bob"])).toEqual(["A", "B"]);
    expect(codes(["John", "Jane"])).toEqual(["Jo", "Ja"]);
    expect(codes(["Ana", "Anouk", "Bea"])).toEqual(["Ana", "Ano", "B"]);
  });

  it("numbers whoever still collides at three, rather than growing", () => {
    expect(codes(["Bartholomew", "Bartholomew Junior"])).toEqual(["Ba1", "Ba2"]);
  });

  it("caps every code at three graphemes, however adversarial the names", () => {
    const names = [
      "Bartholomew", "Bartholomew Junior", "Bartholomew Senior",
      "Bart", "Bartholomea", "Ba", "Bar",
    ];
    for (const code of codes(names)) expect(graphemes(code).length).toBeLessThanOrEqual(3);
  });

  it("still tells everybody apart once it has started numbering", () => {
    const names = ["Bartholomew", "Bartholomew Junior", "Barnaby", "Barnabas", "Bax", "Zoe"];
    const out = codes(names);
    expect(new Set(out).size).toBe(names.length);
  });

  // Ten or more in one collision needs two digits, and the prefix gives up the
  // grapheme rather than the code growing a fourth.
  it("keeps the cap when the numbers reach two digits", () => {
    const names = Array.from({ length: 12 }, (_, i) => `Bartholomew ${"x".repeat(i + 1)}`);
    const out = codes(names);
    expect(new Set(out).size).toBe(names.length);
    for (const code of out) expect(graphemes(code).length).toBeLessThanOrEqual(3);
    expect(out[0]).toBe("Ba1");
    expect(out[9]).toBe("B10");
  });

  // A digit in a name is indistinguishable from the numbering, so the whole
  // group drops back to bare prefixes and the codes may repeat.
  it("gives up on unique codes when a name holds a digit", () => {
    expect(codes(["Bar1", "Bartholomew", "Bartholomew Junior"]))
      .toEqual(["Bar", "Bar", "Bar"]);
  });

  it("does not number a group that has no collision left at three", () => {
    expect(codes(["ba12", "Zoe"])).toEqual(["b", "Z"]);
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
