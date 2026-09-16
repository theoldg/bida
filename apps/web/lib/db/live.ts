"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { keep, mark, started } from "../diag";
import { db } from "./dexie";

/**
 * Reading from Dexie, and noticing when the read never comes back.
 *
 * **Every live read in the app goes through `useLive`, not `useLiveQuery`.**
 * The reason is a hole in `liveQuery` that costs an installed phone the whole
 * app. Dexie swallows two error names rather than delivering them:
 *
 * ```js
 * }, function (err) {                                    // dexie.js, liveQuery
 *   hasValue = false;
 *   if (!['DatabaseClosedError', 'AbortError'].includes(err?.name)) { … }
 * });
 * ```
 *
 * It means to ignore a query the observable itself superseded. What it also
 * ignores is a query the *browser* killed — and those two arrive by the same
 * door. Android freezes a backgrounded PWA and aborts the IndexedDB
 * transactions it had in flight; Chrome force-closes the connection under
 * storage pressure (`idbdb.onclose`, which Dexie answers with
 * `close({disableAutoOpen:false})`). Either way the query rejects with one of
 * those two names, nothing is emitted — no value, no error — and, measured
 * against Dexie 4.4.5 in ./live.test.ts, **the subscription is then dead**:
 * the querier is never run again, not even by a write to the very table it
 * observes.
 *
 * A screen reads "no value yet" as "still loading", because that is the only
 * other thing it can mean. So the app sat on its skeleton rows until it was
 * killed and relaunched, with nothing in the console.
 *
 * A dead subscription can't be revived from outside, so the repair is to make
 * a new one. Three things ask for that, below: the connection closing, the app
 * coming back to the foreground, and a read that has simply taken too long.
 *
 * A read can also be *alive and waiting*: queued behind a readwrite
 * transaction that a frozen copy of the app will never finish. A new
 * subscription joins the same queue, so the last probe opens a fresh
 * connection instead, and every read remembers its last answer so that a
 * screen opened during the wait shows that rather than skeleton rows.
 */

/** How long a read may return nothing before we assume it never will. */
const PROBE_MS = 6000;
/** Re-subscribes before giving up and saying so. Two, then the notice stands. */
const PROBES = 2;

interface Health {
  /** Bumped to re-subscribe every live read in the app. In every query's deps. */
  epoch: number;
  /**
   * An upgrade is blocked by another connection — a second tab, or the same
   * app in the browser — holding the older version. Dexie's own handler for
   * this logs a warning and waits forever, and `indexedDB.open` has no
   * timeout, so without this the app has no way to know it is never opening.
   * A new subscription cannot help; only closing the other copy can.
   */
  blocked: boolean;
  /** How many mounted reads have given up. Drives the notice — see `useStalled`. */
  stalls: number;
}

const health: Health = { epoch: 0, blocked: false, stalls: 0 };
const listeners = new Set<() => void>();

