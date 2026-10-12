// Doc: docs/ios.md
/**
 * Ask the browser to stop treating this app's data as a cache — on every
 * start, because installing changes the answer.
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
