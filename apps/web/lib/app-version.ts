import { getDevice, updateDevice } from "./db/device";

/**
 * When this phone last got a new build of the app — the date under the groups
 * list.
 *
 * Not the deploy's date, which is the same for everyone and true for nobody:
 * this app updates when its service worker takes over, which is the next time
 * you open it, and on a phone that can be days later (public/sw.js deliberately
 * has no `skipWaiting`). So the arrival is what gets recorded, once, on the
 * device it arrived on.
 *
 * The revision comes from the *active* worker rather than from `caches.keys()`.
 * Both name the same thing, but during an update two shells exist at once — the
 * one being installed and the one still serving this page — and only the worker
 * can say which is which.
 */

/** How long to wait for the worker before giving up on the question. */
const REPLY_TIMEOUT_MS = 4000;

export async function runningRevision(timeoutMs = REPLY_TIMEOUT_MS): Promise<string | undefined> {
  // `controller` is null on the very first visit — the page came off the
  // network and no cache has overridden anything yet — and on any browser
  // without a worker. Nothing to date, so the line stays off.
  const worker = globalThis.navigator?.serviceWorker?.controller;
  if (!worker) return undefined;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (rev?: string) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(rev);
    };
    // A worker from before this message existed never answers. It will once its
    // successor activates; until then the timeout is the answer.
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    channel.port1.onmessage = (e) => finish(typeof e.data === "string" ? e.data : undefined);
    worker.postMessage("revision", [channel.port2]);
  });
}

/**
 * What the device record should say, given the build now serving it. `null`
 * when nothing changed — the common case, every launch after the first on a
 * given build, and the reason "updated 2h ago" doesn't reset itself to "just
 * now" every time the app is opened.
 *
 * A phone seeing its first revision is stamped too. It is not an *update*, but
 * it is when this phone got what it is running, which is what the line claims.
 */
export function versionArrival(
  device: { appRevision?: string; appUpdatedAt?: number },
  revision: string,
  now: number,
): { appRevision: string; appUpdatedAt: number } | null {
  if (device.appRevision === revision) return null;
  return { appRevision: revision, appUpdatedAt: now };
}

/** Ask the worker, and record the answer if it is news. */
export async function recordAppVersion(now = Date.now()): Promise<void> {
  const revision = await runningRevision();
  if (!revision) return;
  const patch = versionArrival(await getDevice(), revision, now);
  if (patch) await updateDevice(patch);
}
