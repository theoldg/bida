import { describe, expect, it } from "vitest";
import { sameScreen, stepsBackTo } from "./nav";

const GROUPS = "http://app.invalid/";
const GROUP = "http://app.invalid/g?id=g1";
const EXPENSE = "http://app.invalid/g/expense?id=g1&e=x1";

describe("stepsBackTo", () => {
  it("finds the parent one entry back", () => {
    expect(stepsBackTo([GROUPS, GROUP, EXPENSE], 2, "/g?id=g1")).toBe(-1);
  });

  it("unwinds past the screens in between", () => {
    const entries = [GROUPS, GROUP, EXPENSE, "http://app.invalid/g/history?id=g1&e=x1"];
    expect(stepsBackTo(entries, 3, "/g?id=g1")).toBe(-2);
  });

  it("ignores query order and a trailing slash", () => {
    expect(stepsBackTo(["http://app.invalid/g/?tab=balances&id=g1", EXPENSE], 1, "/g?id=g1&tab=balances")).toBe(-1);
  });

  it("is null when the parent is only ahead of us", () => {
    // Went back to the group already: the expense is forward, not behind.
    expect(stepsBackTo([GROUPS, GROUP, EXPENSE], 1, "/g/expense?id=g1&e=x1")).toBeNull();
  });

  it("is null when the parent was never visited — a deep link", () => {
    expect(stepsBackTo([EXPENSE], 0, "/g?id=g1")).toBeNull();
  });

  it("takes the nearest of two visits to the same screen", () => {
    expect(stepsBackTo([GROUP, EXPENSE, GROUP, EXPENSE], 3, "/g?id=g1")).toBe(-1);
  });

  it("tolerates an entry the browser won't name", () => {
    expect(stepsBackTo([null, GROUP, EXPENSE], 2, "/g?id=g1")).toBe(-1);
  });

  it("doesn't confuse two groups", () => {
    expect(stepsBackTo([GROUPS, "http://app.invalid/g?id=g2"], 1, "/g?id=g1")).toBeNull();
  });
});

/**
 * What decides whether the device's back button is left alone: if the browser's
 * own traversal is already going where the arrow climbs, nothing is cancelled
 * (lib/back-button.ts). That is nearly every press in the app, so a wrong
 * answer here is either a cancelled press that needn't be or a skipped level.
 */
describe("sameScreen", () => {
  it("ignores query order and a trailing slash", () => {
    expect(sameScreen("https://h.app/g/history/?id=g1", "/g/history?id=g1")).toBe(true);
    expect(sameScreen("https://h.app/g?id=g1&tab=balances", "/g?tab=balances&id=g1")).toBe(true);
  });

  it("counts a tab as part of the screen's name", () => {
    // The ledger is not the balances tab, even though they share a route.
    expect(sameScreen("https://h.app/g?id=g1&tab=balances", "/g?id=g1")).toBe(false);
  });

  it("doesn't confuse two groups, or two entries", () => {
    expect(sameScreen("https://h.app/g?id=g1", "/g?id=g2")).toBe(false);
    expect(sameScreen("https://h.app/g/entry?id=g1&e=x1", "/g/entry?id=g1&e=x2")).toBe(false);
  });

  it("counts an entry's source, because that is where back goes", () => {
    expect(sameScreen("https://h.app/g/entry?id=g1&e=x1&via=history",
      "/g/entry?id=g1&e=x1")).toBe(false);
  });
});
