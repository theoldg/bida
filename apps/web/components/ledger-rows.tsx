"use client";
// Doc: docs/rows.md#the-ledger-moves

import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import {
  clearSaved, FADE_IN_MS, letRoll, FADE_OUT_MS, FOLD_MS, OPEN_MS, peekSaved,
  presence, runs, SAVED_BEAT, SAVED_DWELL, STILL_MS, type LedgerItem, type Shown,
} from "@/lib/ledger-motion";
import { restoreAnchor, yieldPosition } from "@/lib/ledger-position";
import {
  indexAt, isGap, KEEP_ROWS, landingOf, overCap, offsetsOf, rangeOf, segmentsOf, speedOf, WINDOW_ROWS,
  windowAround, type Heights,
} from "@/lib/ledger-window";
import { SkeletonRow } from "./chrome";
import { revealWhole, scrollTarget } from "@/lib/reveal";
import { calmly, glide } from "@/lib/seek";

/**
 * `windowed`: only the rows near the screen are drawn, the rest kept as their
 * height (docs/rows.md#the-ledger-draws-what-is-near-the-screen). The groups
 * list is never long enough to need it. `empty` stands where the rows were once
 * none is drawn — not once `items` is empty, which it is while the last row is
 * still on screen.
 */
export function LedgerRows<T>({ groupId, items, row, empty, opens = true, windowed = false }: {
  groupId?: string;
  items: LedgerItem<T>[];
  row: (row: T) => ReactNode;
  empty?: ReactNode;
  opens?: boolean;
  windowed?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = () => root.current?.closest<HTMLElement>(".scroll") ?? null;

  // What is drawn lags `items` while the list is moving: holding the view still
  // for an arrival mid-fling would stop the fling dead on iOS.
  const [applied, setApplied] = useState(items);
  const motion = useRef({ touching: false, scrolled: 0 });
  useEffect(() => {
    if (items === applied) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const { touching, scrolled } = motion.current;
      const wait = touching ? STILL_MS : scrolled + STILL_MS - Date.now();
      if (wait > 0) timer = setTimeout(attempt, wait);
      else setApplied(items);
    };
    attempt();
    return () => clearTimeout(timer);
  }, [items, applied]);
  useEffect(() => {
    const box = scroller();
    if (!box) return;
    const m = motion.current;
    // A row's menu and its dialog live inside the scroller, but a tap on them
    // moves no list: counted, the row a Delete took stayed for STILL_MS.
    const onList = (e: Event) => !(e.target instanceof Element && e.target.closest("dialog, .rowmenu, .rowmenu-veil"));
    const down = (e: Event) => { if (onList(e)) m.touching = true; };
    const up = (e: Event) => { m.touching = false; if (onList(e)) m.scrolled = Date.now(); };
    const moved = () => { m.scrolled = Date.now(); };
    box.addEventListener("touchstart", down, { passive: true });
    box.addEventListener("touchend", up, { passive: true });
    box.addEventListener("touchcancel", up, { passive: true });
    box.addEventListener("scroll", moved, { passive: true });
    return () => {
      box.removeEventListener("touchstart", down);
      box.removeEventListener("touchend", up);
      box.removeEventListener("touchcancel", up);
      box.removeEventListener("scroll", moved);
    };
  }, []);

  const [shown, setShown] = useState<Shown<T>[]>(applied);
  const [basis, setBasis] = useState(applied);
  let drawing = shown;
  if (basis !== applied) {
    drawing = applied.some((i) => i.kind === "row") ? presence(shown, applied) : applied;
    setBasis(applied);
    setShown(drawing);
  }

  const win = useWindow(windowed, drawing, root, scroller, groupId);

  const drawn = useRef<Set<string> | null>(null);
  const diffed = useRef<Shown<T>[] | null>(null);
  const busy = useRef(new Set<string>());
  const flashed = useRef(false);

  useLayoutEffect(() => {
    const box = scroller();
    const list = root.current;
    if (!box || !list) return;
    const slot = (key: string) => list.querySelector<HTMLElement>(`:scope > [data-key="${CSS.escape(key)}"]`);
    // A scroll redraws without the data moving: nothing came or went, and a
    // pass over every key on every frame of a fling is what 10,000 rows can't pay.
    if (diffed.current === drawing && flashed.current) return;
    diffed.current = drawing;
    const keys = drawing.map((i) => i.key);
    const leaving = new Set(drawing.filter((i) => i.leaving).map((i) => i.key));
    const before = drawn.current;
    drawn.current = new Set(keys);

    // The live query can answer before the save's write lands, so the saved row
    // may turn up a commit late.
    let saved: string | null = null;
    if (!flashed.current && groupId) {
      saved = peekSaved(groupId);
      flashed.current = flashSaved(groupId, box, slot, win ?? undefined);
    }
    if (!before) return;

    // Undrawn slots are only height: where a run sits and how tall it is come
    // from the arithmetic, and the DOM answers for the rest.
    const at = win?.indexOf ?? new Map(keys.map((k, i) => [k, i]));
    const runTop = (run: string[], slots: HTMLElement[]) => win
      ? box.getBoundingClientRect().top - box.scrollTop + win.listTop() + win.offsets[at.get(run[0]!)!]!
      : slots[0]?.getBoundingClientRect().top ?? 0;
    const runHeight = (run: string[], slots: HTMLElement[]) => win
      ? win.offsets[at.get(run.at(-1)!)! + 1]! - win.offsets[at.get(run[0]!)!]!
      : slots.reduce((n, s) => n + s.offsetHeight, 0);

    const hadRows = drawing.some((i) => i.kind === "row" && before.has(i.key));
    for (const run of runs(keys, (k) => !before.has(k) && !leaving.has(k))) {
      if (!hadRows) break;
      const slots = run.map(slot).filter((s): s is HTMLElement => s !== null);
      if (runTop(run, slots) < box.getBoundingClientRect().top) {
        box.scrollTop += runHeight(run, slots);
      } else if (opens && !calmly() && !(saved && run.includes(saved))) {
        for (const s of slots) arrive(s);
      }
    }

    for (const run of runs(keys, (k) => leaving.has(k) && !busy.current.has(k))) {
      for (const k of run) busy.current.add(k);
      const slots = run.map(slot).filter((s): s is HTMLElement => s !== null);
      const done = () => {
        for (const k of run) busy.current.delete(k);
        setShown((now) => now.filter((i) => !run.includes(i.key) || !i.leaving));
      };
      const bottom = slots.at(-1)?.getBoundingClientRect().bottom ?? 0;
      if (slots.length === 0) {
        // Never drawn: its height goes, and above the screen that is a scroll.
        if (win && runTop(run, slots) < box.getBoundingClientRect().top) box.scrollTop -= runHeight(run, slots);
        done();
      } else if (bottom <= box.getBoundingClientRect().top + 1) {
        const h = slots.reduce((n, s) => n + s.offsetHeight, 0);
        for (const s of slots) s.style.height = "0px";
        box.scrollTop -= h;
        done();
      } else if (calmly()) done();
      else void depart(slots, box).then(done);
    }
  });

  const slotOf = (item: Shown<T>, i: number, fill: boolean) => (
    <div key={item.key} className="lslot" data-key={item.key} data-leaving={item.leaving ? "" : undefined}
      data-skel={fill ? undefined : ""}>
      {item.kind === "day" ? <div className="daylabel">{item.label}</div>
        : fill ? row(item.row) : <SkeletonRow i={i} entry={item.key} />}
    </div>
  );

  return (
    <>
    {drawing.length === 0 ? empty : null}
    <div className="rows lrows" ref={root}>
      {win
        ? segmentsOf(win.offsets, win.drawn).map((seg) => isGap(seg)
          ? <div key={`gap:${drawing[seg.first]!.key}`} className="lgap"
            style={{ height: seg.gap, ["--lrow" as string]: `${heights.row}px` }} aria-hidden="true" />
          : slotOf(drawing[seg.at]!, seg.at, win.filled(seg.at)))
        : drawing.map((item, i) => slotOf(item, i, true))}
    </div>
    </>
  );
}

