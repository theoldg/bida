import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginScan, clearScan, failScan, getLiveScan } from "./live";

/**
 * A scan outlives the control that started it.
 *
 * The Items tab is unmounted the moment you tap Evenly, and the form itself is
 * unmounted by the payers editor and the who-had-what grid — none of which
 * says anything about whether a model is still reading a photograph. Held in
 * component state, "Reading…" and its progress bar were facts about a mounted
 * component: coming back restarted a sweep on a scan that was two seconds old.
 */
describe("a scan in flight", () => {
  const G = "g-1";
  beforeEach(() => { clearScan(G); vi.useRealTimers(); });

  it("is still there, at the age it actually is, after the screen came back", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    beginScan(G);
    vi.setSystemTime(1_001_200);
    const live = getLiveScan(G);
    expect(live?.state).toBe("scanning");
    // What the bar draws its negative delay from: 1.2s in, not 0.
    expect(Date.now() - (live?.startedAt ?? 0)).toBe(1200);
  });

  it("keeps the sweep it was given, so a second look is the same estimate", () => {
    beginScan(G);
    const first = getLiveScan(G)?.seconds;
    expect(first).toBeGreaterThanOrEqual(2.8);
    expect(first).toBeLessThanOrEqual(3.2);
    expect(getLiveScan(G)?.seconds).toBe(first);
  });

  it("is gone once it lands", () => {
    beginScan(G);
    clearScan(G);
    expect(getLiveScan(G)).toBeUndefined();
  });

  it("leaves its refusal up, and the next scan clears it", () => {
    beginScan(G);
    failScan(G, "Too blurry.");
    expect(getLiveScan(G)).toMatchObject({ state: "error", error: "Too blurry." });
    beginScan(G);
    expect(getLiveScan(G)).toMatchObject({ state: "scanning", error: null });
  });

  it("belongs to its own group", () => {
    beginScan(G);
    expect(getLiveScan("g-2")).toBeUndefined();
    clearScan("g-2");
    expect(getLiveScan(G)?.state).toBe("scanning");
  });
});
