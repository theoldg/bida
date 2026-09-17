"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Dialog } from "./dialog";
import { copy } from "../lib/copy";
import { notePasted } from "../lib/failed-link";
import { formatJoinLink, readPastedLink, route } from "../lib/group-link";

/**
 * Reading the clipboard as an invite, for the Paste link tile and for
 * `/paste`, which is where an empty clipboard sends you and so needs the
 * same button to try again once you have copied something.
 *
 * What was pasted decides where it goes (`readPastedLink`): a link of ours
 * joins; one for another server says so, naming it, since "Bad link" would
 * send the person back for the same link; one with no password opens the
 * group's screen, which is the group if this phone holds it and "missing its
 * password" if not; nothing at all is `/paste`, since "Bad link" blamed a link
 * nobody gave; anything else lands on the join screen's "Bad link". Those
 * show what was pasted (`lib/failed-link.ts`). A refused read is the person
 * dismissing iOS's paste prompt: a no, not an error.
 *
 * `onEmpty` is for `/paste` itself, where going to `/paste` again would
 * change nothing on screen.
 */
export function usePasteLink(onEmpty?: () => void): { paste: () => Promise<void>; dialog: ReactNode } {
  const router = useRouter();
  const [elsewhere, setElsewhere] = useState<string>();

  async function paste() {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    const pasted = readPastedLink(text, window.location.origin);
    if (pasted.kind === "elsewhere") return setElsewhere(pasted.host);
    // A document load, not `router.push`: the router can drop the fragment,
    // which is the password (docs/ios.md#gotchas).
    if (pasted.kind === "join") return location.assign(formatJoinLink(pasted.link, ""));
    if (pasted.kind === "empty") return onEmpty ? onEmpty() : router.push(route.paste());
    const to = pasted.kind === "keyless" ? route.group(pasted.groupId) : route.join();
    notePasted(text, to);
    router.push(to);
  }

  const dialog = elsewhere ? (
    <Dialog title={copy.groups.elsewhere.title} onClose={() => setElsewhere(undefined)}>
      <div className="dbody"><p>{copy.groups.elsewhere.body(elsewhere)}</p></div>
      <div className="drow">
        <button className="btn btn-p" onClick={() => setElsewhere(undefined)}>{copy.act.close}</button>
      </div>
    </Dialog>
  ) : null;

  return { paste, dialog };
}
