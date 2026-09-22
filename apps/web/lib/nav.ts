/**
 * Going up, not going back.
 *
 * Every back arrow names its parent, but a plain `<Link>` *pushes*, so the
 * device's back replays where you had been: group → expense → up to group →
 * device back → that expense again.
 *
 * So an up-link *unwinds*: where the parent is already behind us we go back
 * to it, however many entries that is. What remains is the path from the
 * groups list down to here, so device back climbs one level per press.
 *
 * The Navigation API makes this knowable. Without it (iOS before 18.4) an
 * up-link replaces the current entry: never the wrong screen, at worst one
 * extra press.
 *
 * **Read the entries and go back over them; never `traverseTo` a key.** WebKit
 * folds a `traverseTo` into one pending for the same key and never settles the
 * dropped one, so only a timeout can tell late from lost — and on a slow phone
 * it fires while the traversal is merely late, leaving the parent on the stack
 * twice. A count is read and spent in one tick, and never inside a cancelled
 * back press ([back-button.ts](./back-button.ts)).
 */

/** Only what's needed here; TypeScript's DOM lib has no Navigation API yet. */
type NavigationLike = EventTarget & {
  entries: () => { url: string | null }[];
  currentEntry: { index: number } | null;
};

function navigation(): NavigationLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { navigation?: NavigationLike }).navigation;
}

/**
 * Two URLs are the same screen when path and query agree, ignoring query order
 * and a trailing slash — a built link and a pasted one must compare equal.
 */
export function sameScreen(a: string, b: string): boolean {
  return screenKey(a) === screenKey(b);
}

function screenKey(url: string): string {
  // The base is only there to satisfy the parser; app URLs are all relative.
  const u = new URL(url, "http://app.invalid");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  u.searchParams.sort();
  const query = u.searchParams.toString();
  return query ? `${path}?${query}` : path;
}

/**
 * How many entries back `target` sits, or `null` if it isn't behind us.
 * Pure, and exported for its test: the browser reading is the caller's.
 */
export function stepsBackTo(entries: (string | null)[], here: number, target: string): number | null {
  const want = screenKey(target);
  for (let i = Math.min(here, entries.length) - 1; i >= 0; i--) {
    const url = entries[i];
    if (url && screenKey(url) === want) return i - here;
  }
  return null;
}

/**
 * **Leaving closes any open dialog first, not with the screen.** A modal
 * `<dialog>` holds a close watcher, and Android doesn't deliver a traversal
 * begun underneath one: `history.go` returns and nothing moves. `close()`
 * empties the top layer synchronously, and the element's `close` listener
 * updates the state drawing it (components/dialog.tsx).
 */
function closeDialogs(): void {
  if (typeof document === "undefined") return;
  for (const el of document.querySelectorAll("dialog[open]")) {
    if (el instanceof HTMLDialogElement && el.matches(":modal")) el.close();
  }
}

/**
 * **A traversal Android can swallow whole, and the act happening anyway.**
 *
 * A back press this app *refused* (cancelled so the dialog could ask,
 * [back-button.ts](./back-button.ts)) leaves Android holding a traversal it
 * won't deliver again: the next `history.go` returns, no `navigate`, no error,
 * the screen still there. Only ever after a refused press.
 *
 * So the traversal is *checked*: still on the same entry a beat later means
 * swallowed, and the destination replaces this screen instead — a push, not
 * the stuck traversal queue.
 *
 * **A wrong guess costs an entry, never the act**: a late traversal lands on
 * an entry that is already the destination. That is the opposite trade from
 * `traverseTo` (see the head), which is why a clock may decide this. A
 * delivered traversal lands in ~10ms; a phone slow enough to overrun this
 * pays one duplicate entry (docs/testing.md).
 */
const SWALLOWED_MS = 150;

