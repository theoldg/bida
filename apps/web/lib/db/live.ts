"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { keep, mark, started } from "../diag";
import { db } from "./dexie";
import { signal } from "../signal";

/**
 * Reading from Dexie, and noticing when the read never comes back.
 *
 * **Every live read goes through `useLive`, never `useLiveQuery`.** A query
 * the browser killed (Android aborting a frozen PWA, Chrome under storage
 * pressure) is swallowed by `liveQuery`: nothing is emitted and the
 * subscription is dead, even to writes (./live.test.ts). A dead subscription
 * can only be replaced — on close, on return to the foreground, and when a
 * read takes too long — and every read shows its last answer meanwhile.
 *
 * **A hidden page reads nothing.** Dexie re-runs every copy's queriers on any
 * write, and a backgrounded copy frozen mid-read holds its locks forever, so
 * the next `appendOps` never returns. Hidden, a querier answers from
 * `remembered`; returning bumps `epoch` and every read restarts.
 */

const PROBE_MS = 6000;
/** Re-subscribes before the stall notice stands. */
const PROBES = 2;

interface Health {
  /** Bumped to re-subscribe every live read; in every query's deps. */
  epoch: number;
  /**
   * An upgrade blocked by another copy on the older version. `indexedDB.open`
   * has no timeout, so this is the only way to know.
   */
  blocked: boolean;
  /** Mounted reads that have given up. */
  stalls: number;
  /** In the store, not read in render, so the watchdog re-evaluates on change. */
  hidden: boolean;
}

/** Read live: a querier runs long after the render that built it. */
function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

const health: Health = { epoch: 0, blocked: false, stalls: 0, hidden: isHidden() };
const changes = signal();
const { emit: announce, subscribe } = changes;

function resubscribeAll(): void {
  health.epoch += 1;
  // If the block persists, the next open says so again.
  health.blocked = false;
  announce();
}

/**
 * Each read's last answer, by name and deps, for the life of the page —
 * `useLiveQuery` keeps values per component, so every navigation would start
 * from skeleton rows.
 */
const remembered = new Map<string, unknown>();

/** At most one reopen per probe window, however many reads give up in it. */
let lastReopen = -Infinity;
/** Set while *we* close the connection, so `on('close')` doesn't log it as the browser's. */
let reopening = false;

/**
 * A new connection: the one lever on a read stuck behind a lock. `close` lets
 * running transactions finish.
 */
function reopen(): void {
  const now = Date.now();
  if (now - lastReopen < PROBE_MS) return;
  lastReopen = now;
  const done = started("db.reopen");
  reopening = true;
  try {
    // Fires `close`, which moves every read onto the new connection.
    db().close({ disableAutoOpen: false });
  } finally {
    reopening = false;
  }
  db().open().then(() => done(), (err: unknown) => done(`failed ${(err as Error)?.name ?? "?"}`));
}

let armed = false;

/** Listen for what kills a subscription silently. Once per page. */
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

  // The static export and the tests have no DOM.
  if (typeof document === "undefined") return;

  // An installed app is resumed far more than launched, so this is the
  // common repair for a subscription that died in the background.
  document.addEventListener("visibilitychange", () => {
    mark(`app.${document.visibilityState}`);
    health.hidden = isHidden();
    if (!health.hidden) resubscribeAll();
    else announce();
  });
}

/** Rough on purpose: a size for the timeline, not data. */
function size(result: unknown): string {
  if (Array.isArray(result)) return `${result.length} rows`;
  if (result && typeof result === "object") {
    const counted = Object.values(result).filter(Array.isArray);
    if (counted.length) return `${counted.reduce((n, a) => n + a.length, 0)} rows`;
    return "1";
  }
  return result === undefined ? "nothing" : "1";
}

/** Returns the undo. */
function addStall(): () => void {
  health.stalls += 1;
  announce();
  return () => {
    health.stalls -= 1;
    announce();
  };
}

/**
 * `useLiveQuery`'s contract — `undefined` until the first value — except that
 * a lasting `undefined` becomes a notice (`useStalled`). `name` labels the read
 * on the /diag timeline.
 */
export function useLive<T>(
  name: string, querier: () => Promise<T>, deps: readonly unknown[],
): T | undefined {
  useEffect(arm, []);

  const epoch = useSyncExternalStore(subscribe, () => health.epoch, () => 0);
  const blocked = useSyncExternalStore(subscribe, () => health.blocked, () => false);
  const hidden = useSyncExternalStore(subscribe, () => health.hidden, () => false);

  const key = JSON.stringify(deps);
  const [probe, setProbe] = useState({ key, n: 0 });
  // Derived in render, so a new `key` restarts its watchdog on the same render.
  const n = probe.key === key ? probe.n : 0;

  const label = `${name}${n > 0 ? ` retry#${n}` : ""}${epoch > 0 ? ` epoch#${epoch}` : ""}`;
  const memo = `${name} ${key}`;
  const timedQuerier = useMemo(() => async (): Promise<T | undefined> => {
    // Checked here, not in render: Dexie runs this whenever another copy
    // writes, which is exactly when we are hidden.
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
    // `querier` is a fresh closure every render; `deps` is what re-subscribes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, epoch, n, label, memo]);

  const value = useLiveQuery(timedQuerier, [key, epoch, n]);
  // A remembered answer on screen is still a read that hasn't come back.
  const waiting = value === undefined;
  if (!waiting) remembered.set(memo, value);

  useEffect(() => {
    // A background page must not reopen the connection.
    if (!waiting || hidden || n >= PROBES) return;
    const timer = setTimeout(() => {
      mark("live.retry", `${name} after ${PROBE_MS}ms with nothing`);
      if (n + 1 === PROBES) reopen();
      setProbe({ key, n: n + 1 });
    }, PROBE_MS);
    return () => clearTimeout(timer);
  }, [waiting, hidden, key, n, name]);

  // The last subscription keeps running: a late answer takes the notice down.
  const stalled = waiting && !hidden && (blocked || n >= PROBES);
  useEffect(() => {
    if (!stalled) return;
    mark("live.stalled", name);
    return addStall();
  }, [stalled, name]);

  return waiting ? remembered.get(memo) as T | undefined : value;
}

/** Read once, by `Screen`'s notice, so every screen inherits it. */
export function useStalled(): { stalled: boolean; blocked: boolean } {
  const stalls = useSyncExternalStore(subscribe, () => health.stalls, () => 0);
  const blocked = useSyncExternalStore(subscribe, () => health.blocked, () => false);
  return { stalled: stalls > 0, blocked };
}

/** The stall notice's button. */
export function retryLive(): void {
  lastReopen = -Infinity;
  reopen();
}

/** Test seam. `arm` stays armed across `reset`, or `close` would subscribe twice. */
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
