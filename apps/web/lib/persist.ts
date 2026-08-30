/**
 * Ask the browser to stop treating this app's data as a cache.
 *
 * IndexedDB is "best-effort" by default: the browser may evict it whenever it
 * likes, and Safari does so flatly after seven days without a visit. What dies
 * with it is every op this phone hasn't pushed yet — which exists nowhere else
 * — and the group secrets in `groupKeys`, the only copy on the device. The
 * group itself survives on the server, but reaching it again means finding the
 * invite link: there is no account to log back in to (ADR-0003).
 *
 * `persist()` moves the origin to "persistent", which is exempt from automatic
 * eviction. It is a request, not an instruction — browsers answer on their own
 * heuristics, and an installed PWA is granted where a tab opened once is often
 * not. That is why this runs on every start rather than once: the answer
 * changes the moment the install nudge is taken.
 */

let granted = false;

/**
 * Returns whether this phone's data is now exempt from eviction. Safe to call
 * anywhere — an unsupported browser or a private window answers `false`
 * instead of throwing.
 *
 * Deliberately not called before the phone holds a group: on Firefox this can
 * surface a permission prompt, and there is nothing to protect on a device
 * that has never joined anything.
 */
export async function requestPersistence(): Promise<boolean> {
  if (granted) return true;
  try {
    if (!navigator.storage?.persist) return false;
    granted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    return granted;
  } catch {
    return false;
  }
}