/** Measured off the first slots drawn; a guess until then (`.entryrow`'s 68px and its line). */
let heights: Heights = { row: 69, day: 30 };

/** A scroll counts as the hand's while a finger is down, and for a fling's coast after. */
const HAND_MS = 2500;
/** Below this, px/ms, a coast has ended. */
const STILL_SPEED = 0.05;
/** How far back the speed is read, and how long a scroll stays news. */
const SAMPLE_MS = 100;

interface Window {
  offsets: number[];
  /** Each slot's index by its key. */
  indexOf: Map<string, number>;
  /** Drawn at all — on screen, or filled — ascending. */
  drawn: number[];
  /** Drawn as itself rather than a skeleton. */
  filled: (i: number) => boolean;
  /** The rows' top inside the scroller's content. */
  listTop: () => number;
  /** A glide's landing, filled ahead of it; null when it lands. */
  pin: (top: number | null) => void;
  /** A row kept drawn wherever the screen goes: the saved one, until its flash ends. */
  hold: (key: string | null) => void;
}

/**
 * Which slots are drawn. On screen always — as a skeleton until filled, and a
 * screen either side as skeletons too — and filled: the `WINDOW_ROWS` around
 * the screen, or around where a fling will land rather than the rows rushing
 * past, kept once filled.
 */
