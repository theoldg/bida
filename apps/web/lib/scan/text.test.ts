import { describe, expect, it } from "vitest";
import { BILL_TEXT_MAX } from "@bida/core";
import { billTextLeft, billTextToBase64, cleanBillText } from "./text";

/**
 * A typed bill's two mechanical steps. Both are small and both are load-bearing:
 * the encoding is what lets a typed bill ride the envelope's base64-only guard
 * (`apps/api/src/scan-body.ts`), and a bill whose bytes came out wrong is a bill
 * the model reads as mojibake and prices anyway.
 */

const decode = (base64: string): string =>
  new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));

describe("what is sent", () => {
  it("survives the round trip, accents and all", () => {
    const bill = "Crème brûlée 7,50\nCafé 2,20\nTotal 9,70";
    expect(decode(billTextToBase64(bill))).toBe(bill);
  });

  it("is base64 and nothing else, so the Worker's guard passes it", () => {
    const encoded = billTextToBase64("Gyros 12.00 — Bière 5.50\t\"two\"\\one\n");
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it("holds a bill right up to the cap", () => {
    const long = "Tagine 18.00\n".repeat(BILL_TEXT_MAX).slice(0, BILL_TEXT_MAX);
    expect(decode(billTextToBase64(long))).toBe(long);
  });

  it("handles a script that is three bytes a character", () => {
    const bill = "ラーメン 1200\n餃子 600\n合計 1800";
    expect(decode(billTextToBase64(bill))).toBe(bill);
  });
});

describe("what is cleaned off it", () => {
  // The newlines *are* the bill's lines, so nothing inside may be touched.
  it("keeps every line break", () => {
    expect(cleanBillText("Beer 4.00\nFries 3.50")).toBe("Beer 4.00\nFries 3.50");
    expect(cleanBillText("Beer 4.00\n\nFries 3.50")).toBe("Beer 4.00\n\nFries 3.50");
  });

  it("takes the blank space a paste brings with it", () => {
    expect(cleanBillText("  \n\nBeer 4.00   \nFries 3.50\t\n \n")).toBe("Beer 4.00\nFries 3.50");
  });

  it("leaves a bill of nothing as nothing, so the button stays shut", () => {
    expect(cleanBillText(" \n\t\n ")).toBe("");
  });
});

describe("the cap", () => {
  it("counts down to zero at the cap", () => {
    expect(billTextLeft("")).toBe(BILL_TEXT_MAX);
    expect(billTextLeft("x".repeat(BILL_TEXT_MAX))).toBe(0);
  });

  /**
   * Four thousand characters has to be a bill nobody reaches by accident: a
   * long supermarket till roll is about sixty lines of thirty characters.
   */
  it("is well clear of a long real bill", () => {
    expect(BILL_TEXT_MAX).toBeGreaterThan(60 * 30);
  });
});