function announce(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Re-subscribe every live read. Clears `blocked` with it: whatever we were
 * waiting on, this is the app deciding to start over, and if the block is
 * still there the next open will say so again.
 */
function bump(): void {
  health.epoch += 1;
  health.blocked = false;
  announce();
}

/**
 * The last answer each read gave, by name and deps, for the life of the page.
 *
 * `useLiveQuery` holds a value per mounted component, so every navigation
 * starts again from `undefined` — skeleton rows for as long as the database
 * takes, which is forever while a lock is held elsewhere. A screen coming back
 * to what it read a minute ago shows that instead, and the live answer
 * replaces it the moment there is one. Bounded by the groups on the phone.
 */
const remembered = new Map<string, unknown>();

/** At most one reopen per probe window, however many reads give up in it. */
let lastReopen = -Infinity;
/** Set while *we* close the connection, so `on('close')` doesn't record the browser doing it. */
let reopening = false;

/**
 * Close this page's connection and open a new one.
 *
 * What a re-subscription can't do: a read waiting in the browser's queue on
 * this connection stays there however many times it is asked again. A fresh
 * connection is the one lever this page has on a stuck backend. It cannot
 * release a lock another copy of the app holds — /diag lists those copies —
 * and closing never aborts a transaction already running: `IDBDatabase.close`
 * lets them finish.
 */
function reopen(): void {
  const now = Date.now();
  if (now - lastReopen < PROBE_MS) return;
  lastReopen = now;
  const done = started("db.reopen");
  reopening = true;
  try {
    // `disableAutoOpen: false` fires `close`, which bumps every read onto the
    // new connection (`arm`), and lets the first of them open it.
    db().close({ disableAutoOpen: false });
  } finally {
    reopening = false;
  }
  db().open().then(() => done(), (err: unknown) => done(`failed ${(err as Error)?.name ?? "?"}`));
}

let armed = false;

/**
 * Listen for the two things that kill a subscription silently. Idempotent —
 * every `useLive` calls it, and there is one set of listeners.
 */
function arm(): void {
  if (armed) return;
  armed = true;
  keep();

  // The browser closed the connection under us. Dexie has already left
  // `autoOpen` on, so a fresh query re-opens; it is the *existing* ones that
  // are beyond saving.
  db().on("close", () => {
    if (!reopening) mark("db.close");
    bump();
  });

  db().on("blocked", () => {
    mark("db.blocked");
    health.blocked = true;
    announce();
  });

  // Nothing below is available where there is no DOM — the static export
  // prerenders these screens, and the tests run in node.
  if (typeof document === "undefined") return;

  // A subscription can also die while the app is in the background, where
  // there is no render to notice it and the watchdog below isn't running. An
  // installed app is resumed far more often than it is launched, so this is
  // the common repair, and it is nearly free: a read that already has a value
  // keeps showing it across the re-subscribe (dexie-react-hooks holds the last
  // result in a ref), so re-arming a healthy screen costs a query, not a flash
  // of skeleton.
  document.addEventListener("visibilitychange", () => {
    mark(`app.${document.visibilityState}`);
    if (document.visibilityState === "visible") bump();
  });
}

/** How much came back, for the timeline. Rough on purpose — it is a size, not data. */
function size(result: unknown): string {
  if (Array.isArray(result)) return `${result.length} rows`;
  if (result && typeof result === "object") {
    const counted = Object.values(result).filter(Array.isArray);
    if (counted.length) return `${counted.reduce((n, a) => n + a.length, 0)} rows`;
    return "1";
  }
  return result === undefined ? "nothing" : "1";
}

/** One mounted read has given up. Returns the undo. */
function addStall(): () => void {
  health.stalls += 1;
  announce();
  return () => {
    health.stalls -= 1;
    announce();
  };
}

/**
 * A live read of the database, re-armed when it dies.
 *
 * `name` is what this read is called on the /diag timeline, and it is the
 * first argument because a read nobody can name is a read nobody can explain
 * a ten-second wait with.
 *
 * The same contract as `useLiveQuery` — `undefined` until the first value —
 * with the difference that `undefined` now decays into something a person is
 * told about rather than lasting forever. See `useStalled`.
 */
export function useLive<T>(
  name: string, querier: () => Promise<T>, deps: readonly unknown[],
): T | undefined {
  useEffect(arm, []);

  const epoch = useSyncExternalStore(subscribe, () => health.epoch, () => 0);
  const blocked = useSyncExternalStore(subscribe, () => health.blocked, () => false);

  // The caller's deps as one comparable value, so `probe` below can tell "the
  // same read is still not answering" from "this is a different read now".
  const key = JSON.stringify(deps);
  const [probe, setProbe] = useState({ key, n: 0 });
  // Derived during render rather than reset in an effect: a new `key` starts
  // its watchdog from zero on the same render that starts the read.
  const n = probe.key === key ? probe.n : 0;

  // Every read, timed and named. This is the line the whole recorder is for:
  // a screen showing a skeleton is a read that has not come back, and its
  // duration next to `rebuild`, `sync.pushpull` and `db.open` on one clock is
  // what says which of them it was waiting for. `n > 0` means the watchdog had
  // already given up on it once.
  const label = `${name}${n > 0 ? ` retry#${n}` : ""}`;
  const timedQuerier = useMemo(() => async () => {
    const done = started("live", label);
    try {
      const result = await querier();
      done(`${label} ${size(result)}`);
      return result;
    } catch (err) {
      done(`${label} threw ${(err as Error)?.name ?? "?"}`);
      throw err;
    }
    // `querier` is a fresh closure every render and is deliberately not a
    // dependency — `useLiveQuery` re-subscribes on `deps`, and so does this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, epoch, n, label]);

  const value = useLiveQuery(timedQuerier, [key, epoch, n]);
  // `waiting` is about the live answer only: a remembered one on screen is
  // still a read that hasn't come back, and the watchdog and the notice say so.
  const waiting = value === undefined;
  const memo = `${name} ${key}`;
  if (!waiting) remembered.set(memo, value);

  useEffect(() => {
    if (!waiting || n >= PROBES) return;
    const timer = setTimeout(() => {
      mark("live.retry", `${name} after ${PROBE_MS}ms with nothing`);
      // The last probe is the new connection; see `reopen`.
      if (n + 1 === PROBES) reopen();
      setProbe({ key, n: n + 1 });
    }, PROBE_MS);
    return () => clearTimeout(timer);
  }, [waiting, key, n, name]);

  // Out of probes, or blocked, which no number of probes can clear. The last
  // subscription is left running either way: if it does eventually answer,
  // `waiting` goes false and the notice takes itself down.
  const stalled = waiting && (blocked || n >= PROBES);
  useEffect(() => {
    if (!stalled) return;
    mark("live.stalled", name);
    return addStall();
  }, [stalled, name]);

  return waiting ? remembered.get(memo) as T | undefined : value;
}

/**
 * Whether any read on screen has given up, and why. Read by exactly one
 * component — the notice in `Screen` — so that every screen inherits it
 * instead of nine of them checking for themselves.
 */
export function useStalled(): { stalled: boolean; blocked: boolean } {
  const stalls = useSyncExternalStore(subscribe, () => health.stalls, () => 0);
  const blocked = useSyncExternalStore(subscribe, () => health.blocked, () => false);
  return { stalled: stalls > 0, blocked };
}

/** Ask every live read to start over, on a new connection. The notice's button, and nothing else. */
export function retryLive(): void {
  lastReopen = -Infinity;
  // Its `close` is what re-subscribes every read and clears `blocked`.
  reopen();
}

/**
 * Test seam. `arm` is idempotent and stays armed across `reset` — re-arming
 * would subscribe `bump` to `close` a second time.
 */
export const testing = {
  health,
  arm,
  reopen,
  remembered,
  subscribe,
  addStall,
  reset(): void {
    health.epoch = 0;
    health.blocked = false;
    health.stalls = 0;
    listeners.clear();
    remembered.clear();
    lastReopen = -Infinity;
  },
};
