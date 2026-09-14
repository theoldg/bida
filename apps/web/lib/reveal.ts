/**
 * Finding the thing a refusal is pointing at, when it is off the screen.
 *
 * A refusal points rather than explains (docs/design-system.md), which works
 * only while what blooms is in view. A twenty-line bill is the case the
 * who-had-what grid exists for, and the lines nobody has been given can all be
 * scrolled past — a Done pressed there flashes red where nobody is looking,
 * which is a press that did nothing as far as the person can tell.
 *
 * So the scroller is asked first: is *any* of them on screen? If one is, the
 * flash goes ahead where it stands — moving a list under somebody who can
 * already see the answer is worse than not moving it. If none is, the nearest
 * is brought in and the flash waits for the scroll to land.
 *
 * The geometry is here and the scrolling is not: what this decides is worth a
 * test, and none of it needs a DOM.
 */

/** One candidate, measured against the same viewport as the band. */
export interface RowBox { top: number; bottom: number }

/**
 * The strip of the scroller a row can actually be seen in: its box, less
 * anything drawn over it. The grid's header is sticky, so a row scrolled flush
 * to the top of the scroller is underneath it.
 */
export interface ViewBand { top: number; bottom: number }

/**
 * How much of a row has to be showing to count as seen. A line of it is
 * enough — this is asking whether a person would notice it go red, not whether
 * they can read it — and a sliver under the sticky header is not.
 */
const SEEN = 14;

/**
 * What to add to the scroller's `scrollTop` to reach the nearest row that is
 * out of view, or `null` when one of them is in view already and nothing needs
 * to move. Negative scrolls up.
 *
 * Nearest is the least scrolling, so a row just above the fold wins over one
 * twelve lines below it, and each row is reached by the smallest move that
 * shows it whole.
 */
export function nearestOutOfView(rows: readonly RowBox[], band: ViewBand): number | null {
  let best: number | null = null;
  for (const row of rows) {
    const showing = Math.min(row.bottom, band.bottom) - Math.max(row.top, band.top);
    // A row taller than the band, or one shorter than `SEEN`, is in view as
    // soon as all of it that can be is.
    if (showing >= Math.min(SEEN, row.bottom - row.top, band.bottom - band.top)) return null;
    // Which way it lies is read off its top edge rather than off a gap: a row
    // half under the sticky header is above the fold, not below it.
    const delta = Math.round(row.top < band.top ? row.top - band.top : row.bottom - band.bottom);
    if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
  }
  return best;
}
