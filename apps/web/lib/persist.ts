/**
 * Ask the browser to stop treating this app's data as a cache.
 *
 * IndexedDB is "best-effort" by default — Safari evicts flatly after seven days
 * without a visit. What dies with it is every op this phone hasn't pushed, and
 * the group secrets in `groupKeys`: the only copy on the device. The group
 * survives on the server, but reaching it again means finding the invite link,
 * since there is no account to log back in to (ADR-0003).
 *
 * `persist()` is a request, not an instruction — an installed PWA is granted
 * where a tab opened once is often not. **Run it on every start**, because the
 * answer changes the moment the install nudge is taken.
 */

let granted = false;

/**
 * Returns whether this phone's data is now exempt from eviction. Safe to call
 * anywhere — an unsupported browser or a private window answers `false`.
 *
 * **Don't call it before the phone holds a group**: on Firefox it can surface a
 * permission prompt, over a device with nothing to protect.
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