function useWindow<T>(
  on: boolean, items: Shown<T>[], root: { current: HTMLDivElement | null },
  scroller: () => HTMLElement | null, groupId: string | undefined,
): Window | null {
  const [measured, remeasure] = useReducer((n: number) => n + 1, 0);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const offsets = useMemo(() => offsetsOf(items, heights), [items, measured]);
  const indexOf = useMemo(() => new Map(items.map((item, i) => [item.key, i])), [items]);
  const state = useRef<{
    top: number; bottom: number; filled: Set<string>; pinned: number | null;
    samples: { t: number; y: number }[]; touching: boolean; lastHand: number;
    held: string | null;
    /** False while a way back has yet to put the scroller where it was. */
    placed: boolean;
  } | null>(null);

  if (on && !state.current) {
    // The first window goes where the screen will be: a saved row, or the row
    // a way back puts at the top.
    const back = groupId ? restoreAnchor(groupId) : null;
    const anchor = back ?? (groupId ? peekSaved(groupId) : null);
    const center = Math.max(0, items.findIndex((i) => i.key === anchor));
    const [a, b] = windowAround(items, center, WINDOW_ROWS);
    state.current = {
      top: offsets[a] ?? 0, bottom: offsets[b] ?? 0, pinned: null, samples: [], touching: false, lastHand: 0,
      filled: new Set(items.slice(a, b).map((i) => i.key)), held: null, placed: back === null,
    };
  }

  const listTop = () => {
    const box = scroller();
    const list = root.current;
    return box && list ? list.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop : 0;
  };

  /**
   * Only a scroll is a sample: the render a scroll causes computes again in
   * the same frame, and a second sample at the same place would read as the
   * fling having stopped.
   */
  const compute = (scrolled = false) => {
    const w = state.current;
    const box = scroller();
    if (!w || !box) return;
    const now = performance.now();
    const base = listTop();
    if (scrolled) w.samples.push({ t: now, y: box.scrollTop });
    while (w.samples.length > 2 && now - w.samples[0]!.t > SAMPLE_MS) w.samples.shift();
    const last = w.samples.at(-1);
    const speed = last && now - last.t <= SAMPLE_MS ? speedOf(w.samples) : 0;
    // A wheel's notch is one scroll with no speed to read: the input itself says.
    const sinceHand = now - w.lastHand;
    const hand = w.touching || sinceHand < SAMPLE_MS || (sinceHand < HAND_MS && Math.abs(speed) > STILL_SPEED);
    const landing = w.pinned ?? (hand ? landingOf(box.scrollTop, speed, box.clientHeight, box.scrollHeight - box.clientHeight) : null);
    const center = indexAt(offsets, (landing ?? box.scrollTop) - base + box.clientHeight / 2);
    const [a, b] = windowAround(items, center, WINDOW_ROWS);
    let changed = false;
    for (let i = a; i < b; i++) {
      const key = items[i]!.key;
      if (!w.filled.has(key)) { w.filled.add(key); changed = true; }
    }
    // A row once filled stays for the visit (the owner, 2026-10-12), up to the cap.
    if (w.filled.size > b - a + KEEP_ROWS) {
      const kept = new Map<string, number>();
      for (const key of w.filled) {
        const i = indexOf.get(key);
        if (i === undefined) w.filled.delete(key);
        else if (i < a || i >= b) kept.set(key, i);
      }
      for (const key of overCap(kept, center, KEEP_ROWS)) { w.filled.delete(key); changed = true; }
    }
    const top = box.scrollTop - base;
    const was = rangeOf(offsets, w.top, w.bottom);
    const is = rangeOf(offsets, top, top + box.clientHeight);
    w.top = top;
    w.bottom = top + box.clientHeight;
    if (was[0] !== is[0] || was[1] !== is[1]) changed = true;
    if (changed) redraw();
  };
  const latest = useRef(compute);
  latest.current = compute;

  // Before paint, every render: the items moved, or the scroller did.
  useLayoutEffect(() => {
    if (!on) return;
    // A way back's restore runs after this, in the ledger's own layout effect,
    // and moves the scroller: windowing at the top first would paint a blank.
    if (state.current?.placed) latest.current();
    const list = root.current;
    if (!list) return;
    const fits = (slot: Element | null | undefined) =>
      slot instanceof HTMLElement && slot.getAnimations().length === 0 ? slot.offsetHeight : 0;
    const row = fits(list.querySelector(":scope > .lslot:not([data-leaving]) > .entryrow")?.parentElement);
    const day = fits(list.querySelector(":scope > .lslot:not([data-leaving]) > .daylabel")?.parentElement);
    const next = { row: row || heights.row, day: day || heights.day };
    if (Math.abs(next.row - heights.row) > 0.5 || Math.abs(next.day - heights.day) > 0.5) {
      heights = next;
      remeasure();
    }
  });

  useEffect(() => {
    const box = scroller();
    const w = state.current;
    if (!on || !box || !w) return;
    let frame = 0;
    const onScroll = () => {
      w.placed = true;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; latest.current(true); });
    };
    // A restore that found nothing to move scrolls nothing.
    const settle = setTimeout(() => { if (!w.placed) onScroll(); }, 100);
    const hand = () => { w.lastHand = performance.now(); };
    const down = () => { w.touching = true; hand(); };
    const up = () => { w.touching = false; hand(); };
    box.addEventListener("scroll", onScroll, { passive: true });
    box.addEventListener("touchstart", down, { passive: true });
    box.addEventListener("touchmove", hand, { passive: true });
    box.addEventListener("touchend", up, { passive: true });
    box.addEventListener("touchcancel", up, { passive: true });
    box.addEventListener("wheel", hand, { passive: true });
    const sizes = new ResizeObserver(() => latest.current());
    sizes.observe(box);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      clearTimeout(settle);
      sizes.disconnect();
      box.removeEventListener("scroll", onScroll);
      box.removeEventListener("touchstart", down);
      box.removeEventListener("touchmove", hand);
      box.removeEventListener("touchend", up);
      box.removeEventListener("touchcancel", up);
      box.removeEventListener("wheel", hand);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);

  const w = state.current;
  if (!on || !w) return null;
  // A screen of skeletons past each edge: the scroller moves a frame before
  // this hears of it, and a bare edge would show for that frame.
  const screen = w.bottom - w.top;
  const [v0, v1] = rangeOf(offsets, w.top - screen, w.bottom + screen);
  // Drawn before the flash finds it, and kept until the flash lets it go.
  const kept = w.held ?? (groupId ? peekSaved(groupId) : null);
  // From the few drawn, never a pass over all 10,000 slots on a fling's frame.
  const drawn: number[] = [];
  for (let i = v0; i < v1; i++) drawn.push(i);
  for (const key of kept === null ? w.filled : [...w.filled, kept]) {
    const i = indexOf.get(key);
    if (i !== undefined && (i < v0 || i >= v1)) drawn.push(i);
  }
  drawn.sort((x, y) => x - y);
  const filled = (i: number) => items[i]!.kind === "day" || items[i]!.key === kept || w.filled.has(items[i]!.key);
  return {
    offsets,
    indexOf,
    drawn,
    filled,
    listTop,
    pin: (top) => { w.pinned = top; latest.current(); },
    hold: (key) => { w.held = key; if (key === null) redraw(); },
  };
}

