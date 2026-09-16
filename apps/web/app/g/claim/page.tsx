"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { useInstallOffer } from "../../../components/install";
import { UseInApp } from "../../../components/use-in-app";
import { WhoPicker } from "../../../components/who-picker";
import { copy } from "../../../lib/copy";
import { addMember, claimIdentity } from "../../../lib/db/commands";
import { formatJoinLink, route } from "../../../lib/group-link";
import { useGroupData, useGroupSecret } from "../../../lib/hooks";

/**
 * The last step of joining: which of these people are you?
 *
 * `/join` used to hand a new device straight to `/g/members`, which is the
 * right list of names and the wrong screen to be dropped on — it is a
 * management screen, so once you had tapped your name the only way onward was
 * "back", which reads like undoing what you just did.
 *
 * This is the same list with one job, and the same one `/new` finishes on
 * (components/who-picker.tsx). Nothing is written until the button: tapping a
 * name here is a selection, not a claim (which is an op, and public —
 * ADR-0003). It can be changed later on People, where the same names are.
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

  if (!groupId || !data.group) return <Blank back={route.groups()} />;
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
        <TopBar title={copy.claim.title} sub={group.name} back={route.groups()} />

        <Scroll>
          <WhoPicker
            people={data.members.map((m) => ({ id: m.id, name: m.name }))}
            picked={picked ?? data.me}
            addPlaceholder={copy.claim.addPlaceholder}
            onPick={setPicked}
            onAdd={add}
            onContinue={proceed}
          />
          {tab && secret && (
            <div className="pad">
              <UseInApp link={formatJoinLink({ groupId, secret })} />
            </div>
          )}
        </Scroll>
      </Body>
    </Screen>
  );
}
