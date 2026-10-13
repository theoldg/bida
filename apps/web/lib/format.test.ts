import { describe, expect, it } from "vitest";
import { minorToDecimalString, parseMinor, validateSplit } from "@bida/core";
import {
  ago, bare, byWhen, sortedByWhen, figure, moneyParts, clockTime, countText, dayLabel, distinctInitials, graphemes, groupDigits,
  initials, plural, priced, rateText, splitProblemText, stamp, usd, whenLabel,
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

describe("splitProblemText", () => {
  it("never reports a zero total as a satisfied split", () => {
    // A blank amount split evenly: 0 === 0. It says nothing — the missing
    // amount is the amount field's to report, flashing on Save.
    const check = validateSplit(0, { mode: "equal", members: ["a", "b"] });
    expect(check.ok).toBe(true);
    expect(splitProblemText(check, "EUR")).toBeNull();
  });

  it("says nobody is included before it mentions the total", () => {
    const check = validateSplit(0, { mode: "equal", members: [] });
    expect(splitProblemText(check, "EUR")).toBe("Nobody is included yet");
  });

  it("says nothing of a split that adds up", () => {
    expect(splitProblemText(validateSplit(4500, { mode: "exact", amounts: { a: 2500, b: 2000 } }), "EUR")).toBeNull();
    expect(splitProblemText(validateSplit(6000, { mode: "exact", amounts: { a: 2400 }, rest: ["b"] }), "EUR")).toBeNull();
  });

  it("reports a shortfall and an excess against a real total", () => {
    const under = splitProblemText(validateSplit(4500, { mode: "exact", amounts: { a: 2500, b: 1000 } }), "EUR");
    expect(under).toContain("left to split");

    const over = splitProblemText(validateSplit(4500, { mode: "exact", amounts: { a: 4000, b: 1000 } }), "EUR");
    expect(over).toContain("too much");
  });

  it("says who the rest has nothing left for", () => {
    const names = (id: string) => ({ b: "Bo", c: "Cy" })[id] ?? id;
    const one = splitProblemText(validateSplit(6000, { mode: "exact", amounts: { a: 6000 }, rest: ["c"] }), "EUR", names);
    expect(one).toBe("Nothing left for Cy");
    const two = splitProblemText(validateSplit(6000, { mode: "exact", amounts: { a: 6000 }, rest: ["b", "c"] }), "EUR", names);
    expect(two).toBe("Nothing left for 2 people");

    const over = splitProblemText(validateSplit(6000, { mode: "exact", amounts: { a: 7000 }, rest: ["c"] }), "EUR", names);
    expect(over).toContain("too much");
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

describe("stamp", () => {
  const now = new Date(2026, 3, 4, 12, 0).getTime();

  it("says today and yesterday as the ledger's day rule does, a date before that", () => {
    const today = new Date(2026, 3, 4, 7, 35).getTime();
    const yesterday = new Date(2026, 3, 3, 23, 50).getTime();
    const earlier = new Date(2026, 3, 1, 9, 0).getTime();
    expect(stamp(today, now)).toBe(`TODAY · ${clockTime(today)}`);
    expect(stamp(yesterday, now)).toBe(`YESTERDAY · ${clockTime(yesterday)}`);
    expect(stamp(earlier, now)).toBe("WED 1 APR · 09:00");
  });
});

// Ours, whatever the phone's locale: one language beside "Yesterday".
describe("dates in English", () => {
  const now = new Date(2026, 3, 4, 12, 0).getTime();

  it("names a day this year by weekday, another year by year", () => {
    expect(dayLabel(new Date(2026, 3, 1, 9).getTime(), now)).toBe("Wed 1 April");
    expect(dayLabel(new Date(2025, 11, 31, 9).getTime(), now)).toBe("31 December 2025");
  });

  it("prints a 24-hour clock with two-digit hours", () => {
    expect(clockTime(new Date(2026, 3, 4, 7, 5).getTime())).toBe("07:05");
    expect(clockTime(new Date(2026, 3, 4, 0, 0).getTime())).toBe("00:00");
  });

  it("goes vague past a week: the month, and the year once it isn't this one", () => {
    expect(ago(new Date(2026, 1, 10).getTime(), now)).toBe("Feb");
    expect(ago(new Date(2025, 10, 10).getTime(), now)).toBe("Nov 2025");
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

  // Midnight is not a sentinel: an entry stamped at midnight sorts as the
  // earliest moment of its day.
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

  it("is the order sortedByWhen gives, ties kept as they came", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: String(i), occurredAt: day(1 + (i * 7) % 5, (i * 5) % 24), dateOnly: i % 3 === 0, createdAt: i % 4 ? day(9, i % 2) : undefined,
    }));
    expect(ids(sortedByWhen(rows))).toEqual(ids([...rows].sort(byWhen)));
  });
});

describe("moneyParts", () => {
  it("cuts the figure into code, whole part and fraction", () => {
    expect(moneyParts(15077927, "UZS", "en-US"))
      .toEqual({ currency: "UZS", whole: "150,779", fraction: ".27", currencyFirst: true });
  });

  it("keeps the code where the locale puts it, and its marks", () => {
    expect(moneyParts(15077927, "UZS", "pl-PL"))
      .toEqual({ currency: "UZS", whole: "150\u00a0779", fraction: ",27", currencyFirst: false });
  });

  it("has no fraction where the currency has none, and three where it has three", () => {
    expect(moneyParts(1200, "JPY", "en-US")).toMatchObject({ whole: "1,200", fraction: "" });
    expect(moneyParts(150279, "KWD", "en-US").fraction).toBe(".279");
  });

  it("carries a sign on the whole part", () => {
    expect(moneyParts(-10563, "EUR", "en-IE")).toMatchObject({ currency: "€", whole: "-105", fraction: ".63" });
  });

  it("loses nothing but spacing", () => {
    const strip = (s: string) => s.replace(/[\s\u00a0\u202f]/g, "");
    for (const locale of ["en-US", "pl-PL", "de-CH", "fr-FR"]) {
      const p = moneyParts(1248000000, "UZS", locale);
      const joined = p.currencyFirst ? p.currency + p.whole + p.fraction : p.whole + p.fraction + p.currency;
      expect(strip(joined)).toBe(strip(new Intl.NumberFormat(locale, {
        style: "currency", currency: "UZS", minimumFractionDigits: 2 }).format(12480000)));
    }
  });
});

describe("figure", () => {
  it("drops the sign, the symbol and the grouping, and keeps the decimal mark", () => {
    expect(figure(-123450, "EUR", "en-US")).toBe("1234.50");
    expect(figure(123450, "EUR", "en-US")).toBe("1234.50");
    expect(figure(123456789, "USD", "en-US")).toBe("1234567.89");
    expect(figure(-123450, "EUR", "fr-FR")).toBe("1234,50");
    expect(figure(-123450, "EUR", "de-CH")).toBe("1234.50");
  });

  it("follows the currency's own decimals, zero included", () => {
    expect(figure(-25000, "JPY", "en-US")).toBe("25000");
    expect(figure(1234567, "BHD", "en-US")).toBe("1234.567");
    expect(figure(0, "EUR", "en-US")).toBe("0.00");
    expect(figure(-5, "EUR", "en-US")).toBe("0.05");
  });

  it("reads back as the same amount, sign aside", () => {
    for (const [minor, currency, locale] of [
      [-123450, "EUR", "fr-FR"], [987654321, "USD", "en-US"], [-25000, "JPY", "de-DE"], [1234567, "BHD", "en-US"],
    ] as const) {
      expect(parseMinor(figure(minor, currency, locale), currency)).toBe(Math.abs(minor));
    }
  });
});

describe("plural", () => {
  const change = { one: "change", many: "changes" };
  const zmiana = { one: "zmiana", few: "zmiany", many: "zmian" };

  it("says English with one and many", () => {
    expect([0, 1, 2, 5, 22].map((n) => plural(n, change, "en")))
      .toEqual(["0 changes", "1 change", "2 changes", "5 changes", "22 changes"]);
  });

  it("says Polish with its three forms, by the last digits", () => {
    expect([0, 1, 2, 4, 5, 12, 14, 21, 22, 25, 102, 112].map((n) => plural(n, zmiana, "pl"))).toEqual([
      "0 zmian", "1 zmiana", "2 zmiany", "4 zmiany", "5 zmian", "12 zmian", "14 zmian",
      "21 zmian", "22 zmiany", "25 zmian", "102 zmiany", "112 zmian",
    ]);
  });

  it("falls back to many where a noun has no few", () => {
    expect(plural(3, change, "pl")).toBe("3 changes");
  });
});
