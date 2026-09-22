import { describe, expect, it } from "vitest";
import { minorToDecimalString, parseMinor, validateSplit } from "@bida/core";
import {
  bare, byWhen, clockTime, countText, dayLabel, distinctInitials, graphemes, groupDigits,
  initials, priced, rateText, splitFooter, usd, whenLabel,
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

describe("priced", () => {
  it("writes a line's figure the way the column around it is written", () => {
    // The typed door's ordinary answer: a bill saying "cola 10" gives the
    // model "10", while the line beside it — three at 13 — is multiplied out
    // to "39.00" by `lineMinor`. Printed as they arrive, one column holds
    // both (found driving `pnpm drive` against the `skewers` fixture).
    expect(priced("10", "EUR")).toBe("10.00");
    expect(priced("39.00", "EUR")).toBe("39.00");
    expect(priced("1234.5", "EUR")).toBe("1,234.50");
    expect(priced("1 234,50", "EUR")).toBe("1,234.50");
    expect(priced("500", "JPY")).toBe("500");
    expect(priced("5.5", "TND")).toBe("5.500");
    // Finer than the currency goes is not a refusal here: `lineMinor` parses
    // the same string and rounds it the same way, so the figure shown is the
    // one the line actually contributes.
    expect(priced("1.005", "EUR")).toBe("1.01");
  });

  it("hands back what arrived when what arrived is not a figure", () => {
    // `readBill` keeps the model's own string so `checkScan` can refuse it
    // and the grid can show what came back — so the refusal has to survive
    // the formatting, not be swallowed by it.
    expect(priced("", "EUR")).toBe("");
    expect(priced("??", "EUR")).toBe("??");
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

  it("starts the numbers again at 1 for each prefix, not once for the group", () => {
    expect(codes(["Martin", "Marta", "Julia", "Julian"]))
      .toEqual(["Ma1", "Ma2", "Ju1", "Ju2"]);
  });

  // The number tells apart the people who *print* the same two graphemes, so
  // "Mar" and "Mat" are one run of four — restarting inside each would hand
  // out "Ma1" twice.
  it("numbers everyone sharing the printed prefix as one run", () => {
    expect(codes(["Martin", "Marta", "Matteo", "Matilda"]))
      .toEqual(["Ma1", "Ma2", "Ma3", "Ma4"]);
  });

  // Two digits eat a grapheme of the prefix, so two runs that share their
  // first one would both reach "B10". The restart is what gives way.
  it("falls back to one run of numbers when restarting would collide", () => {
    const names = [
      ...Array.from({ length: 10 }, (_, i) => `Bartholomew ${"x".repeat(i + 1)}`),
      ...Array.from({ length: 10 }, (_, i) => `Bonifacio ${"x".repeat(i + 1)}`),
    ];
    const out = codes(names);
    expect(new Set(out).size).toBe(names.length);
    for (const code of out) expect(graphemes(code).length).toBeLessThanOrEqual(3);
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

describe("whenLabel", () => {
  const now = new Date(2026, 3, 4, 12, 0).getTime();

  it("prints the time when the entry has one", () => {
    const at = new Date(2026, 3, 4, 18, 22).getTime();
    expect(whenLabel({ occurredAt: at }, now)).toBe(`${dayLabel(at, now)} \u00b7 ${clockTime(at)}`);
  });

  // The bug this exists for: a backdated receipt claiming it was paid at 00:00.
  it("prints the day alone for an entry whose stamp is a day", () => {
    const at = new Date(2026, 3, 2).getTime();
    expect(whenLabel({ occurredAt: at, dateOnly: true }, now)).toBe(dayLabel(at, now));
    expect(whenLabel({ occurredAt: at, dateOnly: true }, now)).not.toContain("\u00b7");
  });

  // Midnight is a time like any other; the entry says whether it means one.
  it("prints midnight for an entry that was actually stamped at midnight", () => {
    const at = new Date(2026, 3, 4).getTime();
    expect(whenLabel({ occurredAt: at }, now)).toContain(clockTime(at));
  });
});

describe("byWhen", () => {
  const day = (d: number, h = 0, min = 0) => new Date(2026, 3, d, h, min).getTime();
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it("puts the newest day first", () => {
    const rows = [
      { id: "old", occurredAt: day(2, 9) },
      { id: "new", occurredAt: day(4, 9) },
    ];
    expect(ids([...rows].sort(byWhen))).toEqual(["new", "old"]);
  });

  it("heads a day with the entries that have no time, latest-added first", () => {
    const rows = [
      { id: "evening", occurredAt: day(4, 21), createdAt: day(4, 21) },
      { id: "receipt-a", occurredAt: day(4), dateOnly: true, createdAt: day(5, 10) },
      { id: "morning", occurredAt: day(4, 8), createdAt: day(4, 8) },
      { id: "receipt-b", occurredAt: day(4), dateOnly: true, createdAt: day(5, 11) },
    ];
    expect(ids([...rows].sort(byWhen)))
      .toEqual(["receipt-b", "receipt-a", "evening", "morning"]);
  });

  it("keeps a timeless entry inside its own day", () => {
    const rows = [
      { id: "next-day", occurredAt: day(5, 1) },
      { id: "timeless", occurredAt: day(4), dateOnly: true },
      { id: "prev-day", occurredAt: day(3, 23) },
    ];
    expect(ids([...rows].sort(byWhen))).toEqual(["next-day", "timeless", "prev-day"]);
  });

  // The old sentinel's one bad case, now simply not a case: an entry stamped
  // at midnight that means it sorts as the earliest moment of its day.
  it("sorts a real midnight entry as the earliest of its day", () => {
    const rows = [
      { id: "midnight", occurredAt: day(4), createdAt: day(4) },
      { id: "noon", occurredAt: day(4, 12), createdAt: day(4, 12) },
      { id: "timeless", occurredAt: day(4), dateOnly: true, createdAt: day(4) },
    ];
    expect(ids([...rows].sort(byWhen))).toEqual(["timeless", "noon", "midnight"]);
  });

  it("falls back to occurredAt when createdAt was never written", () => {
    const rows = [
      { id: "a", occurredAt: day(4, 9) },
      { id: "b", occurredAt: day(4, 9), createdAt: day(4, 10) },
    ];
    expect(ids([...rows].sort(byWhen))).toEqual(["b", "a"]);
  });
});
