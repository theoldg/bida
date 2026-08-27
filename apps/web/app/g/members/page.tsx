"use client";

import { useSearchParams } from "next/navigation";
import { Avatar } from "../../../components/bits";
import { Banner, Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { addMember, removeMember, renameMember } from "../../../lib/db/commands";
import { setMe } from "../../../lib/db/device";
import { formatJoinLink, route } from "../../../lib/group-link";
import { useGroupData, useGroupSecret } from "../../../lib/hooks";

export default function MembersPage() {
  return <QueryBoundary><MembersScreen /></QueryBoundary>;
}

function MembersScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const secret = useGroupSecret(groupId);

  if (!groupId || !data.group) return <Screen><Body><TopBar title=" " back={true} /></Body></Screen>;
  const group = data.group;

  async function invite() {
    if (!groupId || !secret) return;
    const link = formatJoinLink({ groupId, secret });
    if (navigator.share) {
      try { await navigator.share({ title: `Join ${group!.name} on Hajsik`, url: link }); }
      catch { /* user cancelled the share sheet */ }
      return;
    }
    await navigator.clipboard.writeText(link);
    alert("Invite link copied");
  }

  async function claim(memberId: string) {
    if (!groupId) return;
    await setMe(groupId, memberId);
  }

  async function rename(memberId: string, current: string) {
    if (!groupId) return;
    const name = prompt("New name", current)?.trim();
    if (!name || name === current) return;
    await renameMember(groupId, data.me ?? memberId, memberId, name);
  }

  async function remove(memberId: string, name: string) {
    if (!groupId) return;
    if (!confirm(`Remove ${name}? Their past expenses stay exactly as they were.`)) return;
    await removeMember(groupId, data.me ?? memberId, memberId);
  }

  async function add() {
    if (!groupId) return;
    const name = prompt("Name")?.trim();
    if (!name) return;
    const memberId = await addMember(groupId, data.me ?? group.id, name);
    // A brand-new phone that just created this member is almost certainly them.
    if (!data.me) await setMe(groupId, memberId);
  }

  return (
    <Screen>
      <Body>
        <TopBar title="People" sub={group.name} back={route.group(groupId)}
          right={secret ? (
            <button className="iconbtn" aria-label="Invite" onClick={invite}>
              <Icon name="link" size={16} />
            </button>
          ) : null} />

        <Scroll>
          {!data.me ? (
            <div className="pad" style={{ paddingBottom: 0 }}>
              <Banner icon="users">Tap your name below so the app knows who you are on this phone.</Banner>
            </div>
          ) : null}

          <div className="rows">
            {data.members.map((m) => (
              <div key={m.id} className="row" style={{ cursor: data.me ? undefined : "pointer" }}
                onClick={!data.me ? () => claim(m.id) : undefined}>
                <Avatar member={m} />
                <div className="rmain">
                  <div className="rtitle">{m.name}</div>
                  <div className="rmeta">{m.id === data.me ? "You" : !data.me ? "Tap if this is you" : ""}</div>
                </div>
                {data.me ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="iconbtn" aria-label="Rename" onClick={() => rename(m.id, m.name)}>
                      <Icon name="edit" size={14} />
                    </button>
                    <button className="iconbtn" aria-label="Remove" onClick={() => remove(m.id, m.name)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ) : null}
              </div>
            ))}

            <div className="row" style={{ paddingTop: 16, cursor: "pointer" }} onClick={add}>
              <span className="avatar" style={{
                background: "transparent", borderStyle: "dashed", color: "var(--muted)",
              }}><Icon name="plus" size={15} /></span>
              <div className="rmain">
                <div className="rtitle" style={{ color: "var(--muted)", fontWeight: 500 }}>Add member</div>
              </div>
            </div>
          </div>
        </Scroll>
      </Body>
    </Screen>
  );
}
