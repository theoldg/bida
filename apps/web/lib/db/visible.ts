import { started } from "../diag";

/**
 * Not opening a write while the page is in the background.
 *
 * An IndexedDB lock belongs to the origin, not to the page. A phone freezes a
 * hidden app, and a readwrite transaction frozen half way through keeps its
 * lock forever: every read of those stores, in every copy of the app, queues
 * behind it until the frozen page is looked at again or killed. No page can
 * break another's lock, so the only defence is that no copy ever opens a write
 * it might be frozen inside — which means not opening one while hidden.
 *
 * It lives here rather than in ./sync.ts because it is not sync's rule. It was
 * written for the commit there and stated in docs/frontend.md as if it covered
 * the app, and it did not: `updateDevice` wrote the `device` store from a
 * background page, which is how a hidden `/join` came to hold that one store
 * and hang the groups list of the copy in front of the owner.
 *
 * **What must not wait is a write holding something that exists nowhere
 * else** — `saveGroupKey` stores the secret from an invite link, and a tab
 * killed while parked would lose the group. Everything gated here is a
 * preference or a pointer, so waiting costs nothing and losing it costs a
 * setting.
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
