"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Avatar, GhostRow } from "../../../components/bits";
import { Blank, Body, Foot, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { PromptDialog } from "../../../components/dialog";
import { Icon } from "../../../components/icons";
import { addMember, claimIdentity } from "../../../lib/db/commands";
import { route } from "../../../lib/group-link";
import { useGroupData } from "../../../lib/hooks";

/**
 * The last step of joining: which of these people are you?
 *
 * `/join` used to hand a new device straight to `/g/members`, which is the
 * right list of names and the wrong screen to be dropped on — it is a
 * management screen, so once you had tapped your name the only way onward was
 * "back", which reads like undoing what you just did.
 *
 * This is the same list with one job. Pick a name, press the button, land in
 * the group. Nothing is written until the button: tapping a name here is a
 * selection, not a claim (which is an op, and public — ADR-0011). It can be
 * changed later on People, where the same names are.
 */
export default function ClaimPage() {
  return <QueryBoundary><ClaimScreen /></QueryBoundary>;
}

function ClaimScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  // Re-opening an invite you have already accepted preselects who you are, so
  // it is one tap rather than a puzzle about whether you'll be duplicated.
  const [picked, setPicked] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = picked ?? data.me;

  if (!groupId || !data.group) return <Blank back={route.groups()} />;
  const group = data.group;

  // Adding yourself here selects you too: you typed your own name, so making
  // it one more tap to say so would be asking the same question twice.
  async function add(name: string) {
    if (!groupId) return;
    setPicked(await addMember(groupId, data.me ?? group.id, name));
    setAdding(false);
  }

  async function proceed() {
    if (!groupId || !chosen || busy) return;
    setBusy(true);
    try {
      await claimIdentity(groupId, chosen);
      router.replace(route.group(groupId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Body>
        <TopBar title="Which one is you?" sub={group.name} back={route.groups()} />

        <Scroll>
          <div className="rows">
            {data.members.map((m) => (
              <button key={m.id} className="row" onClick={() => setPicked(m.id)}>
                <Avatar member={m} />
                <div className="rmain">
                  <div className="rtitle">{m.name}</div>
                </div>
                {m.id === chosen
                  ? <Icon name="check" size={17} style={{ color: "var(--brand)" }} />
                  : null}
              </button>
            ))}

            <GhostRow icon="plus" label={<>I&rsquo;m not on the list</>}
              onClick={() => setAdding(true)} />
          </div>
        </Scroll>
      </Body>

      <Foot>
        <button className="btn btn-p" onClick={proceed} disabled={!chosen || busy}>
          {chosen
            ? `Continue as ${data.memberById.get(chosen)?.name ?? "me"}`
            : "Pick your name to continue"}
        </button>
      </Foot>

      {adding ? (
        <PromptDialog title="Your name" placeholder="Name" confirm="Add"
          autoCapitalize="words" maxLength={40}
          onSubmit={add} onClose={() => setAdding(false)} />
      ) : null}
    </Screen>
  );
}
