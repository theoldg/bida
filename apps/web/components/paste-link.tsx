"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Dialog, PromptDialog } from "./dialog";
import { copy } from "../lib/copy";
import { db } from "../lib/db/dexie";
import { notePasted } from "../lib/failed-link";
import { formatJoinLink, readPastedLink, route } from "../lib/group-link";
import { readClipboardText } from "../lib/paste";

/**
 * Reading the clipboard as an invite, for the Paste link tile.
 *
 * What was pasted decides where it goes (`readPastedLink`): a link of ours
 * joins, or opens the group if this phone already holds it; one for another server says so, naming it, since "Bad link" would
 * send the person back for the same link; one with no password opens the
 * group's screen, which is the group if this phone holds it and "missing its
 * password" if not; anything else lands on the join screen's "Bad link". Those
 * show what was pasted (`lib/failed-link.ts`). A refused read is the person
 * dismissing iOS's paste prompt: a no, not an error.
 *
 * **Nothing on the clipboard opens a box to paste into**, never a screen saying
 * so: iOS hands the pasteboard over on its own terms and an empty read is not
 * an empty clipboard (`lib/paste.ts`) — but a field is. Touch and hold, Paste,
 * and the same routing runs on what lands there.
 */
export function usePasteLink(): { paste: () => Promise<void>; dialog: ReactNode } {
  const router = useRouter();
  const [elsewhere, setElsewhere] = useState<string>();
  const [box, setBox] = useState(false);

  async function paste() {
    // `undefined` is a refused read — the person dismissing iOS's paste
    // prompt: a no, not an error, and nothing to show for it.
    const text = await readClipboardText();
    if (text === undefined) return;
    await open(text);
  }

  /** Where a pasted string goes — from the clipboard, or from the box. */
  async function open(text: string) {
    const pasted = readPastedLink(text, window.location.origin);
    if (pasted.kind === "elsewhere") return setElsewhere(pasted.host);
    if (pasted.kind === "join") {
      // A group this phone already holds has no password left to save, so it
      // needs no page load: two copies of the app, one frozen in the page
      // cache, held the database from each other for a minute (docs/ios.md).
      if (await db().groupKeys.get(pasted.link.groupId)) return router.push(route.group(pasted.link.groupId));
      // A document load, not `router.push`: the router can drop the fragment,
      // which is the password. `replace`, so the page left behind isn't kept
      // to hold the database while `/join` writes to it (docs/ios.md#gotchas).
      return location.replace(formatJoinLink(pasted.link, ""));
    }
    if (pasted.kind === "empty") return setBox(true);
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
  ) : box ? (
    <PromptDialog title={copy.paste.title} confirm={copy.paste.open}
      placeholder={copy.paste.placeholder} autoCapitalize="none"
      onClose={() => setBox(false)}
      onSubmit={async (typed) => { setBox(false); await open(typed); }} />
  ) : null;

  return { paste, dialog };
}
