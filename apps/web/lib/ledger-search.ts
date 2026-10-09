/**
 * How much of the bar the scroll has brought out, 0 to 1. **Tied to the
 * scroll, not set off by it**: over the last bar's height the list travels to
 * the base state, each pixel of its brings a pixel of the bar, so the bar is
 * whole exactly as the first row meets its foot — and wholly away with the
 * list at its top, where a head shorter than the bar has the whole of that
 * travel bring it instead.
 */
export function shownAt(scrollTop: number, base: number, bar: number): number {
  const span = Math.min(bar, base);
  return span <= 0 ? 1 : Math.min(1, Math.max(0, 1 - (base - scrollTop) / span));
}
