"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { BadLinkNotice, KeylessLink } from "@/components/keyless-link";
import { saveGroupKey } from "@/lib/db/commands";
import { db } from "@/lib/db/dexie";
import { useLive } from "@/lib/db/live";
import { syncGroup } from "@/lib/db/sync";
import { useDevice, useSyncHealth } from "@/lib/hooks";
import { handOverToGroup } from "@/lib/launch";
import { copy } from "@/lib/copy";
import { isKeylessFragment, parseJoinLink, route } from "@/lib/group-link";

/**
 * Lands a `/join#<groupId>.<secret>` link: saves the secret, then pulls the
 * group's op log (docs/sync.md).
 *
 * A first sync can fail honestly — offline, or the creator hasn't pushed yet —
 * and the join still stands: the secret is saved, and `StartSync` retries.
 * **So watch the local DB with a live query, never a one-shot check**, and move
 * on the moment the group lands.
 *
 * It moves on *by way of the groups list*: this entry goes to the list and the
 * group is pushed on top (`handOverToGroup`). A link tapped in a chat opens a
 * browser one entry deep, so otherwise back would leave for the chat.
 *
 * **This screen is only ever up while joining**, so the prerendered HTML says
 * "Joining…" before the bundle arrives. Only the rare overrides (bad link,
 * keyless, refused secret) need JS. The body waits for the fragment to be
 * parsed, since it promises things about this link.
 *
 * **`useClaimGate` alone decides whether this phone has said who it is** — not
 * this screen, and not `/g/members`.
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
    // A second invite link opened here is only a hash change — no navigation,
    // no remount. **Read on mount alone and the screen answers about the first
    // link forever**, which bites when the first was refused.
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

  // The one failure waiting can't mend: the server holds this group under a
  // different secret, so every retry is a 403 — a wrong link.
  const { rejected } = useSyncHealth(link ? link.groupId : undefined);
  // An invite link to a group that was deleted. The key is saved and a sync is
  // attempted as usual; the 410 that comes back erases the group here too and
  // writes the id down, which is what this reads (lib/db/commands/groups.ts).
  const gone = useDevice()?.deletedGroups?.includes(link?.groupId ?? "") ?? false;

  useEffect(() => {
    if (!link || !group) return;
    handOverToGroup(link.groupId);
    router.replace(route.groups());
  }, [link, group, router]);

  // `null` is a fragment that has been read and is no link; `undefined` is one
  // that has not been read yet, and falls through to the joining screen below.
  if (link === null && keyless) {
    return (
      <Screen><Body>
        <TopBar title={copy.join.title} back={route.groups()} />
        <Scroll><KeylessLink /></Scroll>
      </Body></Screen>
    );
  }

  // A link to a group somebody deleted. It is not a bad link and waiting will
  // not mend it, so the screen says what happened rather than what to retry
  // (app/delete-my-data/page.tsx).
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

  // The app's name, not "Join a group": this is where a stranger meets bida.
  // `group` means `handOverToGroup` is a frame away, so no promise of waiting.
  return (
    <Screen><Body>
      <TopBar title={<span className="brand">{copy.app.name}</span>} back={route.groups()} />
      <Scroll>
        <Empty title={copy.join.joining.title}>
          {keySaved && !group ? copy.join.joining.body : null}
        </Empty>
      </Scroll>
    </Body></Screen>
  );
}
