/**
 * Ask the browser to stop treating this app's data as a cache.
 *
 * IndexedDB is best-effort by default — Safari evicts after seven days
 * without a visit — taking unpushed ops and the only on-device copy of the
 * group secrets. With no accounts, getting back means finding the invite link
 * (ADR-0003).
 *
 * `persist()` is a request; an installed PWA is granted where a tab often
 * isn't. **Run it on every start**: installing changes the answer.
 */

let granted = false;

/**
 * Whether this phone's data is now exempt from eviction; `false` where
 * unsupported. **Not before the phone holds a group** — Firefox may prompt,
 * over nothing to protect.
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
