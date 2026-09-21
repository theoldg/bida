import { mark } from "./diag";

/**
 * Reading the clipboard's text, for **Paste link**.
 *
 * **One read, and what it says is the answer.** An empty read is not proof of
 * an empty clipboard — iOS hands the pasteboard over on its own terms, and the
 * read that drew the Paste bubble can still be served from the web content
 * process's pre-grant snapshot — but a re-read is not free the way a retry
 * elsewhere is: iOS prompts again, so every extra read is another tap the
 * person is asked for. Three reads cost the owner's iPhone four taps before
 * the box it ends at appeared (2026-09-21). The box is a better answer than a
 * retry and is one tap away regardless, so an empty read goes straight there
 * (`components/paste-link.tsx`).
 *
 * Never log what was read: the clipboard holds an invite link, which is the
 * whole of a group's authorisation (`lib/group-link.ts`). Only its length.
 */
export interface Pasteboard {
  read: () => Promise<string>;
}

export const pasteboard: Pasteboard = {
  read: () => navigator.clipboard.readText(),
};

/**
 * The clipboard's text, or `undefined` for a refusal.
 *
 * A refusal is the person dismissing iOS's Paste bubble, so it is a no and not
 * an error: the caller shows nothing. `""` means the read came back with
 * nothing — a clipboard that really is empty, one holding a picture, or one
 * iOS withheld — and every one of those wants the same thing, which is
 * somewhere to paste by hand.
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
