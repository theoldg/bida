import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calmly, ease, glide, glideMs } from "./seek";

/** A frame clock driven by hand: each `frame()` runs what was queued for it. */
function frames() {
  let queue = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { queue.set(++id, cb); return id; });
  vi.stubGlobal("cancelAnimationFrame", (n: number) => { queue.delete(n); });
  return {
    frame() {
      const run = queue;
      queue = new Map();
      for (const cb of run.values()) cb(0);
    },
    get pending() { return queue.size; },
  };
}

/** A scroller that rounds `scrollTop` the way a browser does, and keeps its listeners. */
function scroller(top = 0) {
  const listeners = new Map<string, () => void>();
  let value = top;
  const box = {
    get scrollTop() { return value; },
    set scrollTop(v: number) { value = Math.round(v); },
    addEventListener: (type: string, fn: () => void) => { listeners.set(type, fn); },
    removeEventListener: (type: string) => { listeners.delete(type); },
  };
  return {
    box: box as unknown as HTMLElement,
    fire: (type: string) => listeners.get(type)?.(),
    listening: () => listeners.size,
    drag: (v: number) => { value = v; },
  };
}

const reduced = (on: boolean) => vi.stubGlobal("window", { matchMedia: () => ({ matches: on }) });

describe("ease", () => {
  it("starts at rest and arrives at rest, passing halfway at half time", () => {
    expect(ease(0)).toBe(0);
    expect(ease(.5)).toBe(.5);
    expect(ease(1)).toBe(1);
    expect(ease(.1)).toBeLessThan(.1);
    expect(ease(.9)).toBeGreaterThan(.9);
  });

  it("never overshoots, before or after its window", () => {
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    for (let t = 0; t <= 1; t += .05) expect(ease(t + .05)).toBeGreaterThanOrEqual(ease(t));
  });
});

describe("glideMs", () => {
  it("scales with distance, either way", () => {
    expect(glideMs(600)).toBe(360);
    expect(glideMs(-600)).toBe(360);
  });

  it("is never a flick and never a crawl", () => {
    expect(glideMs(10)).toBe(240);
    expect(glideMs(5000)).toBe(480);
  });
});

describe("glide", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(0); reduced(false); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("moves a little each frame, and never in the tick it was asked", () => {
    const clock = frames();
    const s = scroller(0);
    const done = vi.fn();
    glide(s.box, 600, done); // 360ms
    expect(s.box.scrollTop).toBe(0);
    let was = 0;
    for (const at of [60, 120, 180, 240, 300]) {
      vi.setSystemTime(at);
      clock.frame();
      expect(s.box.scrollTop).toBeGreaterThan(was);
      expect(s.box.scrollTop).toBeLessThan(600);
      was = s.box.scrollTop;
    }
    expect(done).not.toHaveBeenCalled();
  });

  it("lands exactly on the target, answers once, and lets go of the list", () => {
    const clock = frames();
    const s = scroller(100);
    const done = vi.fn();
    glide(s.box, 40, done);
    vi.setSystemTime(1000);
    clock.frame();
    expect(s.box.scrollTop).toBe(40);
    expect(done).toHaveBeenCalledTimes(1);
    expect(clock.pending).toBe(0);
    expect(s.listening()).toBe(0);
    clock.frame();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("stops where it stands and answers at once when a finger takes the list", () => {
    const clock = frames();
    const s = scroller(0);
    const done = vi.fn();
    glide(s.box, 600, done);
    vi.setSystemTime(100);
    clock.frame();
    const at = s.box.scrollTop;
    s.fire("touchstart");
    expect(done).toHaveBeenCalledTimes(1);
    vi.setSystemTime(1000);
    clock.frame();
    expect(s.box.scrollTop).toBe(at);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("counts the list moved from under it as a take-over too", () => {
    const clock = frames();
    const s = scroller(0);
    const done = vi.fn();
    glide(s.box, 600, done);
    vi.setSystemTime(100);
    clock.frame();
    s.drag(s.box.scrollTop + 80);
    vi.setSystemTime(160);
    clock.frame();
    expect(done).toHaveBeenCalledTimes(1);
    expect(clock.pending).toBe(0);
  });

  it("puts the list in place at once under reduced motion, still answering a frame later", () => {
    reduced(true);
    const clock = frames();
    const s = scroller(0);
    const done = vi.fn();
    glide(s.box, 600, done);
    expect(done).not.toHaveBeenCalled();
    clock.frame();
    expect(s.box.scrollTop).toBe(600);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("stops without answering when cancelled — its screen is going away", () => {
    const clock = frames();
    const s = scroller(0);
    const done = vi.fn();
    const cancel = glide(s.box, 600, done);
    vi.setSystemTime(100);
    clock.frame();
    cancel();
    vi.setSystemTime(1000);
    clock.frame();
    expect(done).not.toHaveBeenCalled();
    expect(clock.pending).toBe(0);
    expect(s.listening()).toBe(0);
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
    reduced(false);
    expect(calmly()).toBe(false);
  });
});
