/**
 * What an entry's `occurredAt` means.
 *
 * One number carries two different facts: a **moment**, for an entry somebody
 * typed, and a bare **day**, for a backdated receipt that never printed a time
 * (`normalizeScan`). Local midnight is how the second one is written down —
 * so a stamp that is a moment must never land there, which is `timedStamp`'s
 * whole job. That is what lets `isDateOnly` be a plain equality test rather
 * than a guess about what the number was supposed to mean.
 */

/** Local midnight of the day a stamp falls in. */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** A day with no time of day: exactly local midnight. */
export function isDateOnly(ts: number): boolean {
  return ts === startOfLocalDay(ts);
}

/**
 * A clock reading, made safe to store as an entry's stamp: one millisecond
 * past midnight when it lands exactly on midnight. Every stamp read off a
 * clock goes through here.
 *
 * A millisecond is nothing; being mistaken for a day without a time is not —
 * that row would lose the time it actually has and jump to the head of its
 * day, which is the one place an entry stamped 00:00 does not belong. It
 * happens about once in 86 million entries, and the cost of never having to
 * think about it again is this function.
 */
export function timedStamp(ts: number): number {
  return isDateOnly(ts) ? ts + 1 : ts;
}
