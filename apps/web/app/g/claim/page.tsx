"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BadLink, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { useInstallOffer } from "@/components/install";
import { UseInApp } from "@/components/use-in-app";
import { WhoPicker } from "@/components/who-picker";
import { copy } from "@/lib/copy";
import { addMember, claimIdentity } from "@/lib/db/commands";
import { formatJoinLink, route } from "@/lib/group-link";
import { useDevice, useGroupData, useGroupSecret } from "@/lib/hooks";

/**
 * The last step of joining: which of these people are you? The same list `/new`
 * finishes on (components/who-picker.tsx), with one job — **never `/g/members`,
 * a management screen whose only way onward is a "back" that reads like undoing
 * what you just did.
 *
 * Nothing is written until the button: tapping a name is a selection, not a
 * claim (which is an op, and public — ADR-0003), and it can be changed later on
 * People.
 */
export default function ClaimPage() {
  return <QueryBoundary><ClaimScreen /></QueryBoundary>;
}

function ClaimScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const secret = useGroupSecret(groupId);
  // An iOS tab only: anywhere else a tapped link already reaches the app.
  const tab = useInstallOffer() === "manual";
  // Re-opening an invite you have already accepted preselects who you are, so
  // it is one tap rather than a puzzle about whether you'll be duplicated.
  const [picked, setPicked] = useState<string>();

  // A group deleted while this phone was standing here (lib/db/sync.ts). There
  // is no question left to answer and no group to answer it about, so the
  // phone is put back on its list rather than asked who it is in nothing. The
  // group screen is where the news is told: this one is a detour on the way in.
  const deleted = useDevice()?.deletedGroups?.includes(groupId ?? "") ?? false;
  useEffect(() => {
    if (deleted) router.replace(route.groups());
  }, [deleted, router]);

  // The same id check every other screen under `/g` makes. **Ask only once the
  // read has answered**: `data.group` is `undefined` for "still reading" and
  // "no such group" alike, so asking sooner leaves a link this phone is still
  // fetching sitting as a bad-link screen. Never over a group known deleted —
  // the redirect above carries that one off (docs/frontend.md#routing).
  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group && !deleted) return <BadLink />;
  if (!data.group) return <Blank back={route.groups()} />;
  const group = data.group;

  async function add(name: string) {
    if (!groupId) throw new Error("no group");
    const id = await addMember(groupId, data.me, name);
    return { id, name };
  }

  async function proceed(memberId: string) {
    if (!groupId) return;
    await claimIdentity(groupId, memberId);
    router.replace(route.group(groupId));
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.claim.join(group.name)} back={route.groups()} />

        <Scroll>
          <h2 className="question">{copy.claim.title}</h2>
          <WhoPicker
            people={data.members.map((m) => ({ id: m.id, name: m.name }))}
            picked={picked ?? data.me}
            addPlaceholder={copy.claim.addPlaceholder}
            onPick={setPicked}
            onAdd={add}
            onContinue={proceed}
          />
        </Scroll>
        {/* Under the scroll, not at the list's end: a group of twenty people
            would push it out of sight, and it is for someone who shouldn't be
            picking a name here at all. */}
        {tab && secret && (
          <div className="inappdock">
            <UseInApp link={formatJoinLink({ groupId, secret })} />
          </div>
        )}
      </Body>
    </Screen>
  );
}
