import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The call is one line; what matters is that it never throws on a browser
 * that can't do it, because it runs on the join path (see commands.ts).
 *
 * `persist.ts` caches a granted answer in module scope, so every case imports
 * it fresh after `resetModules()` rather than inheriting the last one's.
 */
async function loadFresh() {
  vi.resetModules();
  return (await import("./persist")).requestPersistence;
}

describe("requestPersistence", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("asks the browser to keep the data when it isn't already persistent", async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist } });

    const requestPersistence = await loadFresh();

    expect(await requestPersistence()).toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("doesn't re-ask when the browser already granted it", async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { storage: { persisted: async () => true, persist } });

    const requestPersistence = await loadFresh();

    expect(await requestPersistence()).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("asks only once per session, however many times it's called", async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { storage: { persisted: async () => false, persist } });

    const requestPersistence = await loadFresh();
    await requestPersistence();
    await requestPersistence();

    expect(persist).toHaveBeenCalledOnce();
  });

  it("answers false rather than throwing where the API is missing", async () => {
    vi.stubGlobal("navigator", {});
    const requestPersistence = await loadFresh();
    expect(await requestPersistence()).toBe(false);
  });

  it("answers false rather than throwing when the browser refuses outright", async () => {
    vi.stubGlobal("navigator", {
      storage: { persisted: async () => false, persist: async () => { throw new Error("denied"); } },
    });
    const requestPersistence = await loadFresh();
    expect(await requestPersistence()).toBe(false);
  });
});
