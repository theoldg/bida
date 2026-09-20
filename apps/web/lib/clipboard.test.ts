import { afterEach, describe, expect, it, vi } from "vitest";
import { hasClipboard, writeClipboardText } from "./clipboard";

/**
 * Node has a `navigator`, and it has no `clipboard` — which is exactly the
 * browser this module exists for, so the absent case needs no setup at all.
 */
const withClipboard = (clipboard: unknown) =>
  vi.spyOn(globalThis, "navigator", "get")
    .mockReturnValue({ clipboard } as unknown as Navigator);

afterEach(() => vi.restoreAllMocks());

describe("writing to the clipboard", () => {
  it("hands the text to the browser's clipboard when there is one", async () => {
    const writeText = vi.fn(async () => {});
    withClipboard({ writeText });
    await expect(writeClipboardText("shh")).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith("shh");
    expect(hasClipboard()).toBe(true);
  });

  it("passes a refusal through as the rejection every caller is written for", async () => {
    withClipboard({ writeText: async () => { throw new Error("denied"); } });
    await expect(writeClipboardText("shh")).rejects.toThrow("denied");
  });

  /**
   * The bug this module was written for: a bare `navigator.clipboard.writeText`
   * throws *synchronously* here, which no rejection handler catches — and on
   * the way out of an in-app browser, which renders outside the error
   * boundary, that took the whole page down.
   */
  it("rejects rather than throws where the browser has no clipboard", async () => {
    expect(hasClipboard()).toBe(false);
    let threw = false;
    let promise: Promise<void> | undefined;
    try { promise = writeClipboardText("shh"); } catch { threw = true; }
    expect(threw).toBe(false);
    await expect(promise).rejects.toThrow();
  });

  it("treats a browser with no navigator at all the same way", async () => {
    vi.spyOn(globalThis, "navigator", "get").mockReturnValue(undefined as unknown as Navigator);
    expect(hasClipboard()).toBe(false);
    await expect(writeClipboardText("shh")).rejects.toThrow();
  });
});
