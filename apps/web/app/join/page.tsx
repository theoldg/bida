"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../components/chrome";
import { saveGroupKey } from "../../lib/db/commands";
import { db } from "../../lib/db/dexie";
import { parseJoinLink, route } from "../../lib/group-link";

/**
 * Lands a `/join#<groupId>.<secret>` link. There is no sync yet (Phase 3), so
 * this can only actually seat a second device once that ships — today it can
 * only re-open a group already on *this* device (e.g. the creator's own link,
 * or a link opened twice). It still stores the secret either way, so nothing
 * has to be re-typed once sync lands.
 */
export default function JoinPage() {
  return <QueryBoundary><JoinScreen /></QueryBoundary>;
}

type State = { kind: "checking" } | { kind: "bad-link" } | { kind: "not-here"; groupId: string };

function JoinScreen() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const link = parseJoinLink(window.location.hash);
      if (!link) { setState({ kind: "bad-link" }); return; }

      await saveGroupKey(link.groupId, link.secret);
      const group = await db().groups.get(link.groupId);
      if (cancelled) return;

      if (group) router.replace(route.members(link.groupId));
      else setState({ kind: "not-here", groupId: link.groupId });
    })();
    return () => { cancelled = true; };
  }, [router]);

  if (state.kind === "checking") {
    return <Screen><Body><TopBar title=" " back={route.groups()} /></Body></Screen>;
  }

  if (state.kind === "bad-link") {
    return (
      <Screen><Body>
        <TopBar title="Join a group" back={route.groups()} />
        <Empty title="That link doesn't look right">
          Ask whoever shared it to send the invite link again.
        </Empty>
      </Body></Screen>
    );
  }

  return (
    <Screen><Body>
      <TopBar title="Join a group" back={route.groups()} />
      <Scroll>
        <Empty title="This group isn't on your phone yet">
          Syncing between devices isn't built yet — for now, this link only works on the
          phone the group was created on. Your invite has been saved, so once syncing
          ships this device will be able to pull the group automatically.
        </Empty>
      </Scroll>
    </Body></Screen>
  );
}
