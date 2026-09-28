"use client";

import { isDemo } from "@bida/core";
import { useState, type ReactNode } from "react";
import { keepsFocus } from "./bits";
import { DemoNoLink } from "./demo";
import { NoticeDialog } from "./dialog";
import { FlipCheck } from "./icons";
import { copy } from "../lib/copy";
import { useInviteLink } from "../lib/hooks";

/**
 * Copying a group's link, wherever it is offered: the group's top bar,
 * People's, the groups list's long press, the group's kebab. `copy` is
 * undefined while there is no link to copy; `dialogs` is what a copy can leave
 * on screen.
 *
 * The demo is the one group whose link is genuinely absent rather than not
 * loaded yet: it has no key, which is the whole of why it never syncs. So its
 * copy stays and says so (`DemoNoLink`), because a missing control on the one
 * screen that hands the group over reads as the app having lost it.
 */
export function useCopyLink(groupId: string | undefined): {
  copy: (() => void) | undefined;
  copied: boolean;
  dialogs: ReactNode;
} {
  const invite = useInviteLink(groupId);
  const [noLink, setNoLink] = useState(false);
  return {
    copy: isDemo(groupId) ? () => setNoLink(true) : invite.copy,
    copied: invite.copied,
    dialogs: (
      <>
        {noLink ? <DemoNoLink onClose={() => setNoLink(false)} /> : null}
        <InviteFallback invite={invite} />
      </>
    ),
  };
}

/**
 * The one way into a group is its link, so the button that hands it over is on
 * two screens — the group's own top bar and People's. The interesting half is
 * what happens when the clipboard says no: see `InviteFallback`.
 */
export function InviteButton({ groupId }: { groupId: string | undefined }) {
  const link = useCopyLink(groupId);
  if (!link.copy) return null;
  return (
    <>
      <button className="iconbtn" aria-label={copy.group.copyLink}
        onClick={link.copy} {...keepsFocus}>
        <FlipCheck name="link" size={18} on={link.copied} />
      </button>
      {link.dialogs}
    </>
  );
}

/**
 * What a refused clipboard leaves behind: the link on screen to be read,
 * rather than a control that looks broken. Every way of offering the link —
 * the button above, the groups list's row menu — needs this, so it renders
 * nothing until the copy actually fails.
 */
export function InviteFallback({ invite }: { invite: ReturnType<typeof useInviteLink> }) {
  if (!invite.failed || !invite.link) return null;
  return (
    <NoticeDialog title={copy.group.linkTitle} onClose={invite.clearFailure}>
      <p>{copy.group.linkBody}</p>
      {/* `.selectable` because the app turns selection off everywhere
          else — this is the one string a person has to be able to take. */}
      <p className="selectable invitelink">{invite.link}</p>
    </NoticeDialog>
  );
}
