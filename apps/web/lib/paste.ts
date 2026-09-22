import { mark } from "./diag";

/**
 * Reading the clipboard's text, for **Paste link**.
 *
 * **One read, and what it says is the answer.** An empty read doesn't prove an
 * empty clipboard — iOS may serve a pre-grant snapshot — but every re-read
 * prompts again, costing the person another tap. The paste box is one tap
 * away anyway, so an empty read goes straight there
 * (`components/paste-link.tsx`).
 *
 * Never log what was read: an invite link is the whole of a group's
 * authorisation (`lib/group-link.ts`). Only its length.
 */
export interface Pasteboard {
  read: () => Promise<string>;
}

export const pasteboard: Pasteboard = {
  read: () => navigator.clipboard.readText(),
};

/**
 * The clipboard's text, or `undefined` for a refusal (the person dismissed
 * iOS's Paste bubble — a no, not an error; show nothing). `""` is an empty,
 * non-text or withheld clipboard, all of which want the paste box.
 */
export async function readClipboardText(io: Pasteboard = pasteboard): Promise<string | undefined> {
  let text: string;
  try {
    text = await io.read();
  } catch {
    mark("paste.read", "refused");
    return undefined;
  }
  if (!text.trim()) {
    mark("paste.read", "empty");
    return "";
  }
  mark("paste.read", `${text.length} chars`);
  return text;
}
