"use client";
// Doc: docs/live-reads.md

import { liveQuery } from "dexie";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { keep, mark, started } from "../diag";
import { db } from "./dexie";
import { signal } from "../signal";

/**
 * Every live read goes through `useLive`, never `useLiveQuery`: a query the
 * browser killed is swallowed by `liveQuery`, and the subscription is dead even
 * to writes (./live.test.ts). A hidden page reads nothing: a backgrounded copy
 * frozen mid-read holds its locks forever.
 */

const PROBE_MS = 6000;
const PROBES = 2;

interface Health {
  epoch: number;
  /** `indexedDB.open` has no timeout, so this is the only way to know. */
  blocked: boolean;
  stalls: number;
  hidden: boolean;
}

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

const health: Health = { epoch: 0, blocked: false, stalls: 0, hidden: isHidden() };
const changes = signal();
const { emit: announce, subscribe } = changes;

function resubscribeAll(): void {
  health.epoch += 1;
  health.blocked = false;
  for (const [memo, w] of warm) subscribeWarm(memo, w);
  announce();
}

const remembered = new Map<string, unknown>();

/**
 * A screen's reads stay subscribed for a while after it closes, keeping
 * `remembered` current: the screen comes back as it is now, rather than as it
 * was left and then moving into place. A couple of dozen, newest kept.
 */
const WARM = 24;
/** Clear of the next screen's own first read. */
const WARM_AFTER_MS = 400;

interface Warm {
  querier: () => Promise<unknown>;
  sub?: { unsubscribe(): void };
  timer?: ReturnType<typeof setTimeout>;
}
const warm = new Map<string, Warm>();

/** The querier as a hidden page must run it: from memory, opening nothing. */
function guarded<T>(memo: string, querier: () => Promise<T>): () => Promise<T | undefined> {
  return async () => isHidden() ? remembered.get(memo) as T | undefined : querier();
}

/**
 * A read answered again with what it already had keeps the object it had, so a
 * screen opened onto a remembered answer doesn't draw everything a second time
 * when its own read lands, and what is worked out from an answer is worked out
 * once (`derive`, lib/hooks.ts).
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameData(x, b[i]));
  }
  if (Array.isArray(b) || Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  // Rows are plain records; anything else is compared by identity.
  if (Object.getPrototypeOf(a) !== Object.prototype && Object.getPrototypeOf(a) !== null) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => k in b && sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Each fresh answer, to what is drawn in its place: compared once, not every render. */
const settledAs = new WeakMap<object, unknown>();

function answer(memo: string, value: unknown): unknown {
  if (value === undefined) return remembered.get(memo);
  if (typeof value === "object" && value !== null) {
    const known = settledAs.get(value);
    if (known !== undefined) return known;
    const prior = remembered.get(memo);
    const kept = prior !== undefined && sameData(value, prior) ? prior : value;
    settledAs.set(value, kept);
    remembered.set(memo, kept);
    return kept;
  }
  remembered.set(memo, value);
  return value;
}

function subscribeWarm(memo: string, w: Warm): void {
  clearTimeout(w.timer);
  w.sub?.unsubscribe();
  w.sub = liveQuery(w.querier).subscribe({
    next: (value) => { answer(memo, value); },
    error: () => coolDown(memo),
  });
}

function coolDown(memo: string): void {
  const w = warm.get(memo);
  if (!w) return;
  clearTimeout(w.timer);
  w.sub?.unsubscribe();
  warm.delete(memo);
}

/** How a screen readies the read of one it is likely to open next. */
export function keepWarm<T>(
  name: string, querier: () => Promise<T>, deps: readonly unknown[], { now = false } = {},
): void {
  warmUp(`${name} ${JSON.stringify(deps)}`, querier, now);
}

/**
 * `now` is for a tap already on its way to the screen that reads it: no wait,
 * since the screen's own read is about to start anyway and this one is ahead.
 */
function warmUp(memo: string, querier: () => Promise<unknown>, now = false): void {
  if (mounted.has(memo)) return;
  const held = warm.get(memo);
  if (held) {
    if (now && !held.sub) subscribeWarm(memo, held);
    return;
  }
  const w: Warm = { querier: guarded(memo, querier) };
  warm.set(memo, w);
  if (now) subscribeWarm(memo, w);
  else w.timer = setTimeout(() => mounted.has(memo) ? coolDown(memo) : subscribeWarm(memo, w), WARM_AFTER_MS);
  for (const oldest of warm.keys()) {
    if (warm.size <= WARM) break;
    coolDown(oldest);
  }
}

/** Reads a screen on display holds, which need no warm copy. */
const mounted = new Map<string, number>();

let lastReopen = -Infinity;
let reopening = false;

