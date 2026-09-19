import { describe, expect, it } from "vitest";
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
  /** A Navigation API with a history in it, and a `history.go` to watch. */
  function fakeWindow(urls: string[], here: number) {
    const went: number[] = [];
    const nav = Object.assign(new EventTarget(), {
      entries: () => urls.map((url) => ({ url })),
      currentEntry: { index: here },
    });
    return { window: { navigation: nav, history: { go: (n: number) => went.push(n) } }, went };
  }

  function withWindow(w: unknown, run: () => void) {
    const g = globalThis as { window?: unknown };
    g.window = w;
    try { run(); } finally { delete g.window; }
  }

  it("goes back over the screens between here and the parent", () => {
    const { window, went } = fakeWindow(["/", "/g?id=a", "/g/entry?id=a&e=1"], 2);
    const replaced: string[] = [];
    withWindow(window, () => goUp("/", (to) => replaced.push(to)));
    expect(went).toEqual([-2]);
    expect(replaced).toEqual([]);
    expect(takeOwnTraversal()).toBe(true);
    expect(takeOwnTraversal()).toBe(false);
  });

  it("takes the parent's place when it was never visited", () => {
    const { window, went } = fakeWindow(["/g?id=a", "/g/entry?id=a&e=1"], 1);
    const replaced: string[] = [];
    withWindow(window, () => goUp("/", (to) => replaced.push(to)));
    expect(went).toEqual([]);
    expect(replaced).toEqual(["/"]);
    // Nothing traversed, so nothing to explain to the press guard — a latch
    // left armed here would swallow the next real press.
    expect(takeOwnTraversal()).toBe(false);
  });

  it("takes its place where there is no Navigation API at all", () => {
    const replaced: string[] = [];
    withWindow({ history: { go: () => {} } }, () => goUp("/", (to) => replaced.push(to)));
    expect(replaced).toEqual(["/"]);
  });
});

describe("goBack", () => {
  function withWindow(here: number | undefined, run: () => void) {
    const g = globalThis as { window?: unknown };
    g.window = here === undefined ? {} : { navigation: { currentEntry: { index: here } } };
    try { run(); } finally { delete g.window; }
  }

  it("marks the traversal as the app's, once", () => {
    let went = false;
    withWindow(2, () => goBack(() => { went = true; }));
    expect(went).toBe(true);
    expect(takeOwnTraversal()).toBe(true);
    expect(takeOwnTraversal()).toBe(false);
  });

  // A cold load on a screen whose arrow is a plain back: `back()` moves
  // nothing, so no `navigate` arrives to spend the latch, and an armed one
  // would answer the *next* press — a real one — as the app's own.
  it("marks nothing at the start of the history", () => {
    withWindow(0, () => goBack(() => {}));
    expect(takeOwnTraversal()).toBe(false);
  });
});
