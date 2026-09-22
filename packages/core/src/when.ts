/**
 * Which local day a stamp falls in. Whether an entry has a *time* can't be
 * read off the stamp — that is `dateOnly` (types.ts).
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
