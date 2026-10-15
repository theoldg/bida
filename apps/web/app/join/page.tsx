"use client";
// Doc: docs/sync.md
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { JoiningFrame } from "@/components/joining";
import { BadLinkNotice, KeylessLink } from "@/components/keyless-link";
import { saveGroupKey } from "@/lib/db/commands";
import { db } from "@/lib/db/dexie";
import { useLive } from "@/lib/db/live";
import { syncGroup } from "@/lib/db/sync";
import { useDevice, usePullPercent, useSyncHealth } from "@/lib/hooks";
import { copy } from "@/lib/copy";
import { isKeylessFragment, parseJoinLink, route } from "@/lib/group-link";

export default function JoinPage() {
  return <QueryBoundary><JoinScreen /></QueryBoundary>;
}

function JoinScreen() {
  const router = useRouter();
  const [link, setLink] = useState<ReturnType<typeof parseJoinLink> | undefined>(undefined);
  const [keyless, setKeyless] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const read = () => {
      setLink(parseJoinLink(window.location.hash));
      setKeyless(isKeylessFragment(window.location.hash));
    };
    read();
    // A second invite link opened here is only a hash change: read on mount
    // alone, the screen answers about the first link forever.
    addEventListener("hashchange", read);
    return () => removeEventListener("hashchange", read);
  }, []);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    setKeySaved(false);
    setSlow(false);
    router.prefetch(route.group(link.groupId));
    router.prefetch(route.claim(link.groupId));
    (async () => {
      await saveGroupKey(link.groupId, link.secret);
      if (cancelled) return;
      setKeySaved(true);
      syncGroup(link.groupId).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [link, router]);

  useEffect(() => {
    if (!keySaved) return;
    const timer = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(timer);
  }, [keySaved]);

  // `null`, not `undefined`: only a read that hasn't answered may be retried
  // (lib/db/live.ts).
  const group = useLive(
    "joinGroup",
    async () => (link ? (await db().groups.get(link.groupId)) ?? null : null),
    [link?.groupId],
  );

  const { rejected } = useSyncHealth(link ? link.groupId : undefined);
  const percent = usePullPercent(link ? link.groupId : undefined);
  const device = useDevice();
  const gone = device?.deletedGroups?.includes(link?.groupId ?? "") ?? false;
  const claimed = link && device ? !!device.meByGroup[link.groupId] : undefined;

  // Straight to the screen, by address: a full load on the way — the first tap
  // after a deploy is one — lands on it all the same. Back from it climbs to
  // the list (`settleFloor`, lib/back-button.ts), which is never visited.
  useEffect(() => {
    if (!link || !group || claimed === undefined) return;
    router.replace(claimed ? route.group(link.groupId) : route.claim(link.groupId));
  }, [link, group, claimed, router]);

  if (link === null && keyless) {
    return (
      <Screen><Body>
        <TopBar title={copy.join.title} back={route.groups()} />
        <Scroll><KeylessLink /></Scroll>
      </Body></Screen>
    );
  }

  if (gone && !group) {
    return (
      <Screen><Body>
        <TopBar title={copy.join.title} back={route.groups()} />
        <Scroll>
          <Empty title={copy.join.deleted.title}>{copy.join.deleted.body}</Empty>
        </Scroll>
      </Body></Screen>
    );
  }

  if (link === null || (keySaved && rejected && !group)) {
    return (
      <Screen><Body>
        <TopBar title={copy.join.title} back={route.groups()} />
        <Scroll><BadLinkNotice /></Scroll>
      </Body></Screen>
    );
  }

  // Counting pages is an answer: "offline, or nobody has synced" would be wrong.
  return (
    <JoiningFrame percent={group ? undefined : percent}>
      {slow && !group && percent === undefined ? copy.join.joining.body : null}
    </JoiningFrame>
  );
}
