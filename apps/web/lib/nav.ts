/**
 * Going up, not going back.
 *
 * Every screen's back arrow names its parent (`route.group(...)`, not
 * "whatever was before"), but a plain `<Link>` *pushes*, so the browser's own
 * back — the Android button, the edge swipe — replayed where you had been
 * instead: group → expense → back to group → device back → that expense again.
 *
 * So an up-link doesn't navigate, it *unwinds*: if the parent screen is already
 * behind us in the session's history, we go back to it, however many entries
 * that is, and the screens we're leaving stop being behind us. The stack that
 * remains is the path from the groups list down to where you are, which is what
 * makes the device back button climb the hierarchy one level per press.
 *
 * The browser's Navigation API is what makes this knowable — `history` alone
 * can't say what its entries are. Where it's missing (iOS before 18.4) an
 * up-link replaces the current entry instead: never the wrong screen, just a
 * back button that can need one extra press.
 */

/** Only what's needed here; TypeScript's DOM lib has no Navigation API yet. */
type NavigationLike = {
  entries: () => { url: string | null; key: string }[];
  currentEntry: { index: number } | null;
  traverseTo?: (key: string) => { committed: Promise<unknown>; finished: Promise<unknown> };
};

function navigation(): NavigationLike | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { navigation?: NavigationLike }).navigation;
}

/**
 * Two URLs are the same screen when path and query agree — query *order*
 * doesn't count, and neither does a trailing slash, because a link the app
 * built and one a person pasted have to compare equal.
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
 * Move to `href` as an ancestor: back out to it if we came through it, and
 * otherwise take its place. Either way nothing that was below it stays behind
 * us, so the next press of the device's back button leaves the parent too.
 */
export function goUp(href: string, replace: (href: string) => void): void {
  const nav = navigation();
  const here = nav?.currentEntry?.index;
  if (nav && here !== undefined && here >= 0) {
    const entries = nav.entries();
    const steps = stepsBackTo(entries.map((e) => e.url), here, href);
    const target = steps === null ? undefined : entries[here + steps];
    if (target && nav.traverseTo) {
      // Name the entry; don't count back to it. A count is measured against
      // the browser's idea of where we are, and that is not always this
      // screen: inside a cancelled back press it is the entry the press was
      // heading for, so `history.go(-1)` moved two — off the ledger to the
      // groups list, and off the start of the history, where a traversal that
      // lands nowhere is silently dropped and the press does nothing. A key
      // cannot be off by one, and a browser that won't take it says so.
      const { committed, finished } = nav.traverseTo(target.key);
      finished.catch(() => {});
      committed.catch(() => replace(href));
      return;
    }
    if (steps !== null) {
      window.history.go(steps);
      return;
    }
  }
  replace(href);
}
