/**
 * This phone's Web Push subscription, and keeping every held group's identity
 * in step with it (docs/notifications.md, plan step 5). The subscription lives
 * on the log as `identity.push`, so the phone that causes a change knows whom
 * to tell; the server keeps nothing.
 */

import { fromBase64Url, isDemo, type DevicePush, type Identity } from "@bida/core";
import { appendOps } from "./db/commands/append";
import { db } from "./db/dexie";
import { getDevice } from "./db/device";
import { note } from "./diag";

/**
 * Where this phone stands. Only `"ask"` draws the offer: `"denied"` can't be
 * asked again (the person undoes it in settings), `"on"` needs nothing.
 */
export type PushState = "unsupported" | "ask" | "denied" | "on";

/** Pure, for the tests: the browser's three facts to one state. */
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

/** A string, so `useSyncExternalStore` compares it by value. */
export function pushState(): PushState {
  const state = pushStateFrom({
    supported: supported(),
    permission: supported() ? Notification.permission : undefined,
  });
  // Answered "not now" in the prompt leaves the permission at "default"; the
  // offer goes for this launch rather than standing there as if unasked.
  return state === "ask" && asked ? "denied" : state;
}

/** What goes on the log: the three things a sender encrypts and addresses with. */
export function pushFromSubscription(json: PushSubscriptionJSON): DevicePush | null {
  const { endpoint, keys } = json;
  if (!endpoint || !keys?.p256dh || !keys.auth) return null;
  return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

function samePush(a: DevicePush | null | undefined, b: DevicePush | null): boolean {
  if (!a || !b) return (a ?? null) === b;
  return a.endpoint === b.endpoint && a.p256dh === b.p256dh && a.auth === b.auth;
}

/**
 * Which groups need an identity op to say `want`: every group this phone holds
 * and has claimed a member in, bar the demo and the ones it left, whose
 * identity says otherwise. A group with no claim has no identity to carry it;
 * `claimIdentity` catches it up. Absent and `null` agree when `want` is null,
 * so a phone that never subscribed writes nothing.
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

/** The Worker's public key; asked each time, since one build serves two Workers. */
async function serverKey(): Promise<Uint8Array | null> {
  try {
    const res = await fetch("/api/push/key");
    if (!res.ok) return null;
    const { publicKey } = await res.json() as { publicKey?: unknown };
    return typeof publicKey === "string" ? fromBase64Url(publicKey) : null;
  } catch {
    return null;
  }
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const view = new Uint8Array(a);
  return view.every((byte, i) => byte === b[i]);
}

/**
 * The subscription this phone should hold: its current one, unless that was
 * made with another key (a rotation), in which case a fresh one. Needs the
 * permission already granted, so no tap is needed here.
 *
 * **Without the key — offline — the current one stands**, so a start with no
 * network never writes a live subscription off the log. A browser that won't
 * say which key it subscribed with keeps its subscription too, or every start
 * would churn a new one and an op per group.
 */
async function subscription(reg: ServiceWorkerRegistration): Promise<PushSubscription | null> {
  const current = await reg.pushManager.getSubscription();
  const key = await serverKey();
  if (!key) return current;
  const made = current?.options.applicationServerKey;
  if (current && (!made || sameBytes(made, key))) return current;
  await current?.unsubscribe();
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key as Uint8Array<ArrayBuffer>,
  });
}

/** Write `want` onto every identity that says otherwise. */
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
 * From the offer's tap. **`requestPermission` comes first, before any await**:
 * iOS shows the prompt only inside the tap's own turn, and anything awaited
 * ahead of it spends that.
 */
export async function turnOnNotifications(): Promise<void> {
  if (!supported()) return;
  const answer = await Notification.requestPermission();
  asked = true;
  try {
    if (answer !== "granted") return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await subscription(reg) : null;
    await publish(sub ? pushFromSubscription(sub.toJSON()) : null);
  } catch (err) {
    note("push.subscribe", String(err));
  } finally {
    for (const listener of listeners) listener();
  }
}

/**
 * Every start, and after a claim: bring the log in line with the browser.
 * Safari rotates a subscription without saying, a new VAPID key needs a fresh
 * one, a revoked permission means `null`, and a new claim has none yet. Quiet
 * when nothing moved.
 */
export async function reconcilePush(): Promise<void> {
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    // A permission taken back leaves the subscription dead, not gone: null.
    const sub = Notification.permission === "granted" ? await subscription(reg) : null;
    await publish(sub ? pushFromSubscription(sub.toJSON()) : null);
  } catch (err) {
    note("push.reconcile", String(err));
  }
}
