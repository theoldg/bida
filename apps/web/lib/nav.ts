/**
 * Going up, not going back.
 *
 * Every screen's back arrow names its parent (`route.group(...)`, not
 * "whatever was before"), but a plain `<Link>` *pushes*, so the browser's own
 * back replays where you had been: group → expense → back to group → device
 * back → that expense again.
 *
 * So an up-link doesn't navigate, it *unwinds*: where the parent is already
 * behind us we go back to it, however many entries that is, and what we leave
 * stops being behind us. The stack that remains is the path from the groups
 * list down to here, which is what makes the device back button climb the
 * hierarchy one level per press.
 *
 * The Navigation API is what makes this knowable — `history` alone can't say
 * what its entries are. Where it is missing (iOS before 18.4) an up-link
 * replaces the current entry: never the wrong screen, just a back button that
 * can need one extra press.
 *
 * **Read the entries and go back over them; never name one by key for
 * `traverseTo`.** WebKit folds a `traverseTo` into one still pending for the
 * same key and never settles one it dropped, so telling a late traversal from
 * a lost one takes a timeout — which fires on a slow phone while the traversal
 * is merely late, replacing the entry underneath it and leaving the parent on
 * the stack twice. A count is read and spent in the same tick, outside any
 * event, and the one place the browser's idea of "here" is not this screen —
 * inside a cancelled back press — never counts at all
 * ([back-button.ts](./back-button.ts)).
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
    const steps = stepsBackTo(nav.entries().map((e) => e.url), here, href);
    if (steps !== null) {
      markOwnTraversal();
      window.history.go(steps);
      return;
    }
  }
  replace(href);
}

/**
 * A plain back, as the app's own: the arrow on a screen reached only from
 * below, Done, Discard. Anything in the app that goes back goes through here or
 * `goUp`, never `router.back()` directly — see `takeOwnTraversal`.
 */
export function goBack(back: () => void): void {
  markOwnTraversal();
  back();
}

/**
 * The app's own traversal, told apart from the device's back button.
 *
 * **Never trust `NavigateEvent.userInitiated`.** Chrome says which is which;
 * WebKit sets it whenever a tap is being handled, so the app's own back inside
 * a tap reads as a device press and the guard asks "discard?" of the Done
 * keeping the edits. The app says so itself instead, just before it traverses.
 *
 * **A latch spent by the one `navigate` it explains, never a window of time.**
 * A clock says "the app went back within the last second", which a phone slow
 * enough to deliver the event later answers wrongly. Armed only where a
 * traversal is actually coming, since one left armed swallows a real press.
 */
let ownTraversal = false;

function markOwnTraversal(): void {
  // At the start of the history there is nothing to go back to, so `back()`
  // moves nothing and no `navigate` arrives to spend the latch.
  ownTraversal = (navigation()?.currentEntry?.index ?? 0) > 0;
}

/** Was this traversal the app's? Consumed by the one `navigate` it explains. */
export function takeOwnTraversal(): boolean {
  const ours = ownTraversal;
  ownTraversal = false;
  return ours;
}
