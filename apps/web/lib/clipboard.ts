// Doc: docs/import-export.md#the-clipboard
/**
 * Putting a string on the clipboard, where a clipboard that isn't there is the
 * same no as one that refuses.
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
