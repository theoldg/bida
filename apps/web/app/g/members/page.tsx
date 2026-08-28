"use client";

import { useSearchParams } from "next/navigation";
import { Avatar } from "../../../components/bits";
import { Banner, Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { addMember, claimIdentity, removeMember, renameMember } from "../../../lib/db/commands";
import { route } from "../../../lib/group-link";
import { useGroupData, useInviteLink } from "../../../lib/hooks";

/**
 * People: who is in the group, and which of them this phone is.
 *
 * Identity used to be a second copy of this same list on the group options
 * screen. One list, one place to tap: the check mark is who you are, and
 * tapping another name moves it — an op on the shared log, like every other
 * change (ADR-0011).
 */
export default function MembersPage() {
  return <QueryBoundary><MembersScreen /></QueryBoundary>;
}

function MembersScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const invite = useInviteLink(groupId);

  if (!groupId || !data.group) return <Screen><Body><TopBar title=" " back={true} /></Body></Screen>;
  const group = data.group;

  async function claim(memberId: string) {
    if (!groupId || memberId === data.me) return;
    await claimIdentity(groupId, memberId);
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
    if (!data.me) await claimIdentity(groupId, memberId);
  }

  return (
    <Screen>
      <Body>
        <TopBar title="People" back={route.group(groupId)}
          right={invite.copy ? (
            <button className="iconbtn" aria-label="Copy invite link" onClick={invite.copy}>
              <Icon name={invite.copied ? "check" : "link"} size={16}
                style={invite.copied ? { color: "var(--brand)" } : undefined} />
            </button>
          ) : null} />

        <Scroll>
          {!data.me ? (
            <div className="pad" style={{ paddingBottom: 0 }}>
              <Banner icon="users">Tap your name so this phone knows who you are.</Banner>
            </div>
          ) : null}

          <div className="rows">
            {data.members.map((m) => (
              <div key={m.id} className="row" style={{ cursor: "pointer" }} onClick={() => claim(m.id)}>
                <Avatar member={m} />
                <div className="rmain">
                  <div className="rtitle">{m.name}</div>
                </div>
                {m.id === data.me
                  ? <Icon name="check" size={16} style={{ color: "var(--brand)", flex: "none" }} />
                  : null}
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="iconbtn" aria-label={`Rename ${m.name}`}
                    onClick={(e) => { e.stopPropagation(); void rename(m.id, m.name); }}>
                    <Icon name="edit" size={14} />
                  </button>
                  <button className="iconbtn" aria-label={`Remove ${m.name}`}
                    onClick={(e) => { e.stopPropagation(); void remove(m.id, m.name); }}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
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
