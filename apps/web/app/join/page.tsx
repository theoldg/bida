"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../components/chrome";
import { BadLinkNotice, KeylessLink } from "../../components/keyless-link";
import { saveGroupKey } from "../../lib/db/commands";
import { db } from "../../lib/db/dexie";
import { useLive } from "../../lib/db/live";
import { syncGroup } from "../../lib/db/sync";
import { useSyncHealth } from "../../lib/hooks";
import { copy } from "../../lib/copy";
import { isKeylessFragment, parseJoinLink, route } from "../../lib/group-link";

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
 * Where it moves on *to* is the group itself. A first arrival still ends on
 * "which one is you?", but it is `useClaimGate` that sends it there — one
 * place decides whether this phone has said who it is, and this screen is not
 * a second one. Re-opening a link you have already accepted used to reopen
 * that question, which reads as being asked to join a group you are in; now it
 * just opens the group. (It is not `/g/members` either way: that is a
 * management screen, and a new arrival dropped on it has "back" as its only
 * way onward.)
 */
export default function JoinPage() {
  return <QueryBoundary><JoinScreen /></QueryBoundary>;
}

function JoinScreen() {
  const router = useRouter();
  // Parsed only on the client (window isn't available during the static
  // export's build-time prerender) — undefined means "not parsed yet".
  const [link, setLink] = useState<ReturnType<typeof parseJoinLink> | undefined>(undefined);
  // A fragment that is only a group id: the link lost its password, which is
  // worth a sentence of its own rather than "bad link" (`copy.join.keyless`).
  const [keyless, setKeyless] = useState(false);
  const [keySaved, setKeySaved] = useState(false);

  useEffect(() => {
    const read = () => {
      setLink(parseJoinLink(window.location.hash));
      setKeyless(isKeylessFragment(window.location.hash));
    };
    read();
    // A second invite link opened while this screen is up is a hash change and
    // nothing else — no navigation, no remount — so read on mount alone left
    // the screen answering about the first link forever. Which is worst
    // exactly where it matters: the first one was refused and the good one is
    // what arrives next.
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    // A new link has not been saved yet, whatever the last one did.
    setKeySaved(false);
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

  // `null`, not `undefined`, for a group that hasn't arrived yet: waiting on
  // the network is an answer, and only a read that hasn't answered may be
  // retried (lib/db/live.ts).
  const group = useLive(
    "joinGroup",
    async () => (link ? (await db().groups.get(link.groupId)) ?? null : null),
    [link?.groupId],
  );

  // The one join failure waiting cannot mend: the server has this group
  // registered under a different secret, so every retry is another 403. A
  // link whose secret is wrong is a wrong link, which is what it now says.
  const { rejected } = useSyncHealth(link ? link.groupId : undefined);

  useEffect(() => {
    if (link && group) router.replace(route.group(link.groupId));
  }, [link, group, router]);

  if (link === undefined) return <Blank back={route.groups()} />;

  if (!link && keyless) {
    return (
      <Screen><Body>
        <TopBar title={copy.join.title} back={route.groups()} />
        <Scroll><KeylessLink /></Scroll>
      </Body></Screen>
    );
  }

  if (!link || (keySaved && rejected && !group)) {
    return (
      <Screen><Body>
        <TopBar title={copy.join.title} back={route.groups()} />
        <Scroll><BadLinkNotice /></Scroll>
      </Body></Screen>
    );
  }

  if (!keySaved || group) return <Blank back={route.groups()} />;

  return (
    <Screen><Body>
      <TopBar title={copy.join.title} back={route.groups()} />
      <Scroll>
        <Empty title={copy.join.joining.title}>{copy.join.joining.body}</Empty>
      </Scroll>
    </Body></Screen>
  );
}
