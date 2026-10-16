import { describe, expect, it } from "vitest";
import { readSharedSplit, type SharedSplit } from "./index.js";

/**
 * A link is anybody's to write and outlives the build that wrote it: what
 * opens is checked whole, capped, and read leniently where leniency costs
 * nothing (ADR-0035).
 */

const split: SharedSplit = {
  title: "Dinner",
  currency: "JPY",
  totalMinor: 3000,
  people: [{ name: "Ana", minor: 3000, lines: [{ label: "Ramen", count: { n: 2, d: 1 }, minor: 3000 }] }],
};

const line = (over: object) => ({ ...split, people: [{ ...split.people[0], lines: [{ ...split.people[0]!.lines[0], ...over }] }] });

describe("readSharedSplit", () => {
  it("reads what was written", () => {
    expect(readSharedSplit(JSON.parse(JSON.stringify(split)))).toEqual(split);
  });

  it("ignores fields it doesn't know, and an extra of a kind it doesn't know", () => {
    const read = readSharedSplit({ ...line({ extra: "service", colour: "red" }), payer: "Ana" });
    expect(read).toEqual(split);
  });

  it("keeps the extras it knows, and a deduction's negative figure", () => {
    const read = readSharedSplit(line({ label: "", extra: "discount", count: { n: 1, d: 1 }, minor: -200 }));
    expect(read?.people[0]?.lines[0]).toEqual({ label: "", extra: "discount", count: { n: 1, d: 1 }, minor: -200 });
  });

  it("cuts a long label or name rather than drawing all of it", () => {
    const read = readSharedSplit(line({ label: "x".repeat(5000) }));
    expect(read?.people[0]?.lines[0]?.label).toHaveLength(200);
  });

  it.each([
    ["not an object", null],
    ["no people", { ...split, people: undefined }],
    ["a float", { ...split, totalMinor: 30.5 }],
    ["a currency Intl would throw on", { ...split, currency: "€" }],
    ["a person with no name", { ...split, people: [{ minor: 1, lines: [] }] }],
    ["a line counted as nothing", line({ count: { n: 0, d: 1 } })],
    ["a line with a string figure", line({ minor: "3000" })],
    ["more people than any table", { ...split, people: Array(101).fill(split.people[0]) }],
  ])("refuses %s", (_, input) => {
    expect(readSharedSplit(input)).toBeNull();
  });
});
