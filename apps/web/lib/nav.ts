// Doc: docs/navigation.md#routing
/** Going up, not going back: an up-link unwinds to its parent rather than pushing. */

/** Only what's needed here; TypeScript's DOM lib has no Navigation API yet. */
type NavigationLike = EventTarget & {
  entries: () => { url: string | null }[];
  currentEntry: { index: number } | null;
};

function navigation(): NavigationLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { navigation?: NavigationLike }).navigation;
}

/** A built link and a pasted one must compare equal. */
export function sameScreen(a: string, b: string): boolean {
  return screenKey(a) === screenKey(b);
}

function screenKey(url: string): string {
  const u = new URL(url, "http://app.invalid");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  u.searchParams.sort();
  const query = u.searchParams.toString();
  return query ? `${path}?${query}` : path;
}

/** Pure, and exported for its test. */
export function stepsBackTo(entries: (string | null)[], here: number, target: string): number | null {
  const want = screenKey(target);
  for (let i = Math.min(here, entries.length) - 1; i >= 0; i--) {
    const url = entries[i];
    if (url && screenKey(url) === want) return i - here;
  }
  return null;
}

/**
 * **Leaving closes any open dialog first.** Android doesn't deliver a traversal
 * begun under a modal `<dialog>`'s close watcher: `history.go` returns and
 * nothing moves.
 */
function closeDialogs(): void {
  if (typeof document === "undefined") return;
  for (const el of document.querySelectorAll("dialog[open]")) {
    if (el instanceof HTMLDialogElement && el.matches(":modal")) el.close();
  }
}

/**
 * **A traversal Android can swallow whole.** After a back press this app refused,
 * the next `history.go` can return with no `navigate` and no error. So still on
 * the same entry a beat later means swallowed, and the destination replaces this
 * screen. A wrong guess costs an entry, never the act; a delivered traversal
 * lands in ~10ms.
 */
const SWALLOWED_MS = 150;

/** **Every exit names somewhere to land**, so one check covers them all. */
function leaveTo(to: string | undefined, traverse: () => void, replace: (to: string) => void): void {
  closeDialogs();
  // The entry itself, not its index: a tap that pushed straight on comes back to
  // the same index on a different entry.
  const here = navigation()?.currentEntry;
  markOwnTraversal();
  traverse();
  if (to === undefined || !here) return;
  setTimeout(() => {
    if (navigation()?.currentEntry !== here) return;
    // A latch left armed swallows a real press.
    disarmOwnTraversal();
    markReturn(to);
    replace(to);
  }, SWALLOWED_MS);
}

/** Back out to `href` if we came through it, otherwise take its place. */
export function goUp(href: string, replace: (href: string) => void): void {
  const nav = navigation();
  const here = nav?.currentEntry?.index;
  if (nav && here !== undefined && here >= 0) {
    const steps = stepsBackTo(nav.entries().map((e) => e.url), here, href);
    if (steps !== null) { leaveTo(href, () => window.history.go(steps), replace); return; }
  }
  closeDialogs();
  markReturn(href);
  replace(href);
}

/**
 * Everything that goes back uses this or `goUp`, never `router.back()`. It reads
 * its destination off the stack, which gives it the swallow check too.
 */
export function goBack(back: () => void, replace: (to: string) => void): void {
  const nav = navigation();
  const here = nav?.currentEntry?.index;
  const behind = here !== undefined && here > 0
    ? nav?.entries()[here - 1]?.url ?? undefined : undefined;
  leaveTo(behind, back, replace);
}

/**
 * **Never trust `NavigateEvent.userInitiated`**: WebKit sets it whenever a tap is
 * being handled, so Done would be asked "discard?". A latch spent by the one
 * `navigate` it explains, never a time window.
 */
let ownTraversal = false;

/**
 * **And spent by the next press or keystroke**: a traversal that never arrives
 * would leave it armed, waving the next device back through unguarded. Fails
 * safe: dropped early costs an unneeded "discard?".
 */
function disarmOwnTraversal(): void {
  ownTraversal = false;
  if (typeof document === "undefined") return;
  document.removeEventListener("pointerdown", disarmOwnTraversal, true);
  document.removeEventListener("keydown", disarmOwnTraversal, true);
}

function markOwnTraversal(): void {
  // At the start of the history `back()` moves nothing, and no `navigate` comes.
  ownTraversal = (navigation()?.currentEntry?.index ?? 0) > 0;
  if (!ownTraversal || typeof document === "undefined") return;
  // Capture, so a handler that stops the press still spends this.
  document.addEventListener("pointerdown", disarmOwnTraversal, true);
  document.addEventListener("keydown", disarmOwnTraversal, true);
}

export function takeOwnTraversal(): boolean {
  const ours = ownTraversal;
  disarmOwnTraversal();
  return ours;
}

/**
 * **Arriving by going back, told apart from arriving by being sent** — whether
 * the ledger comes back where it was left (ledger-position.ts). Kept with its URL
 * so a mark nothing spent can't send a later push somewhere, and numbered so a
 * screen spends each one once.
 */
let returned: { url: string; n: number } | undefined;
let returns = 0;

export function markReturn(url: string): void {
  returned = { url, n: ++returns };
}

export function returnTo(url: string): number | null {
  return returned && sameScreen(returned.url, url) ? returned.n : null;
}

// Here rather than beside the ledger: the ledger's chunk can arrive after the
// traversal that brought it.
if (typeof window !== "undefined") window.addEventListener("popstate", () => markReturn(location.href));

/**
 * **An entry an older Next wrote is loaded, not restored.** Next keeps its
 * router's tree in `history.state`: 15 kept it bare, 16 wraps it in `{ tree }`.
 * Back onto an entry from before a reload onto 16, its router found no tree
 * and stayed put — the address moved, the screen did not. Such an entry is
 * loaded whole instead, ahead of Next's own listener; inline in the layout, so
 * it listens before the router hydrates.
 */
export const foreignEntryScript = `addEventListener("popstate",function(e){var s=e.state,t=s&&s.__PRIVATE_NEXTJS_INTERNALS_TREE;if(s&&s.__NA&&!(t&&Array.isArray(t.tree))){e.stopImmediatePropagation();location.reload()}},true)`;
