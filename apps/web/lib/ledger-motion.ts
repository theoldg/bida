// Doc: docs/rows.md#the-ledger-moves

/** A date line or an entry: the ledger drawn as one flat list. */
export type LedgerItem<T> =
  | { key: string; kind: "day"; label: string }
  | { key: string; kind: "row"; row: T };

export type Shown<T> = LedgerItem<T> & { leaving?: true };

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

export const FADE_OUT_MS = 140;
export const FOLD_MS = 220;
export const OPEN_MS = 220;
export const FADE_IN_MS = 180;
export const STILL_MS = 300;
export const SAVED_BEAT = 600;
export const SAVED_DWELL = 600;

// ------------------------------------------------------------- the saved row

/**
 * Module state: the form and the ledger are never on screen together. It expires
 * so a save landing elsewhere can't flash a ledger opened later.
 */
const SAVED_FOR_MS = 10_000;
type Mark = { groupId: string; entryId: string; at: number } | null;
let saved: Mark = null;

const fresh = (mark: Mark, groupId: string, now: number) =>
  !mark || mark.groupId !== groupId || now - mark.at > SAVED_FOR_MS ? null : mark.entryId;

export function markSaved(groupId: string, entryId: string, now = Date.now()): void {
  saved = { groupId, entryId, at: now };
  rollLet.delete(groupId);
}

export function peekSaved(groupId: string, now = Date.now()): string | null {
  return fresh(saved, groupId, now);
}

export function clearSaved(): void {
  saved = null;
}

// ------------------------------------------------------------- the deleted row

/**
 * Deleted from its own screen, the entry is gone from the live read before the
 * ledger is back. So the ledger draws it where it was and lets it go a beat
 * later, on screen, with the roll.
 */
let deleted: Mark = null;

export function markDeleted(groupId: string, entryId: string, now = Date.now()): void {
  deleted = { groupId, entryId, at: now };
  rollLet.delete(groupId);
}

export function peekDeleted(groupId: string, now = Date.now()): string | null {
  return fresh(deleted, groupId, now);
}

export function clearDeleted(): void {
  deleted = null;
}

/**
 * The summary's roll waits for a saved row's glide, so the figure rolls on
 * screen, not off it.
 */
const rollWaiting = new Map<string, Set<() => void>>();
const rollLet = new Set<string>();

export function awaitRoll(groupId: string, go: () => void): () => void {
  if (rollLet.delete(groupId)) { go(); return () => {}; }
  const set = rollWaiting.get(groupId) ?? new Set();
  rollWaiting.set(groupId, set.add(go));
  return () => { set.delete(go); };
}

export function letRoll(groupId: string): void {
  const set = rollWaiting.get(groupId);
  rollWaiting.delete(groupId);
  if (!set?.size) rollLet.add(groupId);
  for (const go of set ?? []) go();
}
