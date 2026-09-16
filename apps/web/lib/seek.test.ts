import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calmly, whenStill } from "./seek";

/** A frame clock driven by hand: each `frame()` runs what was queued for it. */
function frames() {
  let queue: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queue.push(cb); return queue.length; });
  return {
    frame() {
      const run = queue;
      queue = [];
      for (const cb of run) cb(0);
    },
    get pending() { return queue.length; },
  };
}

describe("whenStill", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("waits while the scroller is still travelling", () => {
    const clock = frames();
    const box = { scrollTop: 0 } as Element;
    const done = vi.fn();
    whenStill(box, 300, done);
    for (const top of [40, 120, 250]) {
      box.scrollTop = top;
      clock.frame();
      expect(done).not.toHaveBeenCalled();
    }
    expect(clock.pending).toBe(1);
  });

  it("answers on the first frame it has arrived, within a pixel, and only once", () => {
    const clock = frames();
    const box = { scrollTop: 0 } as Element;
    const done = vi.fn();
    whenStill(box, 300, done);
    box.scrollTop = 299.2;
    clock.frame();
    expect(done).toHaveBeenCalledTimes(1);
    expect(clock.pending).toBe(0);
    clock.frame();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("gives up and answers anyway once the scroll has had long enough", () => {
    const clock = frames();
    // Taken over mid-travel: the scroller never reaches where it was sent.
    const box = { scrollTop: 90 } as Element;
    const done = vi.fn();
    whenStill(box, 300, done);
    vi.setSystemTime(790);
    clock.frame();
    expect(done).not.toHaveBeenCalled();
    vi.setSystemTime(801);
    clock.frame();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("never answers in the same tick it was asked", () => {
    frames();
    const box = { scrollTop: 300 } as Element;
    const done = vi.fn();
    whenStill(box, 300, done);
    expect(done).not.toHaveBeenCalled();
  });
});

describe("calmly", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the reduced-motion preference, and only that query", () => {
    const asked: string[] = [];
    vi.stubGlobal("window", {
      matchMedia: (q: string) => { asked.push(q); return { matches: true }; },
    });
    expect(calmly()).toBe(true);
    expect(asked).toEqual(["(prefers-reduced-motion: reduce)"]);
  });

  it("travels when nothing asks it not to", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(calmly()).toBe(false);
  });
});
