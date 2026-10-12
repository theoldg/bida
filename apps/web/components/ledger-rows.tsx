"use client";
// Doc: docs/rows.md#the-ledger-moves

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  clearSaved, FADE_IN_MS, letRoll, FADE_OUT_MS, FOLD_MS, foldFrame, foldTotal, OPEN_MS, peekSaved,
  presence, runs, SAVED_BEAT, SAVED_DWELL, standard, STILL_MS, type LedgerItem, type Shown,
} from "@/lib/ledger-motion";
import { yieldPosition } from "@/lib/ledger-position";
import { revealWhole, scrollTarget } from "@/lib/reveal";
import { calmly, glide } from "@/lib/seek";

export function LedgerRows<T>({ groupId, items, row, opens = true }: {
  groupId?: string;
  items: LedgerItem<T>[];
  row: (row: T) => ReactNode;
  opens?: boolean;
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
    const down = () => { m.touching = true; };
    const up = () => { m.touching = false; m.scrolled = Date.now(); };
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

  const drawn = useRef<Set<string> | null>(null);
  const busy = useRef(new Set<string>());
  const flashed = useRef(false);

  useLayoutEffect(() => {
    const box = scroller();
    const list = root.current;
    if (!box || !list) return;
    const slot = (key: string) => list.querySelector<HTMLElement>(`:scope > [data-key="${CSS.escape(key)}"]`);
    const keys = drawing.map((i) => i.key);
    const leaving = new Set(drawing.filter((i) => i.leaving).map((i) => i.key));
    const before = drawn.current;
    drawn.current = new Set(keys);

    // The live query can answer before the save's write lands, so the saved row
    // may turn up a commit late.
    let saved: string | null = null;
    if (!flashed.current && groupId) {
      saved = peekSaved(groupId);
      flashed.current = flashSaved(groupId, box, slot);
    }
    if (!before) return;

    const hadRows = drawing.some((i) => i.kind === "row" && before.has(i.key));
    for (const run of runs(keys, (k) => !before.has(k) && !leaving.has(k))) {
      if (!hadRows) break;
      const slots = run.map(slot).filter((s): s is HTMLElement => s !== null);
      const top = slots[0]?.getBoundingClientRect().top ?? 0;
      if (top < box.getBoundingClientRect().top) {
        box.scrollTop += slots.reduce((n, s) => n + s.offsetHeight, 0);
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
      if (slots.length === 0) done();
      else if (bottom <= box.getBoundingClientRect().top + 1) {
        const h = slots.reduce((n, s) => n + s.offsetHeight, 0);
        for (const s of slots) s.style.height = "0px";
        box.scrollTop -= h;
        done();
      } else if (calmly()) done();
      else void depart(slots).then(done);
    }
  });

  return (
    <div className="rows lrows" ref={root}>
      {drawing.map((item) => (
        <div key={item.key} className="lslot" data-key={item.key} data-leaving={item.leaving ? "" : undefined}>
          {item.kind === "day" ? <div className="daylabel">{item.label}</div> : row(item.row)}
        </div>
      ))}
    </div>
  );
}

function flashSaved(groupId: string, box: HTMLElement, slot: (key: string) => HTMLElement | null): boolean {
  const id = peekSaved(groupId);
  if (!id) return true;
  const target = slot(id);
  if (!target) return false;
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
    target.addEventListener("animationend", () => target.classList.remove("saved", "released"), { once: true });
  };
  const land = () => setTimeout(release, SAVED_DWELL);
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
      else glide(box, 0, land);
      return;
    }
    const reach = revealWhole(
      { top: (heads ?? target).getBoundingClientRect().top, bottom: target.getBoundingClientRect().bottom },
      band,
    );
    if (reach === 0) release();
    else glide(box, scrollTarget(box, reach), land);
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

async function depart(slots: HTMLElement[]): Promise<void> {
  const last = slots.at(-1)!;
  const lastRow = last.querySelector<HTMLElement>(":scope > .row");
  const line = lastRow ? getComputedStyle(lastRow).borderBottomColor : "";
  const carry = lastRow !== null && last.nextElementSibling?.querySelector(":scope > .row") != null;
  for (const s of slots) { s.style.overflow = "hidden"; s.style.boxSizing = "content-box"; }
  if (carry && lastRow) {
    lastRow.style.borderBottomWidth = "0";
    last.style.borderBottom = `1px solid ${line}`;
  }
  const heights = slots.map((s) => s.offsetHeight - (s === last && carry ? 1 : 0));

  const rows = slots.map((s) => s.querySelector<HTMLElement>(":scope > .row")).filter((r): r is HTMLElement => r !== null);
  await Promise.all(rows.map((r) =>
    r.animate([{ opacity: getComputedStyle(r).opacity }, { opacity: 0 }], { duration: FADE_OUT_MS, fill: "forwards" })
      .finished.catch(() => {})));

  const total = foldTotal(heights, carry);
  await new Promise<void>((done) => {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / FOLD_MS);
      const frame = foldFrame(heights, total * standard(t), carry);
      slots.forEach((s, i) => { s.style.height = `${frame.heights[i]}px`; });
      if (carry) last.style.marginTop = `${-frame.lift}px`;
      if (t < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}
