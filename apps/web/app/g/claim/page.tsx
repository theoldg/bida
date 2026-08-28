"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Avatar } from "../../../components/bits";
import { Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
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
 * selection, not a claim (which is an op, and public — ADR-0011).
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
  const [busy, setBusy] = useState(false);
  const chosen = picked ?? data.me;

  if (!groupId || !data.group) {
    return <Screen><Body><TopBar title=" " back={route.groups()} /></Body></Screen>;
  }
  const group = data.group;

  async function add() {
    if (!groupId) return;
    const name = prompt("Your name")?.trim();
    if (!name) return;
    setPicked(await addMember(groupId, data.me ?? group.id, name));
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
          <div className="pad" style={{ paddingBottom: 4 }}>
            <p className="hint" style={{ margin: "0 2px 4px" }}>
              So your share, and every edit you make, is filed under the right name.
              You can change it later in the group&rsquo;s options.
            </p>
          </div>

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

            <button className="row" style={{ paddingTop: 16 }} onClick={add}>
              <span className="avatar" style={{
                background: "transparent", borderStyle: "dashed", color: "var(--muted)",
              }}><Icon name="plus" size={15} /></span>
              <div className="rmain">
                <div className="rtitle" style={{ color: "var(--muted)", fontWeight: 500 }}>
                  I&rsquo;m not on the list
                </div>
              </div>
            </button>
          </div>
        </Scroll>
      </Body>

      <div style={{ borderTop: "1px solid var(--rule)", flex: "none", padding: "11px 16px" }}>
        <button className="btn btn-p" onClick={proceed} disabled={!chosen || busy}>
          {chosen
            ? `Continue as ${data.memberById.get(chosen)?.name ?? "me"}`
            : "Pick your name to continue"}
        </button>
      </div>
    </Screen>
  );
}
