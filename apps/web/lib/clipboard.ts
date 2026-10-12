// Doc: docs/import-export.md#the-clipboard
// Checks that the clipboard works, and that there is one at all.

export function hasClipboard(): boolean {
  return typeof navigator !== "undefined" && navigator.clipboard != null;
}

export function writeClipboardText(text: string): Promise<void> {
  return hasClipboard()
    ? navigator.clipboard.writeText(text)
    : Promise.reject(new Error("this browser has no clipboard"));
}