function flashSaved(
  groupId: string, box: HTMLElement, slot: (key: string) => HTMLElement | null,
  win?: Pick<Window, "pin" | "hold">,
): boolean {
  const id = peekSaved(groupId);
  if (!id) return true;
  const target = slot(id);
  if (!target) return false;
  win?.hold(id);
  clearSaved();
  target.classList.add("saved");
  const nearTop = () => {
    const view = box.getBoundingClientRect();
    return target.getBoundingClientRect().top - view.top + box.scrollTop < view.height / 2;
  };
  const toTop = nearTop();
  if (!toTop) letRoll(groupId);
  const release = () => {
    if (toTop) letRoll(groupId);
    target.classList.add("released");
    target.addEventListener("animationend", () => {
      target.classList.remove("saved", "released");
      win?.hold(null);
    }, { once: true });
  };
  // A windowed ledger fills where the glide lands before it gets there.
  const land = () => { win?.pin(null); setTimeout(release, SAVED_DWELL); };
  const fly = (top: number) => { win?.pin(top); glide(box, top, land); };
  setTimeout(() => {
    if (!target.isConnected) return;
    yieldPosition();
    const heads = target.previousElementSibling?.querySelector(":scope > .daylabel") ? target.previousElementSibling : null;
    const view = box.getBoundingClientRect();
    const fab = document.querySelector(".fab")?.getBoundingClientRect().top ?? view.bottom;
    const bar = document.querySelector(".searchdock:is([data-on], [data-held]) .searchclip")?.getBoundingClientRect().bottom ?? view.top;
    const band = { top: Math.max(view.top, bar), bottom: Math.min(view.bottom, fab) };
    if (toTop) {
      if (box.scrollTop === 0) release();
      else fly(0);
      return;
    }
    const reach = revealWhole(
      { top: (heads ?? target).getBoundingClientRect().top, bottom: target.getBoundingClientRect().bottom },
      band,
    );
    if (reach === 0) release();
    else fly(scrollTarget(box, reach));
  }, SAVED_BEAT);
  return true;
}

