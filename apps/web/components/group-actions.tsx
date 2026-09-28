"use client";

import { isDemo } from "@bida/core";
import { useState, type ReactNode } from "react";
import { copy } from "../lib/copy";
import { clearDemo, forgetGroup } from "../lib/db/commands";
import { route } from "../lib/group-link";
import { useHost } from "../lib/hooks";
import { ConfirmDialog } from "./dialog";
import { useCopyLink } from "./invite";
import type { SheetAction } from "./row-menu";

/**
 * What a group can be asked for from outside its ledger — copy its link, take
 * it off this phone — as menu actions, plus the dialogs they open. The groups
 * list's long press and the group's kebab offer the same two.
 *
 * **Forgetting doesn't wait for a claim**: an unclaimed group is the one most
 * wanted off the list, and `forgetGroup` is purely local. The demo clears
 * instead: forgetting only hides, and a hidden demo with no link to reopen it is
 * a group that is gone and still on disk (lib/db/commands/demo.ts).
 */
export function useGroupActions(groupId: string, afterForget?: () => void): {
  copyLink: SheetAction[];
  forget: SheetAction;
  copied: boolean;
  dialogs: ReactNode;
} {
  const link = useCopyLink(groupId);
  const [asking, setAsking] = useState(false);
  const demo = isDemo(groupId);
  // Clearing the demo names the address that lays a fresh one down, and only
  // the browser knows which host that is.
  const host = useHost();
  const label = demo ? copy.demo.clear : copy.members.forget;

  async function forget() {
    if (demo) await clearDemo();
    else await forgetGroup(groupId);
    afterForget?.();
  }

  return {
    copyLink: link.copy ? [{ label: copy.group.copyLink, icon: "link", onSelect: link.copy }] : [],
    forget: { label, icon: "trash", danger: true, onSelect: () => setAsking(true) },
    copied: link.copied,
    dialogs: (
      <>
        {link.dialogs}
        {asking ? (
          <ConfirmDialog title={label} confirm={label} danger={true}
            onConfirm={forget} onClose={() => setAsking(false)}>
            <p>{demo ? copy.demo.clearBody(`${host}${route.demo()}`) : copy.members.forgetBody}</p>
          </ConfirmDialog>
        ) : null}
      </>
    ),
  };
}
