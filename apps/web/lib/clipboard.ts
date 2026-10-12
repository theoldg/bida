// Doc: docs/import-export.md#the-clipboard

export function hasClipboard(): boolean {
  return typeof navigator !== "undefined" && navigator.clipboard != null;
}

/** Rejects, never throws, when the write fails or there is no clipboard at all. */
export function writeClipboardText(text: string): Promise<void> {
  return hasClipboard()
    ? navigator.clipboard.writeText(text)
    : Promise.reject(new Error("this browser has no clipboard"));
}
