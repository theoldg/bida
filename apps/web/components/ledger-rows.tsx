"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  clearSaved, FADE_IN_MS, FADE_OUT_MS, FOLD_MS, foldFrame, foldTotal, OPEN_MS, peekSaved,
  presence, runs, SAVED_BEAT, standard, STILL_MS, type LedgerItem, type Shown,
} from "@/lib/ledger-motion";
import { yieldPosition } from "@/lib/ledger-position";
import { revealWhole, scrollTarget } from "@/lib/reveal";
import { calmly, glide } from "@/lib/seek";

/**
 * The ledger's rows, and how they move when the list changes under somebody
 * looking at it (docs/design-system.md#the-ledger-moves):
 *
 * - **A row this phone just saved** is brought into view whole — only as far
 *   as it has to, and only if it isn't already, or to the very top when it is
 *   near the top anyway — under a wash it wears from the first frame, and the
 *   wash lets go once it lands.
 * - **A row that goes** fades, then its space folds. The divider under it
 *   stays, rides up on the row beneath and settles on the line above; a date
 *   line left with nothing under it folds last.
 * - **A row that arrives** (another phone's) opens a gap and fills it. Above
 *   what you're reading, it grows the list upward instead, so nothing under
 *   your eye moves — and a list moving under a finger, or still gliding, takes
 *   no change until it stops.
 * - **The last row going** takes no motion: the list is simply gone, and the
 *   screen's empty state stands in its place at once.
 *
 * The groups list uses it too, for a forgotten group: no `groupId`, so no
 * saved row, and `opens={false}` — a group turning up just appears.
 */
export function LedgerRows<T>({ groupId, items, row, opens = true }: {
  groupId?: string;
  items: LedgerItem<T>[];
  row: (row: T) => ReactNode;
  opens?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = () => root.current?.closest<HTMLElement>(".scroll") ?? null;

  // What is drawn lags `items` while the list is moving: a row appearing
  // mid-fling lands somewhere nobody is looking, and holding the view still
  // for it would stop the fling dead on iOS.
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

  // What is drawn: `applied`, plus whatever is still folding out of it.
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

    // Back from a save, the live query can answer before the write lands
    // (docs/frontend.md), so the saved row may turn up a commit late. It is
    // held still for like any arrival, but not opened: it was already there.
    let saved: string | null = null;
    if (!flashed.current && groupId) {
      saved = peekSaved(groupId);
      flashed.current = flashSaved(groupId, box, slot);
    }
    if (!before) return;

    // Arrivals, top-down: each measured after the ones above it have landed.
    // Into an empty ledger (a first pull) nothing opens; it just appears.
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

    // Departures: a run of neighbours leaving together folds as one.
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
        // Wholly above the view: out at once, and the view held where it was.
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

/**
 * The row the last save wrote, if it is here: washed before the first paint,
 * then — from wherever the ledger was put back to — brought whole into the strip above the floating buttons after the ledger has
 * been up a beat — as far as it must and no further, date line included when
 * it heads its day — and let go when it lands. True once there is nothing left
 * to wait for.
 */
function flashSaved(groupId: string, box: HTMLElement, slot: (key: string) => HTMLElement | null): boolean {
  const id = peekSaved(groupId);
  if (!id) return true;
  const target = slot(id);
  if (!target) return false;
  clearSaved();
  target.classList.add("saved");
  const release = () => {
    target.classList.add("released");
    target.addEventListener("animationend", () => target.classList.remove("saved", "released"), { once: true });
  };
  setTimeout(() => {
    if (!target.isConnected) return;
    // Back from a save the ledger was first put back where it was left
    // (lib/ledger-position.ts); from there, this row is the next thing.
    yieldPosition();
    const heads = target.previousElementSibling?.querySelector(":scope > .daylabel") ? target.previousElementSibling : null;
    const view = box.getBoundingClientRect();
    // The buttons float over the foot of the list; a row under them is not in view.
    const fab = document.querySelector(".fab")?.getBoundingClientRect().top ?? view.bottom;
    const band = { top: view.top, bottom: Math.min(view.bottom, fab) };
    // A row that would sit in the top half of the screen with the list at its
    // very top goes there instead, so the summary banner shows with it: what
    // the save changed, beside the row that changed it.
    const fromTop = target.getBoundingClientRect().top - view.top + box.scrollTop;
    if (fromTop < view.height / 2) {
      if (box.scrollTop === 0) release();
      else glide(box, 0, release);
      return;
    }
    const reach = revealWhole(
      { top: (heads ?? target).getBoundingClientRect().top, bottom: target.getBoundingClientRect().bottom },
      band,
    );
    if (reach === 0) release();
    else glide(box, scrollTarget(box, reach), release);
  }, SAVED_BEAT);
  return true;
}

/** Opens a new slot's gap, then fades it in — to the row's own strength, a dimmed row included. */
function arrive(slot: HTMLElement) {
  const h = slot.offsetHeight;
  slot.style.overflow = "hidden";
  const open = slot.animate([{ height: "0px" }, { height: `${h}px` }],
    { duration: OPEN_MS, easing: "cubic-bezier(.2, 0, 0, 1)" });
  // The slot's opacity, not the row's: it multiplies with a dimmed row's
  // own rather than overriding it and snapping back.
  slot.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, delay: OPEN_MS, fill: "backwards" });
  void open.finished.then(() => { slot.style.overflow = ""; }, () => {});
}

/**
 * Fades a run's rows, then folds the run bottom-up (`foldFrame`). The divider
 * under the last row is the line above what follows, so it comes off the row
 * onto the slot, stays while the row fades, and rides up to the line above.
 */
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
