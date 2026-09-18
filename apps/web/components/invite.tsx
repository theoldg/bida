"use client";

import { isDemo } from "@bida/core";
import { useState } from "react";
import { DemoNoLink } from "./demo";
import { Dialog } from "./dialog";
import { Icon } from "./icons";
import { copy } from "../lib/copy";
import { useInviteLink } from "../lib/hooks";

/**
 * The one way into a group is its link, so the button that hands it over is on
 * two screens — the group's own top bar and People's. One component, because
 * the interesting half is what happens when the clipboard says no: see
 * `InviteFallback`.
 */
export function InviteButton({ groupId }: { groupId: string | undefined }) {
  const invite = useInviteLink(groupId);
  // The demo is the one group whose link is genuinely absent rather than not
  // loaded yet: it has no key, which is the whole of why it never syncs. So
  // the button stays and says so, because a missing button on the one screen
  // that hands the group over reads as the app having lost it.
  const [noLink, setNoLink] = useState(false);
  const demo = isDemo(groupId);
  if (!demo && !invite.copy) return null;
  return (
    <>
      <button className="iconbtn" aria-label={copy.group.copyLink}
        onClick={demo ? () => setNoLink(true) : invite.copy}>
        <Icon name={invite.copied ? "check" : "link"} size={18}
          style={invite.copied ? { color: "var(--brand)" } : undefined} />
      </button>

      {noLink ? <DemoNoLink onClose={() => setNoLink(false)} /> : null}
      <InviteFallback invite={invite} />
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
    <Dialog title={copy.group.linkTitle} onClose={invite.clearFailure}>
      <div className="dbody">
        <p>{copy.group.linkBody}</p>
        {/* `.selectable` because the app turns selection off everywhere
            else — this is the one string a person has to be able to take. */}
        <p className="selectable invitelink">{invite.link}</p>
      </div>
      <div className="drow">
        <button className="btn btn-p" onClick={invite.clearFailure}>{copy.act.close}</button>
      </div>
    </Dialog>
  );
}
