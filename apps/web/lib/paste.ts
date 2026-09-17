import { mark } from "./diag";

/**
 * Reading the clipboard's text, for **Paste link**.
 *
 * One empty read is not an empty clipboard. Safari's DOM-paste access is
 * keyed to the pasteboard's change count: tapping iOS's Paste bubble grants
 * access *for that change count*, and the read that drew the bubble can still
 * be served from the web content process's pre-grant snapshot — so the call
 * that asked comes back `""`, and the next one, now granted silently, has the
 * text. Resuming the app is the other way in: for a moment after the app comes
 * back, the pasteboard isn't there yet and a read resolves empty rather than
 * waiting. Both look the same from here, and re-reading cures both, so an
 * empty answer is asked again before it is believed. The honest empty
 * clipboard pays a quarter second for it.
 *
 * Never log what was read: the clipboard holds an invite link, which is the
 * whole of a group's authorisation (`lib/group-link.ts`). Only its length.
 */
export interface Pasteboard {
  read: () => Promise<string>;
  sleep: (ms: number) => Promise<void>;
}

export const pasteboard: Pasteboard = {
  read: () => navigator.clipboard.readText(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * How long to wait before each re-read. The first is immediate — the
 * post-grant snapshot is there by the next turn of the loop — and the second
 * covers the resume, where the pasteboard is still arriving.
 */
const RETRY_MS = [0, 250];

/**
 * The clipboard's text, or `undefined` for a refusal.
 *
 * A refusal is the person dismissing iOS's Paste bubble, so it is a no and not
 * an error: the caller shows nothing. `""` means the clipboard really is empty
 * — or holds a picture, which iOS reads as `""` too. A refused *re-read* is
 * `""` rather than `undefined`: the first read was allowed, so nobody said no,
 * and a silent return there would leave the screen frozen with no answer.
 */
export async function readClipboardText(io: Pasteboard = pasteboard): Promise<string | undefined> {
  let text: string;
  try {
    text = await io.read();
  } catch {
    mark("paste.read", "refused");
    return undefined;
  }
  if (text.trim()) {
    mark("paste.read", `${text.length} chars`);
    return text;
  }

  for (const wait of RETRY_MS) {
    mark("paste.read", `empty, retrying in ${wait}ms`);
    if (wait) await io.sleep(wait);
    try {
      text = await io.read();
    } catch {
      mark("paste.read", "refused on a re-read");
      return "";
    }
    if (text.trim()) {
      mark("paste.read", `${text.length} chars on a re-read`);
      return text;
    }
  }
  mark("paste.read", "empty");
  return "";
}