function reopen(): void {
  const now = Date.now();
  if (now - lastReopen < PROBE_MS) return;
  lastReopen = now;
  const done = started("db.reopen");
  reopening = true;
  try {
    db().close({ disableAutoOpen: false });
  } finally {
    reopening = false;
  }
  db().open().then(() => done(), (err: unknown) => done(`failed ${(err as Error)?.name ?? "?"}`));
}

let armed = false;

function arm(): void {
  if (armed) return;
  armed = true;
  keep();

  db().on("close", () => {
    if (!reopening) mark("db.close");
    resubscribeAll();
  });

  db().on("blocked", () => {
    mark("db.blocked");
    health.blocked = true;
    announce();
  });

  if (typeof document === "undefined") return;

  document.addEventListener("visibilitychange", () => {
    mark(`app.${document.visibilityState}`);
    health.hidden = isHidden();
    if (!health.hidden) resubscribeAll();
    else announce();
  });
}

function size(result: unknown): string {
  if (Array.isArray(result)) return `${result.length} rows`;
  if (result && typeof result === "object") {
    const counted = Object.values(result).filter(Array.isArray);
    if (counted.length) return `${counted.reduce((n, a) => n + a.length, 0)} rows`;
    return "1";
  }
  return result === undefined ? "nothing" : "1";
}

function addStall(): () => void {
  health.stalls += 1;
  announce();
  return () => {
    health.stalls -= 1;
    announce();
  };
}

export function useLive<T>(
  name: string, querier: () => Promise<T>, deps: readonly unknown[],
): T | undefined {
  useEffect(arm, []);

  const epoch = useSyncExternalStore(subscribe, () => health.epoch, () => 0);
  const blocked = useSyncExternalStore(subscribe, () => health.blocked, () => false);
  const hidden = useSyncExternalStore(subscribe, () => health.hidden, () => false);

  const key = JSON.stringify(deps);
  const latest = useRef(querier);
  useEffect(() => { latest.current = querier; });
  useEffect(() => {
    const memo = `${name} ${key}`;
    coolDown(memo);
    mounted.set(memo, (mounted.get(memo) ?? 0) + 1);
    return () => {
      const left = (mounted.get(memo) ?? 1) - 1;
      if (left > 0) return void mounted.set(memo, left);
      mounted.delete(memo);
      warmUp(memo, latest.current);
    };
  }, [name, key]);
  const [probe, setProbe] = useState({ key, n: 0 });
  const n = probe.key === key ? probe.n : 0;

  const label = `${name}${n > 0 ? ` retry#${n}` : ""}${epoch > 0 ? ` epoch#${epoch}` : ""}`;
  const memo = `${name} ${key}`;
  const timedQuerier = useMemo(() => async (): Promise<T | undefined> => {
    // Checked here, not in render: Dexie runs this whenever another copy writes,
    // which is exactly when we are hidden.
    if (isHidden()) {
      mark("live.skipped", label);
      return remembered.get(memo) as T | undefined;
    }
    const done = started("live", label);
    try {
      const result = await querier();
      done(`${label} ${size(result)}`);
      return result;
    } catch (err) {
      done(`${label} threw ${(err as Error)?.name ?? "?"}`);
      throw err;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, epoch, n, label, memo]);

  const value = useLiveQuery(timedQuerier, [key, epoch, n]);
  const waiting = value === undefined;
  const shown = answer(memo, value) as T | undefined;

  useEffect(() => {
    if (!waiting || hidden || n >= PROBES) return;
    const timer = setTimeout(() => {
      mark("live.retry", `${name} after ${PROBE_MS}ms with nothing`);
      if (n + 1 === PROBES) reopen();
      setProbe({ key, n: n + 1 });
    }, PROBE_MS);
    return () => clearTimeout(timer);
  }, [waiting, hidden, key, n, name]);

  const stalled = waiting && !hidden && (blocked || n >= PROBES);
  useEffect(() => {
    if (!stalled) return;
    mark("live.stalled", name);
    return addStall();
  }, [stalled, name]);

  return shown;
}

export function useStalled(): { stalled: boolean; blocked: boolean } {
  const stalls = useSyncExternalStore(subscribe, () => health.stalls, () => 0);
  const blocked = useSyncExternalStore(subscribe, () => health.blocked, () => false);
  return { stalled: stalls > 0, blocked };
}

export function retryLive(): void {
  lastReopen = -Infinity;
  reopen();
}

/** `arm` stays armed across `reset`, or `close` would subscribe twice. */
export const testing = {
  health,
  isHidden,
  arm,
  reopen,
  remembered,
  warm,
  WARM,
  subscribe,
  addStall,
  reset(): void {
    health.epoch = 0;
    health.blocked = false;
    health.stalls = 0;
    health.hidden = isHidden();
    changes.clear();
    remembered.clear();
    for (const memo of [...warm.keys()]) coolDown(memo);
    mounted.clear();
    lastReopen = -Infinity;
  },
};
