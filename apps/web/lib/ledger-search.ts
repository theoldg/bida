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

/**
 * What each group's ledger was last searched for, kept for the way back to it
 * like its position (lib/ledger-position.ts): a result opened and backed out
 * of returns to the results.
 */
const kept = new Map<string, string>();

/**
 * The query a ledger opens with. **Arriving any other way forgets the kept
 * one**, as the position is forgotten: kept past a tap into the group, it
 * would come back on the first way back from an entry opened from the blank
 * ledger, a search the visit never made.
 */
export function openingQuery(groupId: string, returning: boolean): string {
  if (!returning) kept.delete(groupId);
  return kept.get(groupId) ?? "";
}

export function keepQuery(groupId: string, query: string): void {
  if (query) kept.set(groupId, query);
  else kept.delete(groupId);
}
