/**
 * How the ledger's list moves when it changes under somebody looking at it
 * (components/ledger-rows.tsx): the pure half — which items are leaving, how
 * a fold spends its height, and the hand-off that tells the ledger which row a
 * save just wrote. The DOM half measures and paints; this is what it asks.
 */

/** A date line or an entry: the ledger drawn as one flat list. */
export type LedgerItem<T> =
  | { key: string; kind: "day"; label: string }
  | { key: string; kind: "row"; row: T };

/** An item as drawn: `leaving` ones are still on screen, folding away. */
export type Shown<T> = LedgerItem<T> & { leaving?: true };

/**
 * The next list, with whatever the last one drew and this one lacks kept in
 * place as `leaving` — each after the nearest item above it that survives, so
 * a row folds where it stood rather than jumping to the end. What the last
 * one had leaving and this one has again (a restored entry) simply stays.
 */
export function presence<T>(prev: readonly Shown<T>[], next: readonly LedgerItem<T>[]): Shown<T>[] {
  const keep = new Set(next.map((i) => i.key));
  const after = new Map<string | null, Shown<T>[]>();
  let anchor: string | null = null;
  for (const item of prev) {
    if (keep.has(item.key)) { anchor = item.key; continue; }
    const gone: Shown<T> = item.leaving ? item : { ...item, leaving: true };
    after.set(anchor, [...after.get(anchor) ?? [], gone]);
  }
  if (after.size === 0) return [...next];
  const out: Shown<T>[] = [...after.get(null) ?? []];
  for (const item of next) out.push(item, ...after.get(item.key) ?? []);
  return out;
}

/** Keys in order, cut into runs of neighbours that all pass `test`. */
export function runs(keys: readonly string[], test: (key: string) => boolean): string[][] {
  const out: string[][] = [];
  let run: string[] = [];
  for (const key of keys) {
    if (test(key)) { run.push(key); continue; }
    if (run.length) out.push(run);
    run = [];
  }
  if (run.length) out.push(run);
  return out;
}

// ------------------------------------------------------------- folding

/**
 * One frame of a fold: `heights` top-down, `removed` pixels into it. The
 * bottom slot gives first and the top one last, so a date line left with no
 * rows is the last thing to go and reads whole for as long as it has room.
 * With `carry`, the bottom slot keeps 1px — the divider under the row it held,
 * which is the line above whatever comes next — until a final pixel of
 * `lift` lays it on the line above the run, and the two are one.
 */
export function foldFrame(heights: readonly number[], removed: number, carry: boolean):
  { heights: number[]; lift: number } {
  const out = [...heights];
  let left = removed;
  for (let i = out.length - 1; i >= 0; i--) {
    const give = Math.max(0, Math.min(out[i]!, left));
    out[i] = out[i]! - give;
    left -= heights[i]!;
  }
  return { heights: out, lift: carry ? Math.max(0, Math.min(1, left)) : 0 };
}

/** The whole of a fold: every slot's height, and the carried pixel if any. */
export function foldTotal(heights: readonly number[], carry: boolean): number {
  return heights.reduce((n, h) => n + h, 0) + (carry ? 1 : 0);
}

/**
 * The fold's curve: CSS's `cubic-bezier(.2, 0, 0, 1)`, the one the opening
 * gap uses, solved for a frame-by-frame fold that CSS can't run — several
 * slots giving up height in turn.
 */
export function standard(t: number): number {
  const at = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  const x = Math.min(1, Math.max(0, t));
  let lo = 0, hi = 1, u = x;
  for (let i = 0; i < 30; i++) {
    u = (lo + hi) / 2;
    if (at(0.2, 0, u) < x) lo = u; else hi = u;
  }
  return at(0, 1, u);
}

/** Leaving: the content fades, then the space closes. Arriving: the reverse. */
export const FADE_OUT_MS = 140;
export const FOLD_MS = 220;
export const OPEN_MS = 220;
export const FADE_IN_MS = 180;
/** A list moving under a finger, or gliding after one, holds its changes this long past the last scroll. */
export const STILL_MS = 300;

// ------------------------------------------------------------- the saved row

/**
 * What a save just wrote, for the ledger it lands on: that row is brought
 * into view and flashed. Module state, since the form and the ledger are
 * never on screen together and the hand-off is one navigation long; it
 * expires so a save landing elsewhere can't flash a ledger opened later.
 */
const SAVED_FOR_MS = 10_000;
let saved: { groupId: string; entryId: string; at: number } | null = null;

export function markSaved(groupId: string, entryId: string, now = Date.now()): void {
  saved = { groupId, entryId, at: now };
}

/** The entry to flash, if a save for this group is still fresh; it stays until `clearSaved`. */
export function peekSaved(groupId: string, now = Date.now()): string | null {
  if (!saved || saved.groupId !== groupId || now - saved.at > SAVED_FOR_MS) return null;
  return saved.entryId;
}

export function clearSaved(): void {
  saved = null;
}
