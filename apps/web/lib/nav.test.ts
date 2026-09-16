import { describe, expect, it, vi } from "vitest";
import { goBack, goUp, sameScreen, stepsBackTo, takeOwnTraversal } from "./nav";

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

describe("goUp", () => {
  /** A Navigation API that can be told to drop a traversal the way WebKit does. */
  function fakeNavigation(urls: string[], here: number, drop: boolean) {
    const target = new EventTarget();
    const traversed: string[] = [];
    const nav = Object.assign(target, {
      entries: () => urls.map((url, i) => ({ url, key: `k${i}` })),
      currentEntry: { index: here },
      traverseTo: (key: string) => {
        traversed.push(key);
        if (!drop) target.dispatchEvent(new Event("navigate"));
        const pending = new Promise(() => {});
        return { committed: pending, finished: pending };
      },
    });
    return { nav, traversed };
  }

  function withWindow(nav: unknown, run: () => void) {
    const g = globalThis as { window?: unknown };
    g.window = { navigation: nav, history: { go: () => {} } };
    try { run(); } finally { delete g.window; }
  }

  it("unwinds to a parent behind it, and marks the traversal as the app's", () => {
    vi.useFakeTimers();
    const { nav, traversed } = fakeNavigation(["/", "/g?id=a", "/g/entry?id=a&e=1"], 2, false);
    const replaced: string[] = [];
    withWindow(nav, () => goUp("/", (to) => replaced.push(to)));
    expect(traversed).toEqual(["k0"]);
    expect(takeOwnTraversal()).toBe(true);
    expect(takeOwnTraversal()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(replaced).toEqual([]);
    vi.useRealTimers();
  });

  it("takes the parent's place when a traversal never starts", () => {
    vi.useFakeTimers();
    const { nav } = fakeNavigation(["/", "/g?id=a"], 1, true);
    const replaced: string[] = [];
    withWindow(nav, () => goUp("/", (to) => replaced.push(to)));
    expect(replaced).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(replaced).toEqual(["/"]);
    vi.useRealTimers();
  });
});

describe("goBack", () => {
  it("marks the traversal as the app's, once", () => {
    let went = false;
    goBack(() => { went = true; });
    expect(went).toBe(true);
    expect(takeOwnTraversal()).toBe(true);
    expect(takeOwnTraversal()).toBe(false);
  });
});