function arrive(slot: HTMLElement) {
  const h = slot.offsetHeight;
  slot.style.overflow = "hidden";
  const open = slot.animate([{ height: "0px" }, { height: `${h}px` }],
    { duration: OPEN_MS, easing: "cubic-bezier(.2, 0, 0, 1)" });
  // The slot's opacity, not the row's: it multiplies with a dimmed row's own.
  slot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, delay: OPEN_MS, fill: "backwards" });
  void open.finished.then(() => { slot.style.overflow = ""; }, () => {});
}

/**
 * What leaves fades, then the rows beneath close over it. The layout changes
 * once, as the fade starts, and the rows ride transforms held where they were
 * until it ends: a height moved frame by frame re-lays out every row under it
 * (docs/rows.md#gotchas). The line under the last row leaving is the line above
 * the row beneath, so that row carries it, onto the line above the gap.
 */
async function depart(slots: HTMLElement[], box: HTMLElement): Promise<void> {
  const all = [...slots[0]!.parentElement!.children] as HTMLElement[];
  const lastRow = slots.at(-1)!.querySelector<HTMLElement>(":scope > .row");
  const below = slots.at(-1)!.nextElementSibling as HTMLElement | null;
  const carry = lastRow && below?.querySelector(":scope > .row") ? below : null;
  const was = all.map((s) => s.getBoundingClientRect());

  const fades = slots.map((s) => s.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_OUT_MS, fill: "forwards" }));
  for (const s of slots) s.style.height = "0px";
  if (carry) carry.style.boxShadow = `0 -1px 0 ${getComputedStyle(lastRow!).borderBottomColor}`;

  // Only what shows, before or after: the rest move unseen.
  const view = box.getBoundingClientRect();
  const shows = (top: number, height: number) => view.bottom > top && top + height > view.top;
  const moves = all.flatMap((s, i) => {
    const { top, height } = was[i]!;
    const now = s.getBoundingClientRect().top;
    if (now === top || !(shows(top, height) || shows(now, height))) return [];
    return [s.animate([{ transform: `translateY(${top - now}px)` }, { transform: "none" }],
      { duration: FOLD_MS, delay: FADE_OUT_MS, easing: "cubic-bezier(.2, 0, 0, 1)", fill: "backwards" })];
  });
  await Promise.all([...fades, ...moves].map((a) => a.finished.catch(() => {})));
  if (carry) carry.style.boxShadow = "";
}
