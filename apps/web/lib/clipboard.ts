/**
 * Putting a string on the clipboard — the app's one way of handing something
 * over: an invite link, a CSV, a diag report, a quick split.
 *
 * Every caller already treats a refusal as an answer rather than an error: an
 * insecure context or a denied permission rejects `writeText`, and the screen
 * puts the text up to be read instead. What none of them survived is the
 * clipboard **not being there at all** — `navigator.clipboard` is `undefined`
 * in a browser that ships without it, and `navigator.clipboard.writeText(…)`
 * then throws before there is a promise for a rejection handler to catch.
 *
 * That was fatal in exactly the place it could least afford to be. The escape
 * screen (`components/embedded.tsx`) copies the link on arrival, and it renders
 * *outside* `ReadErrorBoundary` — so in an in-app browser with no clipboard the
 * throw took the page down to Next's "Application error", on the one screen
 * those visitors ever get and whose whole job is to hand over the link.
 *
 * So the read goes through one door, and **a clipboard that isn't there is the
 * same no as one that refuses** — the shape every caller was already written
 * for. Reading has its own door for its own reasons (`lib/paste.ts`).
 */

/** Is there a clipboard to write to? For a control that should say something else without one. */
export function hasClipboard(): boolean {
  return typeof navigator !== "undefined" && navigator.clipboard != null;
}

/** The write, rejecting rather than throwing where there is nothing to write to. */
export function writeClipboardText(text: string): Promise<void> {
  return hasClipboard()
    ? navigator.clipboard.writeText(text)
    : Promise.reject(new Error("this browser has no clipboard"));
}
