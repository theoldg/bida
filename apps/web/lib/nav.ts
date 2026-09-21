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
 * **Leaving takes any open dialog with it, before the going rather than with
 * the screen.**
 *
 * A modal `<dialog>` is in the top layer with a close watcher registered on it,
 * and a traversal begun underneath one is a traversal Android does not deliver:
 * `history.go` is called from the act's own tap, returns, and nothing moves —
 * the card is still there and the screen has not left. Discard on `/new` was
 * dead for exactly this reason, and every other act that navigates out of a
 * dialog sits on the same hazard.
 *
 * `close()` empties the top layer synchronously, and the element's own `close`
 * listener is what tells the state still drawing it (components/dialog.tsx), so
 * the card is down before the first line of the navigation runs.
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
 * A back press this app *refused* — cancelled, so the dialog could ask
 * ([back-button.ts](./back-button.ts)) — leaves Android holding a traversal it
 * will not deliver again. The `history.go` that Discard then asks for returns
 * and nothing moves: no `navigate` event, no error, the card gone and the
 * screen still there. It is only ever after a refused press; the same tap from
 * the back arrow, on the same screen, goes.
 *
 * So the traversal is asked for and then *checked*: still on the same entry a
 * beat later is one that was swallowed, and the destination is put in this
 * screen's place instead — the same landing by the other door, and a push
 * rather than a traversal, which is not the queue that is stuck.
 *
 * **A wrong guess costs an entry, never the act.** A traversal that was merely
 * late arrives after the replace and spends itself on an entry that is already
 * the destination — the screen is right either way. That is the opposite trade
 * from the one `traverseTo` forced (see this file's head), which is why a clock
 * is allowed to decide this and not that — and why it is short. A delivered
 * traversal lands in about ten milliseconds; the wait is time somebody spends
 * looking at the screen they just asked to leave, so the margin buys nothing a
 * person wants. What a phone slow enough to overrun it pays is one duplicate
 * entry, which is a back press, not a wrong screen (docs/testing.md).
 */
const SWALLOWED_MS = 150;

/**
 * Go, and put the destination here if the going is swallowed.
 *
 * **Every exit in this app names somewhere to land**, which is the whole of
 * why one check can cover them all: `goUp` names the parent it counted back
 * to, and `goBack` reads the entry it is stepping onto off the stack. An exit
 * with no destination is the one thing no check can rescue, and that is what
 * Discard on the entry form was for three rounds — the traversal swallowed,
 * nothing to put in its place, and the screen left believing it had gone.
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
 * Move to `href` as an ancestor: back out to it if we came through it, and
 * otherwise take its place. Either way nothing that was below it stays behind
 * us, so the next press of the device's back button leaves the parent too.
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
 * below, Done, Discard. Anything in the app that goes back goes through here or
 * `goUp`, never `router.back()` directly — see `takeOwnTraversal`.
 *
 * **It names no parent, so it reads one.** The entry behind us is where
 * `back()` is going by definition, so it can be taken off the stack rather
 * than decided at each call — correct by construction, and nothing for a
 * caller to get wrong. That is what gives this door the swallow check too.
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

/**
 * **And spent by the next thing the hand does, because a traversal that never
 * arrives leaves it armed and an armed latch swallows a real press.**
 *
 * That is not hypothetical and it is not cheap: `history.go` can be called and
 * simply not move — the traversal is never delivered and no `navigate` comes to
 * spend this. The next press of the device's button is then read as the app's
 * own, waved through with no guard, and the screen that was holding typed work
 * loses it with no dialog and no warning. That is the whole of what `/new` was
 * doing, and the trace said so: `back.press ours` on a press whose own
 * `userInitiated` was `true`.
 *
 * So the latch also ends at the next press or keystroke anywhere. The app's
 * traversal arrives long before a hand can move again; a hand that *has* moved
 * is proof it is not coming. Still not a clock — the same reasoning the click
 * guard is built on (lib/click-guard.ts), and it fails the safe way: a latch
 * dropped too early costs a "discard?" nobody needed, where one held too long
 * costs the work.
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
