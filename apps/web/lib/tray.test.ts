import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const news = vi.hoisted(() => ({ count: 0 }));
vi.mock("./db/news", () => ({ newsCount: async () => news.count }));

import { closeSeen, pulled } from "./tray";

/** What the tray holds: the dot on an Android app icon is any of these left standing. */
function shown(tag: string, timestamp: number | undefined) {
  return { tag, timestamp, close: vi.fn() };
}

let tray: ReturnType<typeof shown>[] = [];

beforeEach(() => {
  news.count = 0;
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("navigator", {
    serviceWorker: { getRegistration: async () => ({ getNotifications: async () => tray }) },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("closeSeen", () => {
  it("takes down what a landed pull covers once nothing is new", async () => {
    const old = shown("g", 1_000);
    const after = shown("g", 3_000);
    const other = shown("h", 1_000);
    const unreadable = shown("", 1_000);
    const ageless = shown("g", undefined);
    tray = [old, after, other, unreadable, ageless];
    pulled("g", 2_000);
    await closeSeen("g");
    expect(old.close).toHaveBeenCalled();
    expect(unreadable.close).toHaveBeenCalled();
    // Maybe about ops still on the server; another group's; age unknown.
    for (const kept of [after, other, ageless]) expect(kept.close).not.toHaveBeenCalled();
  });

  it("keeps a group's notification while something in it is new", async () => {
    news.count = 1;
    const old = shown("g2", 1_000);
    tray = [old];
    pulled("g2", 2_000);
    await closeSeen("g2");
    expect(old.close).not.toHaveBeenCalled();
  });

  it("closes nothing before a pull has landed", async () => {
    const old = shown("g3", 1_000);
    tray = [old];
    await closeSeen("g3");
    expect(old.close).not.toHaveBeenCalled();
  });
});
