import { describe, expect, it, vi } from "vitest";
import { AWAY_MS, mayReloadOnReturn, nudgeWhileWaiting, reloadCostsNothing } from "./update";

/**
 * The one list, asked by two reloads: the update's (lib/update.ts) and the iOS
 * carry's (components/install.tsx). What it must never say yes to is a screen
 * holding something only this page's memory has.
 */
describe("reloadCostsNothing", () => {
  it("is every screen there is nothing on to lose", () => {
    for (const path of ["/", "/g", "/g/balances", "/g/members", "/g/history", "/g/entry", "/about"]) {
      expect(reloadCostsNothing(path)).toBe(true);
    }
  });

  it("is not the two forms, whose draft is in memory and warns on unload", () => {
    expect(reloadCostsNothing("/g/entry/edit")).toBe(false);
    expect(reloadCostsNothing("/new")).toBe(false);
  });

  it("is not a flow, which a reload drops back a step", () => {
    for (const path of ["/join", "/g/claim", "/install", "/quick", "/quick/items", "/quick/result"]) {
      expect(reloadCostsNothing(path)).toBe(false);
    }
  });

  it("reads a trailing slash as the same screen", () => {
    expect(reloadCostsNothing("/g/")).toBe(true);
    expect(reloadCostsNothing("/")).toBe(true);
    expect(reloadCostsNothing("")).toBe(true);
    expect(reloadCostsNothing("/g/entry/edit/")).toBe(false);
  });
});

/** Which return to the front takes a waiting build. */
describe("mayReloadOnReturn", () => {
  it("is always the groups list, however short the absence", () => {
    expect(mayReloadOnReturn("/", 0)).toBe(true);
    expect(mayReloadOnReturn("", 0)).toBe(true);
  });

  it("is a ledger only after a real absence, not an app switch", () => {
    expect(mayReloadOnReturn("/g", 5_000)).toBe(false);
    expect(mayReloadOnReturn("/g", AWAY_MS - 1)).toBe(false);
    expect(mayReloadOnReturn("/g", AWAY_MS)).toBe(true);
    expect(mayReloadOnReturn("/g/balances/", AWAY_MS)).toBe(true);
  });

  it("is nowhere while the screen holds something, however long away", () => {
    expect(mayReloadOnReturn("/", 0, true)).toBe(false);
    expect(mayReloadOnReturn("/g/members", AWAY_MS * 10, true)).toBe(false);
  });

  it("is never a form or a flow, however long away", () => {
    for (const path of ["/g/entry/edit", "/new", "/join", "/g/claim", "/quick"]) {
      expect(mayReloadOnReturn(path, 24 * 3_600_000)).toBe(false);
    }
  });
});

describe("nudgeWhileWaiting", () => {
  const registration = (waiting: { postMessage: (m: unknown) => void } | null) =>
    ({ waiting }) as unknown as ServiceWorkerRegistration;

  it("asks a stalled worker again until it stops waiting", () => {
    vi.useFakeTimers();
    const asked: unknown[] = [];
    const reg = registration({ postMessage: (m) => asked.push(m) });
    nudgeWhileWaiting(reg);
    expect(asked).toHaveLength(0); // the ordinary activation gets its moment first
    vi.advanceTimersByTime(10_000);
    expect(asked).toEqual([{ type: "skip-waiting" }, { type: "skip-waiting" }]);
    (reg as { waiting: unknown }).waiting = null;
    vi.advanceTimersByTime(60_000);
    expect(asked).toHaveLength(2);
    vi.useRealTimers();
  });

  it("asks nothing when nothing waits", () => {
    vi.useFakeTimers();
    nudgeWhileWaiting(registration(null));
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("gives up after a minute rather than asking forever", () => {
    vi.useFakeTimers();
    let asked = 0;
    nudgeWhileWaiting(registration({ postMessage: () => { asked++; } }));
    vi.advanceTimersByTime(10 * 60_000);
    expect(asked).toBe(12);
    vi.useRealTimers();
  });
});
