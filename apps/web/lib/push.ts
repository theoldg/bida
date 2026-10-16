/**
 * This phone's Web Push subscription, kept in step on every held group's identity
 * (docs/notifications.md): the phone that causes a change knows whom to tell, and
 * the server keeps nothing.
 */

import { fromBase64Url, isDemo, type DevicePush, type Identity, type NotifyScope } from "@bida/core";
import { appendOps } from "./db/commands/append";
import { db, type NotifyLevel } from "./db/dexie";
import { getDevice, updateDevice } from "./db/device";
import { keepNote } from "./diag";

/** Only `"ask"` draws the offer: `"denied"` can't be asked again. */
export type PushState = "unsupported" | "ask" | "denied" | "on";

export function pushStateFrom(
  { supported, permission }: { supported: boolean; permission: NotificationPermission | undefined },
): PushState {
  if (!supported || permission === undefined) return "unsupported";
  if (permission === "granted") return "on";
  return permission === "denied" ? "denied" : "ask";
}

function supported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

let asked = false;
const listeners = new Set<() => void>();

export function subscribePushState(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * A prompt dismissed is still "ask". A string, so `useSyncExternalStore` compares
 * by value.
 */
export function pushPermission(): PushState {
  return pushStateFrom({
    supported: supported(),
    permission: supported() ? Notification.permission : undefined,
  });
}

export function pushState(): PushState {
  const state = pushPermission();
  // "Not now" leaves the permission at "default"; the offer goes for this launch.
  return state === "ask" && asked ? "denied" : state;
}

export function pushFromSubscription(json: PushSubscriptionJSON): DevicePush | null {
  const { endpoint, keys } = json;
  if (!endpoint || !keys?.p256dh || !keys.auth) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

function samePush(a: DevicePush | null | undefined, b: DevicePush | null): boolean {
  if (!a || !b) return (a ?? null) === b;
  return a.endpoint === b.endpoint && a.p256dh === b.p256dh && a.auth === b.auth
    && (a.scope ?? "own") === (b.scope ?? "own");
}

/**
 * "own" leaves `scope` out, as older subscriptions did, so choosing it rewrites
 * nothing.
 */
export function pushAt(json: PushSubscriptionJSON | null, level: NotifyLevel): DevicePush | null {
  const push = json && level !== "off" ? pushFromSubscription(json) : null;
  return push && level === "all" ? { ...push, scope: "all" } : push;
}

export function notifyLevel(state: PushState, chosen: NotifyLevel | undefined): NotifyLevel {
  return state === "on" ? chosen ?? "own" : "off";
}

/**
 * A group with no claim has no identity to carry it; `claimIdentity` catches it
 * up.
 */
export function pushWrites(
  { held, left, identities, want }: {
    held: readonly string[];
    left: readonly string[];
    identities: readonly Identity[];
    want: DevicePush | null;
  },
): Identity[] {
  const skip = new Set(left);
  return identities.filter((identity) =>
    held.includes(identity.groupId)
    && !skip.has(identity.groupId)
    && !isDemo(identity.groupId)
    && !samePush(identity.push, want));
}

/** Asked each time, since one build serves two Workers. */
async function serverKey(): Promise<Uint8Array | null> {
  try {
    // Bounded: everything that changes push state waits its turn behind this.
    const res = await fetch("/api/push/key", { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const { publicKey } = await res.json() as { publicKey?: unknown };
    return typeof publicKey === "string" ? fromBase64Url(publicKey) : null;
  } catch {
    return null;
  }
}

/**
 * Safari has been seen never answering a push call — the iOS Simulator, its
 * worker not yet in control — and every change waits behind the one before it,
 * so one hung call would swallow every tap after it. Named, for `/diag`.
 */
function answered<T>(call: string, work: Promise<T>, ms = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${call} never answered`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

function registration(): Promise<ServiceWorkerRegistration | undefined> {
  return answered("getRegistration", navigator.serviceWorker.getRegistration());
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const view = new Uint8Array(a);
  return view.every((byte, i) => byte === b[i]);
}

/**
 * A fresh one only when made with another key. **Offline, the current one
 * stands**, and so does one whose browser won't say its key, or every start would
 * churn an op per group.
 */
async function subscription(reg: ServiceWorkerRegistration): Promise<PushSubscription | null> {
  const current = await answered("getSubscription", reg.pushManager.getSubscription());
  const key = await serverKey();
  if (!key) return current;
  const made = current?.options.applicationServerKey;
  if (current && (!made || sameBytes(made, key))) return current;
  if (current) await answered("unsubscribe", current.unsubscribe());
  return answered("subscribe", reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key as Uint8Array<ArrayBuffer>,
  }));
}

/**
 * One reconcile at a time, in the order asked: one that read the level before a
 * Settings tap would otherwise publish it after the tap's own.
 */
let turn: Promise<unknown> = Promise.resolve();
function inTurn(task: () => Promise<void>): Promise<void> {
  const run = turn.then(task, task);
  turn = run.catch(() => {});
  return run;
}

async function publish(want: DevicePush | null, now = Date.now()): Promise<void> {
  const device = await getDevice();
  const [held, identities] = await Promise.all([
    db().groupKeys.toCollection().primaryKeys(),
    db().identities.filter((i) => i.id === device.nodeId).toArray(),
  ]);
  const writes = pushWrites({ held, left: device.leftGroups ?? [], identities, want });
  for (const identity of writes) {
    await appendOps(identity.groupId, identity.memberId, [{
      entity: "identity",
      entityId: device.nodeId,
      kind: "update",
      patch: { push: want },
    }], now);
  }
}

/**
 * **`requestPermission` comes first, before any await**: iOS shows the prompt
 * only inside the tap's own turn. True when the level was kept.
 */
export async function turnOnNotifications(level: NotifyScope = "own"): Promise<boolean> {
  if (!supported()) return false;
  const answer = await Notification.requestPermission();
  asked = true;
  if (answer === "granted") return keepLevel(level);
  for (const listener of listeners) listener();
  return false;
}

/**
 * Off keeps the browser's subscription and writes `null`, so turning back on asks
 * nothing. Without permission, nothing may be awaited ahead of the prompt.
 */
export async function setNotifyLevel(level: NotifyLevel): Promise<boolean> {
  if (!supported()) return false;
  if (level !== "off" && Notification.permission !== "granted") return turnOnNotifications(level);
  return keepLevel(level);
}

/**
 * **The level is kept at once and the subscription follows**, as a reconcile:
 * the browser's half can take seconds, or the full cut-off where it never
 * answers, and a tap waiting on it reads as a frozen control.
 */
async function keepLevel(level: NotifyLevel): Promise<boolean> {
  try {
    await updateDevice({ notify: level });
  } catch (err) {
    keepNote("push.level", String(err));
    return false;
  } finally {
    for (const listener of listeners) listener();
  }
  void reconcilePush();
  return true;
}

/**
 * Every start, after a claim and after a level is chosen: Safari rotates a
 * subscription without saying, a new VAPID key needs a fresh one, a revoked
 * permission means `null`. It reads the level when its turn comes, so one
 * waiting covers every ask behind it — five taps behind a hung call are one
 * reconcile, not five cut-offs.
 */
let waiting: Promise<void> | null = null;
export async function reconcilePush(): Promise<void> {
  if (!supported()) return;
  waiting ??= inTurn(async () => {
    waiting = null;
    try {
      const reg = await registration();
      if (!reg) return;
      // And Settings' "off" is kept off however the browser stands.
      const level = (await getDevice()).notify ?? "own";
      const sub = Notification.permission === "granted" && level !== "off" ? await subscription(reg) : null;
      await publish(pushAt(sub?.toJSON() ?? null, level));
    } catch (err) {
      keepNote("push.reconcile", String(err));
    }
  });
  return waiting;
}
