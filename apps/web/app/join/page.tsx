"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../components/chrome";
import { saveGroupKey } from "../../lib/db/commands";
import { db } from "../../lib/db/dexie";
import { syncGroup } from "../../lib/db/sync";
import { parseJoinLink, route } from "../../lib/group-link";

/**
 * Lands a `/join#<groupId>.<secret>` link: saves the secret, then pulls the
 * group's op log from the server (see docs/sync.md) so a second device can
 * actually seat itself, not just recognise a group it already had locally.
 *
 * The first sync attempt can fail honestly — offline, or the creating device
 * hasn't pushed yet — without the join itself having failed: the secret is
 * saved either way, and `StartSync`'s background loop (root layout) keeps
 * retrying with backoff and on reconnect. So this screen watches the local DB
 * with a live query rather than a one-shot check: the moment the group lands
 * (from this attempt or a later background retry), it moves on by itself —
 * nobody has to be told to reopen the link.
 *
 * Where it moves on *to* is `/g/claim`, not `/g/members`: joining ends with
 * "which one is you?" and a button into the group, rather than dropping a new
 * arrival on a management screen whose only way onward is "back".
 */
export default function JoinPage() {
  return <QueryBoundary><JoinScreen /></QueryBoundary>;
}

function JoinScreen() {
  const router = useRouter();
  // Parsed only on the client (window isn't available during the static
  // export's build-time prerender) — undefined means "not parsed yet".
  const [link, setLink] = useState<ReturnType<typeof parseJoinLink> | undefined>(undefined);
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    setLink(parseJoinLink(window.location.hash));
  }, []);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    (async () => {
      await saveGroupKey(link.groupId, link.secret);
      if (cancelled) return;
      setKeySaved(true);
      // Best-effort kick — a failure here is fine to ignore: the live query
      // below and the background sync loop (StartSync) retry this group
      // regardless, so there's nothing further to do with a rejection.
      syncGroup(link.groupId).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [link]);

  const group = useLiveQuery(
    () => (link ? db().groups.get(link.groupId) : undefined),
    [link?.groupId],
  );

  useEffect(() => {
    if (link && group) router.replace(route.claim(link.groupId));
  }, [link, group, router]);

  if (link === undefined) return <Blank back={route.groups()} />;

  if (!link) {
    return (
      <Screen><Body>
        <TopBar title="Join a group" back={route.groups()} />
        <Empty title="That link doesn't look right">
          Ask whoever shared it to send the invite link again.
        </Empty>
      </Body></Screen>
    );
  }

  if (!keySaved || group) return <Blank back={route.groups()} />;

  return (
    <Screen><Body>
      <TopBar title="Join a group" back={route.groups()} />
      <Scroll>
        <Empty title="Joining…">
          This finishes by itself once the other phone has synced. No need to reopen
          the link.
        </Empty>
      </Scroll>
    </Body></Screen>
  );
}
