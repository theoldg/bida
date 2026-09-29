import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatMinor, type CurrencyCode } from "@bida/core";
import { forgetShown, keepShown, planRoll, rollTime, ROLL_GAP, ROLL_MS, shownBefore } from "./roll";

const joined = (r: NonNullable<ReturnType<typeof planRoll>>, side: "from" | "to") =>
  r.pre + r.glyphs.map((g) => g[side]).join("") + r.post;

describe("planRoll", () => {
  it("rolls nothing when nothing changed", () => {
    expect(planRoll(4218, 4218, "EUR", "en-US")).toBeNull();
  });

  it("moves only the digits that changed, numbered from the left", () => {
    const r = planRoll(4218, 4258, "EUR", "en-US")!;
    expect(r.pre).toBe("€");
    expect(r.glyphs).toEqual([
      { from: "4", to: "4", order: null },
      { from: "2", to: "2", order: null },
      { from: ".", to: ".", order: null },
      { from: "1", to: "5", order: 0 },
      { from: "8", to: "8", order: null },
    ]);
    expect(r.changed).toBe(1);
    expect(r.up).toBe(true);
  });

  it("rolls down for a smaller figure", () => {
    const r = planRoll(4218, 1818, "EUR", "en-US")!;
    expect(r.up).toBe(false);
    expect(r.glyphs.filter((g) => g.order !== null).map((g) => [g.from, g.to])).toEqual([["4", "1"], ["2", "8"]]);
  });

  it("opens a cell on the left for a figure gaining a digit, and a group mark with it", () => {
    const r = planRoll(98_765, 123_456, "EUR", "en-US")!;
    expect(r.glyphs.slice(0, 2)).toEqual([{ from: "", to: "1", order: 0 }, { from: "", to: ",", order: 1 }]);
    expect(joined(r, "from")).toBe("€987.65");
    expect(joined(r, "to")).toBe("€1,234.56");
  });

  it("closes cells for a figure losing digits", () => {
    const r = planRoll(123_456, 0, "EUR", "en-US")!;
    expect(joined(r, "to")).toBe("€0.00");
    expect(r.glyphs.filter((g) => g.to === "").length).toBe(4);
    expect(r.up).toBe(false);
  });

  it.each<[CurrencyCode, string, number, number]>([
    ["JPY", "en-US", 950, 12_000],
    ["KWD", "en-US", 1_234, 98_765],
    ["EUR", "de-DE", 4_218, 123_456],
    ["EUR", "fr-FR", 99, 100_000],
  ])("spells both figures exactly as money() does in %s, %s", (currency, locale, a, b) => {
    const r = planRoll(a, b, currency, locale)!;
    expect(joined(r, "from")).toBe(formatMinor(a, currency, { locale }));
    expect(joined(r, "to")).toBe(formatMinor(b, currency, { locale }));
    expect(joined(planRoll(b, a, currency, locale)!, "to")).toBe(formatMinor(a, currency, { locale }));
  });

  it("times the cascade from the first glyph moving to the last landing", () => {
    expect(rollTime(planRoll(4218, 4258, "EUR", "en-US")!)).toBe(ROLL_MS);
    expect(rollTime(planRoll(4218, 1818, "EUR", "en-US")!)).toBe(ROLL_MS + ROLL_GAP);
  });
});

describe("the last figure drawn", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is nothing for a group never drawn", () => {
    expect(shownBefore("g1", "EUR")).toBeNull();
  });

  it("keeps each group's own, signed", () => {
    keepShown("g1", -4218, "EUR");
    keepShown("g2", 900, "EUR");
    expect(shownBefore("g1", "EUR")).toBe(-4218);
    expect(shownBefore("g2", "EUR")).toBe(900);
  });

  it("is nothing once the group's currency changed", () => {
    keepShown("g1", -4218, "EUR");
    expect(shownBefore("g1", "USD")).toBeNull();
  });

  it("goes with the group", () => {
    keepShown("g1", -4218, "EUR");
    forgetShown("g1");
    expect(shownBefore("g1", "EUR")).toBeNull();
  });

  it("survives a store it can't read", () => {
    localStorage.setItem("bida.shown", "{not json");
    expect(shownBefore("g1", "EUR")).toBeNull();
    keepShown("g1", 5, "EUR");
    expect(shownBefore("g1", "EUR")).toBe(5);
  });
});
