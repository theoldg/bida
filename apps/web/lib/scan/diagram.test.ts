import { describe, expect, it } from "vitest";
import { minorToDecimalString, parseMinor, sumMinor } from "@bida/core";
import { copy } from "../copy";
import { drawnNames, drawnShares } from "./diagram";

const total = (amounts: string[]) =>
  minorToDecimalString(sumMinor(amounts.map((a) => parseMinor(a, "EUR"))), "EUR");

/**
 * Nothing in the app computes the picture on `/g/scan`, so nothing would
 * notice if an edit left it showing a receipt that doesn't add up — on the one
 * screen whose whole job is reading totals off receipts.
 */
describe("the drawn bill", () => {
  it("has lines that add to the total it prints", () => {
    expect(total(copy.scan.diagram.lines.map(([, price]) => price)))
      .toBe(copy.scan.diagram.amount);
  });

  it("splits into shares that add to the same total", () => {
    const shares = drawnShares(["Ana", "Ben", "Cleo"], "g1");
    expect(total(shares.map((s) => s.amount))).toBe(copy.scan.diagram.amount);
  });

  it("gives the spare line to the last person, not to nobody", () => {
    expect(drawnShares(["Ana", "Ben", "Cleo"], "g1").map((s) => s.amount))
      .toEqual(["18.00", "14.50", "15.70"]);
  });
});

describe("who the drawing splits it between", () => {
  const group = ["Ana", "Ben", "Cleo", "Dee", "Eli"];

  it("is always three people, however small the group", () => {
    for (const members of [[], ["Solo"], ["One", "Two"], group]) {
      expect(drawnNames(members, "g1")).toHaveLength(3);
    }
  });

  it("fills a thin group out with the stand-ins, its own members first", () => {
    expect(drawnNames(["Solo"], "g1")).toEqual(["Solo", ...copy.scan.diagram.people.slice(0, 2)]);
  });

  it("never lists the same person twice", () => {
    const names = drawnNames(["Ana"], "g1");
    expect(new Set(names).size).toBe(names.length);
  });

  it("picks the group's own members once it has three", () => {
    expect(drawnNames(group, "whatever").every((n) => group.includes(n))).toBe(true);
  });

  it("shows one group the same three every time, and not every group the same three", () => {
    expect(drawnNames(group, "g1")).toEqual(drawnNames(group, "g1"));
    const seen = new Set(["g1", "g2", "g3", "g4", "g5"].map((s) => drawnNames(group, s).join()));
    expect(seen.size).toBeGreaterThan(1);
  });
});
