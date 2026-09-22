import { started } from "../diag";

/**
 * Never open a write while the page is in the background.
 *
 * An IndexedDB lock belongs to the origin, not to the page. A phone freezes a
 * hidden app, and a readwrite transaction frozen half way through keeps its
 * lock: every read of those stores, in every copy of the app, queues behind it
 * until the frozen page is looked at or killed. No page can break another's
 * lock, so the only defence is not opening one while hidden. The app's rule,
 * not just sync's — a background `updateDevice` hangs the groups list too.
 *
 * **What must not wait is a write holding something that exists nowhere
 * else** — `saveGroupKey` stores the secret from an invite link, and a tab
 * killed while parked would lose the group. Gate preferences and pointers
 * only: waiting costs nothing and losing one costs a setting.
 */
export function whenVisible(what: string): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") {
    return Promise.resolve();
  }
  // Marked, because a parked write is a line the /diag timeline should show
  // rather than a gap in it.
  const parked = started("parked", what);
  return new Promise((resolve) => {
    const seen = () => {
      if (document.visibilityState === "hidden") return;
      document.removeEventListener("visibilitychange", seen);
      parked();
      resolve();
    };
    document.addEventListener("visibilitychange", seen);
  });
}
