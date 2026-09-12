import { describe, expect, it } from "vitest";
import { minorToDecimalString, parseMinor, sumMinor } from "@bida/core";
import { copy } from "./copy";

/**
 * The bill drawn on `/g/scan` claims one thing: these lines are what that
 * total is made of. Nothing in the app computes it — it is copy — so nothing
 * would notice if an edit left the drawing showing a receipt that doesn't add
 * up, on the one screen whose whole job is reading totals off receipts.
 */
describe("the scan screen's drawn bill", () => {
  it("adds up to the total the form comes back with", () => {
    const { lines, amount } = copy.scan.diagram;
    const sum = sumMinor(lines.map(([, price]) => parseMinor(price, "EUR")));
    expect(minorToDecimalString(sum, "EUR")).toBe(amount);
  });
});
