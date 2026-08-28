"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { leaveGroup } from "../../../lib/db/commands";
import { route } from "../../../lib/group-link";
import { useGroupData } from "../../../lib/hooks";

/**
 * "Leave this group?" — the confirmation for exiting, named per
 * standing-instructions.md ("consequences get a screen, not a `confirm()`").
 *
 * Leaving is `removeMember` on yourself, so it already tombstones cleanly:
 * your past expenses stay exactly as they were. What this screen adds is
 * naming the one case that isn't reversible the same way — you're the last
 * person left, so leaving also archives the group, for everyone.
 */
export default function LeavePage() {
  return <QueryBoundary><LeaveScreen /></QueryBoundary>;
}

function LeaveScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const [busy, setBusy] = useState(false);

  const back = groupId ? route.members(groupId) : route.groups();

  if (!groupId || !data.group) {
    return <Screen><Body><TopBar title=" " back={back} /></Body></Screen>;
  }

  if (!data.me) {
    return (
      <Screen><Body>
        <TopBar title="Leave group" back={back} />
        <Empty title="This phone isn't anyone here yet">
          Tap a name on the People screen first, so there's a "you" to leave as.
        </Empty>
      </Body></Screen>
    );
  }

  const lastMember = data.members.length === 1 && data.members[0]?.id === data.me;
  const title = lastMember ? "Delete group" : "Leave group";

  async function leave() {
    if (!groupId || !data.me || busy) return;
    setBusy(true);
    try {
      await leaveGroup(groupId, data.me, lastMember);
      router.replace(route.groups());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Body>
        <TopBar title={title} sub={data.group.name} back={back} />

        <Scroll>
          <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {lastMember ? (
              <>
                <p style={{ fontSize: 14, lineHeight: 1.5 }}>
                  You're the last person in <b>{data.group.name}</b>. Leaving deletes the
                  group — there's nobody left to keep it for.
                </p>
                <p className="hint">
                  Its expenses stay in the log, unreachable rather than erased, the same as
                  every other change here. Nothing about it can come back on its own.
                </p>
              </>
            ) : (
              <p style={{ fontSize: 14, lineHeight: 1.5 }}>
                You'll be removed from <b>{data.group.name}</b>. Your past expenses stay
                exactly as they were — removing yourself doesn't redistribute money you
                already owed or were owed.
              </p>
            )}
          </div>
        </Scroll>
      </Body>

      <div style={{ borderTop: "1px solid var(--rule)", flex: "none", padding: "11px 16px" }}>
        <button className="btn btn-d" onClick={leave} disabled={busy}>
          <Icon name="trash" size={15} /> {title}
        </button>
      </div>
    </Screen>
  );
}
