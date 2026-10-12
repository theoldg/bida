"use client";
// Doc: docs/live-reads.md

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
  announce();
}

const remembered = new Map<string, unknown>();

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
  if (!waiting) remembered.set(memo, value);

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

  return waiting ? remembered.get(memo) as T | undefined : value;
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
  subscribe,
  addStall,
  reset(): void {
    health.epoch = 0;
    health.blocked = false;
    health.stalls = 0;
    health.hidden = isHidden();
    changes.clear();
    remembered.clear();
    lastReopen = -Infinity;
  },
};
