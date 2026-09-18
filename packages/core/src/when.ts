/**
 * Which local day a stamp falls in.
 *
 * Whether an entry has a *time* is not read off its stamp — nothing here can
 * tell midnight the moment from midnight the empty field. The entry says so
 * itself, in `dateOnly` (types.ts), and this file only ever answers the
 * question a ledger groups and sorts by: which day.
 */

/** Whether two stamps fall on the same local day. */
export function sameLocalDay(a: number, b: number): boolean {
  return startOfLocalDay(a) === startOfLocalDay(b);
}

/** Local midnight of the day a stamp falls in. */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
