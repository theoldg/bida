// Doc: docs/rows.md#the-ledger-draws-what-is-near-the-screen
import type { LedgerItem } from "./ledger-motion";

/**
 * The arithmetic of a ledger drawn only near the screen. Every slot's height
 * is known without drawing it — a row is one height whatever it carries, a
 * date line another (docs/rows.md) — so where anything sits is a sum, and the
 * scroller is the full height from the first frame.
 */

/**
 * **An experiment, hard-coded on (the owner, 2026-10-12)**: twelve rows drawn
 * at a time, filled 400ms after a scroll asks for them, to try a slow phone's
 * worst case by hand. Not for a release: see docs/implementation-status.md.
 */
export const WINDOW_ROWS = 12;
export const FILL_DELAY_MS = 400;

/**
 * Rows kept drawn past the window, the furthest let go first: enough to scroll
 * back over without waiting, few enough that a data change landing re-renders
 * a bounded list and leaving costs the same after any scroll.
 */
export const KEEP_ROWS = 150;

export interface Heights { row: number; day: number }

/** Which of `kept` (key → index) go, furthest from `center` first, to fit `cap`. */
export function overCap(kept: ReadonlyMap<string, number>, center: number, cap: number): string[] {
  if (kept.size <= cap) return [];
  return [...kept].sort((a, b) => Math.abs(b[1] - center) - Math.abs(a[1] - center))
    .slice(0, kept.size - cap).map(([key]) => key);
}

/** `offsets[i]` is where item `i` starts; the last entry is the whole height. */
export function offsetsOf<T>(items: readonly LedgerItem<T>[], h: Heights): number[] {
  const out = new Array<number>(items.length + 1);
  out[0] = 0;
  for (let i = 0; i < items.length; i++) out[i + 1] = out[i]! + (items[i]!.kind === "day" ? h.day : h.row);
  return out;
}

/** The item under `y`, clamped to the list. */
export function indexAt(offsets: readonly number[], y: number): number {
  const n = offsets.length - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** The items any part of which lies between `top` and `bottom`: `[from, to)`. */
export function rangeOf(offsets: readonly number[], top: number, bottom: number): [number, number] {
  const n = offsets.length - 1;
  if (n <= 0 || bottom <= 0 || top >= offsets[n]!) return [0, 0];
  const from = indexAt(offsets, Math.max(0, top));
  let to = indexAt(offsets, bottom);
  if (offsets[to]! < bottom) to += 1;
  return [from, Math.min(n, to)];
}

/**
 * `rows` rows around `center`, half each side where the list allows, and the
 * date lines among them: `[from, to)`.
 */
export function windowAround<T>(items: readonly LedgerItem<T>[], center: number, rows: number): [number, number] {
  const n = items.length;
  if (n === 0) return [0, 0];
  let from = Math.min(Math.max(0, center), n - 1);
  let to = from;
  let count = 0;
  let upward = true;
  // Out from the centre, alternating, until enough rows or no list left.
  while (count < rows && (from > 0 || to < n)) {
    if ((upward && from > 0) || to >= n) {
      from -= 1;
      if (items[from]!.kind === "row") count += 1;
    } else {
      if (items[to]!.kind === "row") count += 1;
      to += 1;
    }
    upward = !upward;
  }
  return [from, to];
}

/**
 * How long a fling has left, as its speed times this. Momentum decays by
 * about 0.2% a millisecond on iOS (`UIScrollView.DecelerationRate.normal`),
 * so the distance still to go is speed × 1 / −ln 0.998 ≈ 500ms, whatever it
 * has already travelled. Android's fling ends near enough the same place.
 */
export const COAST_MS = 500;

/** Speed in px/ms over the samples kept, newest last. */
export function speedOf(samples: readonly { t: number; y: number }[]): number {
  if (samples.length < 2) return 0;
  const a = samples[0]!;
  const b = samples.at(-1)!;
  return b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
}

/**
 * Where a scroll moving at `speed` will come to rest, clamped to the
 * scroller — or `null` when it will travel less than a screen, and filling
 * where it is now is the better bet.
 */
export function landingOf(top: number, speed: number, view: number, max: number): number | null {
  const coast = speed * COAST_MS;
  if (Math.abs(coast) < view) return null;
  return Math.max(0, Math.min(max, top + coast));
}

/** A run of slots to draw, or the height of a run left undrawn. */
export type Gap = { gap: number; first: number };
export type Segment = { at: number } | Gap;

export function isGap(seg: Segment): seg is Gap {
  return "gap" in seg;
}

export function segmentsOf(offsets: readonly number[], drawn: (i: number) => boolean): Segment[] {
  const out: Segment[] = [];
  const n = offsets.length - 1;
  let gapFrom = -1;
  for (let i = 0; i <= n; i++) {
    const draw = i < n && drawn(i);
    if (!draw && i < n) { if (gapFrom < 0) gapFrom = i; continue; }
    if (gapFrom >= 0) {
      out.push({ gap: offsets[i]! - offsets[gapFrom]!, first: gapFrom });
      gapFrom = -1;
    }
    if (draw) out.push({ at: i });
  }
  return out;
}
