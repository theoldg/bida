"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../components/chrome";
import { saveGroupKey } from "../../lib/db/commands";
import { db } from "../../lib/db/dexie";
import { syncGroup } from "../../lib/db/sync";
import { parseJoinLink, route } from "../../lib/group-link";

/**
 * Lands a `/join#<groupId>.<secret>` link: saves the secret, then pulls the
 * group's op log from the server (see docs/sync.md) so a second device can
 * actually seat itself, not just recognise a group it already had locally.
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
      try {
        await syncGroup(link.groupId);
      } catch {
        // Offline, or the server hasn't seen this group yet — fall through
        // to the local check below, which handles both honestly.
      }
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
        <Empty title="Couldn't find that group yet">
          Your invite has been saved, so this will work as soon as the other phone is back
          online and has synced at least once — try opening the link again in a minute.
        </Empty>
      </Scroll>
    </Body></Screen>
  );
}