/**
 * Go, and put the destination here if the going is swallowed.
 *
 * **Every exit names somewhere to land**, which is why one check covers them
 * all: `goUp` names the parent, `goBack` reads the entry behind it. An exit
 * with no destination is the one thing this can't rescue.
 */
function leaveTo(to: string | undefined, traverse: () => void, replace: (to: string) => void): void {
  closeDialogs();
  const here = navigation()?.currentEntry?.index;
  markOwnTraversal();
  traverse();
  if (to === undefined || here === undefined) return;
  setTimeout(() => {
    // Anywhere but where we asked from is a traversal that arrived — or a
    // hand that has moved on, which is not ours to undo either.
    if (navigation()?.currentEntry?.index !== here) return;
    // The latch was armed for a `navigate` that is never coming, and one
    // left armed swallows a real press.
    disarmOwnTraversal();
    replace(to);
  }, SWALLOWED_MS);
}

/**
 * Move to `href` as an ancestor: back out to it if we came through it,
 * otherwise take its place. Nothing below it stays behind us.
 */
export function goUp(href: string, replace: (href: string) => void): void {
  const nav = navigation();
  const here = nav?.currentEntry?.index;
  if (nav && here !== undefined && here >= 0) {
    const steps = stepsBackTo(nav.entries().map((e) => e.url), here, href);
    if (steps !== null) { leaveTo(href, () => window.history.go(steps), replace); return; }
  }
  closeDialogs();
  replace(href);
}

/**
 * A plain back, as the app's own: the arrow on a screen reached only from
 * below, Done, Discard. Everything that goes back uses this or `goUp`, never
 * `router.back()` — see `takeOwnTraversal`.
 *
 * **It reads its destination** off the stack (the entry behind us), which
 * gives it the swallow check too.
 */
export function goBack(back: () => void, replace: (to: string) => void): void {
  const nav = navigation();
  const here = nav?.currentEntry?.index;
  const behind = here !== undefined && here > 0
    ? nav?.entries()[here - 1]?.url ?? undefined : undefined;
  leaveTo(behind, back, replace);
}

/**
 * The app's own traversal, told apart from the device's back button.
 *
 * **Never trust `NavigateEvent.userInitiated`**: WebKit sets it whenever a tap
 * is being handled, so the app's own back reads as a device press and the
 * guard asks "discard?" of Done. The app flags it itself, just before.
 *
 * **A latch spent by the one `navigate` it explains, never a time window** —
 * a slow phone delivers late. Armed only where a traversal is coming.
 */
let ownTraversal = false;

/**
 * **And spent by the next press or keystroke**, because a traversal that
 * never arrives (`history.go` can simply not move) leaves it armed — and the
 * next device back is then waved through unguarded, losing typed work with no
 * dialog.
 *
 * The app's traversal arrives long before a hand can move again, so a moved
 * hand proves it isn't coming. Not a clock (same reasoning as
 * lib/click-guard.ts), and it fails safe: dropped early costs an unneeded
 * "discard?", held too long costs the work.
 */
function disarmOwnTraversal(): void {
  ownTraversal = false;
  if (typeof document === "undefined") return;
  document.removeEventListener("pointerdown", disarmOwnTraversal, true);
  document.removeEventListener("keydown", disarmOwnTraversal, true);
}

function markOwnTraversal(): void {
  // At the start of the history there is nothing to go back to, so `back()`
  // moves nothing and no `navigate` arrives to spend the latch.
  ownTraversal = (navigation()?.currentEntry?.index ?? 0) > 0;
  if (!ownTraversal || typeof document === "undefined") return;
  // Capture, so a handler that stops the press still spends this.
  document.addEventListener("pointerdown", disarmOwnTraversal, true);
  document.addEventListener("keydown", disarmOwnTraversal, true);
}

/** Was this traversal the app's? Consumed by the one `navigate` it explains. */
export function takeOwnTraversal(): boolean {
  const ours = ownTraversal;
  disarmOwnTraversal();
  return ours;
}
