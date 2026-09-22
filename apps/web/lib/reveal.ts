/**
 * Finding the thing a refusal is pointing at, when it is off the screen — on a
 * twenty-line bill the flash may land where nobody is looking.
 *
 * If *any* target is wholly on screen, flash where it stands; moving a list
 * under somebody who can see the answer is worse. Otherwise bring the nearest
 * in whole and flash when the scroll lands.
 *
 * Pure geometry, so it is testable without a DOM.
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
 * What to add to `scrollTop` to reach the nearest out-of-view row (least
 * scrolling), or `null` when one is in view already. Negative scrolls up.
 */
export function nearestOutOfView(rows: readonly RowBox[], band: ViewBand): number | null {
  let best: number | null = null;
  for (const row of rows) {
    const showing = Math.min(row.bottom, band.bottom) - Math.max(row.top, band.top);
    // In view means *all* of it — a name with its amount cut off by the fold
    // is a line you go looking for anyway. A row taller than the band counts
    // once it fills it.
    if (showing >= Math.min(row.bottom - row.top, band.bottom - band.top) - SLACK) return null;
    // Which way it lies is read off its top edge rather than off a gap: a row
    // half under the sticky header is above the fold, not below it.
    const delta = Math.round(row.top < band.top ? row.top - band.top : row.bottom - band.bottom);
    if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
  }
  return best;
}

/**
 * Where a scroll by `reach` actually lands, clamped to the scroller's ends.
 * Wait on this, not `scrollTop + reach`, or you wait for a position the
 * scroller can never report.
 */
export function scrollTarget(
  box: { scrollTop: number; scrollHeight: number; clientHeight: number },
  reach: number,
): number {
  return Math.max(0, Math.min(box.scrollTop + reach, box.scrollHeight - box.clientHeight));
}

/**
 * What to add to `scrollTop` to show all of one box (a just-opened run of
 * portions). **The top wins when it cannot all fit** — the label and first
 * portion say which line opened.
 */
export function revealWhole(box: RowBox, band: ViewBand): number {
  const tooTall = box.bottom - box.top > band.bottom - band.top + SLACK;
  if (tooTall || box.top < band.top - SLACK) return Math.round(box.top - band.top);
  if (box.bottom > band.bottom + SLACK) return Math.round(box.bottom - band.bottom);
  return 0;
}
