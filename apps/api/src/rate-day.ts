/**
 * A past day, as the rate feed names its dated releases ("2026-10-05"); null
 * for anything else, today and the future included, which ask for the latest.
 * Compared in UTC, the feed's own calendar.
 */
export function pastDay(raw: string | undefined, now: number): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const day = Date.parse(`${raw}T00:00:00Z`);
  // Rejects a day the calendar hasn't got: "2026-02-30" parses, and rolls over.
  if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== raw) return null;
  return raw < new Date(now).toISOString().slice(0, 10) ? raw : null;
}
