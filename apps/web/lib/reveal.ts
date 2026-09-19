/**
 * Finding the thing a refusal is pointing at, when it is off the screen.
 *
 * A refusal points rather than explains (docs/design-system.md), which works
 * only while what blooms is in view. A twenty-line bill is the case the
 * who-had-what grid exists for, and the lines nobody has been given can all be
 * scrolled past — a Done pressed there flashes red where nobody is looking,
 * which is a press that did nothing as far as the person can tell.
 *
 * So the scroller is asked first: is *any* of them wholly on screen? If one is,
 * the flash goes ahead where it stands — moving a list under somebody who can
 * already see the answer is worse than not moving it. If none is, the nearest
 * is brought in whole and the flash waits for the scroll to land.
 *
 * The geometry is here and the scrolling is not: what this decides is worth a
 * test, and none of it needs a DOM.
 */

/** One candidate, measured against the same viewport as the band. */
interface RowBox { top: number; bottom: number }

/**
 * The strip of the scroller a row can actually be seen in: its box, less
 * anything drawn over it. The grid's header is sticky, so a row scrolled flush
 * to the top of the scroller is underneath it.
 */
interface ViewBand { top: number; bottom: number }

/**
 * Sub-pixel slack. A row is measured in fractions of a pixel and the band it
 * sits in is too, so "all of it is showing" has to mean *near enough*, or a
 * row flush against the fold is chased by a scroll of half a pixel.
 */
const SLACK = 1;

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
    // In view means *all* of it: a name with its amount cut off by the fold is
    // a line you have to go looking for anyway, so the flash goes where it can
    // be read whole. A row taller than the band is in view once it fills it.
    if (showing >= Math.min(row.bottom - row.top, band.bottom - band.top) - SLACK) return null;
    // Which way it lies is read off its top edge rather than off a gap: a row
    // half under the sticky header is above the fold, not below it.
    const delta = Math.round(row.top < band.top ? row.top - band.top : row.bottom - band.bottom);
    if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
  }
  return best;
}

/**
 * Where a scroll by `reach` actually lands: a scroller stops at its ends, so a
 * row near the foot of the list is reached as far as the list goes and no
 * further. What a caller waits on has to be this, not `scrollTop + reach`, or
 * it waits for a position the scroller can never report.
 */
export function scrollTarget(
  box: { scrollTop: number; scrollHeight: number; clientHeight: number },
  reach: number,
): number {
  return Math.max(0, Math.min(box.scrollTop + reach, box.scrollHeight - box.clientHeight));
}

/**
 * What to add to `scrollTop` to show all of one box — a run of portions just
 * opened, whose first and last row are one thing now.
 *
 * **The top wins when it cannot all fit.** A run of six portions in a band that
 * holds four has to start somewhere, and starting at its head is the only
 * choice that reads: the label and the first portion are what says which line
 * opened, and the rest is plainly below.
 */
export function revealWhole(box: RowBox, band: ViewBand): number {
  const tooTall = box.bottom - box.top > band.bottom - band.top + SLACK;
  if (tooTall || box.top < band.top - SLACK) return Math.round(box.top - band.top);
  if (box.bottom > band.bottom + SLACK) return Math.round(box.bottom - band.bottom);
  return 0;
}
