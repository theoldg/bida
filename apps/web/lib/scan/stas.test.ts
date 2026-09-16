import { afterEach, describe, expect, it, vi } from "vitest";
import { setStasMode, stasMode } from "./stas";

/**
 * Two things matter about a switch this small: that it survives the reload it
 * exists to survive, and that a browser refusing localStorage costs the
 * setting and not the scan. `/diag` sets it on a phone in private mode too.
 */
const store = (): Storage => {
  const held = new Map<string, string>();
  return {
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => { held.set(k, v); },
    removeItem: (k: string) => { held.delete(k); },
  } as unknown as Storage;
};

afterEach(() => vi.unstubAllGlobals());

describe("Staś mode", () => {
  it("is off until somebody turns it on, and stays on once they have", () => {
    vi.stubGlobal("localStorage", store());
    expect(stasMode()).toBe(false);
    setStasMode(true);
    expect(stasMode()).toBe(true);
    setStasMode(false);
    expect(stasMode()).toBe(false);
  });

  it("is off, not broken, where the browser won't answer", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("private mode"); },
      setItem: () => { throw new Error("private mode"); },
      removeItem: () => { throw new Error("private mode"); },
    } as unknown as Storage);
    expect(stasMode()).toBe(false);
    expect(() => setStasMode(true)).not.toThrow();
  });
});
