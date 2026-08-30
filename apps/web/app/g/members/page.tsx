"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { GhostRow } from "../../../components/bits";
import { Banner, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { ConfirmDialog, PromptDialog } from "../../../components/dialog";
import { Icon } from "../../../components/icons";
import {
  addMember, claimIdentity, leaveGroup, removeMember, renameMember,
} from "../../../lib/db/commands";
import { route } from "../../../lib/group-link";
import { useGroupData, useInviteLink } from "../../../lib/hooks";

/**
 * People: who is in the group, and which of them this phone is.
 *
 * Identity used to be a second copy of this same list on the group options
 * screen. One list, one place to tap: the check mark is who you are, and
 * tapping another name moves it — an op on the shared log, like every other
 * change (ADR-0003).
 *
 * Every change made here — naming, adding, removing, leaving — is confirmed in
 * a dialog this app draws, on this list, rather than on a route of its own
 * (ADR-0008).
 */
export default function MembersPage() {
  return <QueryBoundary><MembersScreen /></QueryBoundary>;
}

type Ask =
  | { kind: "add" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "remove"; id: string; name: string }
  | { kind: "leave" };

function MembersScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const invite = useInviteLink(groupId);
  const [ask, setAsk] = useState<Ask | null>(null);

  if (!groupId || !data.group) return <Blank />;
  const group = data.group;

  async function claim(memberId: string) {
    if (!groupId || memberId === data.me) return;
    await claimIdentity(groupId, memberId);
  }

  async function rename(memberId: string, name: string) {
    if (!groupId) return;
    await renameMember(groupId, data.me ?? memberId, memberId, name);
    setAsk(null);
  }

  async function remove(memberId: string) {
    if (!groupId) return;
    await removeMember(groupId, data.me ?? memberId, memberId);
    setAsk(null);
  }

  async function add(name: string) {
    if (!groupId) return;
    const memberId = await addMember(groupId, data.me, name);
    // A brand-new phone that just created this member is almost certainly them.
    if (!data.me) await claimIdentity(groupId, memberId);
    setAsk(null);
  }

  // Leaving is `removeMember` on yourself, so it tombstones like any other
  // removal: your past expenses stay exactly as they were. The one thing worth
  // naming is what it does when you're the last person here.
  const lastMember = data.members.length === 1 && data.members[0]?.id === data.me;
  const leaveTitle = lastMember ? "Delete group" : "Leave group";

  async function leave() {
    if (!groupId || !data.me) return;
    await leaveGroup(groupId, data.me, lastMember);
    router.replace(route.groups());
  }

  return (
    <Screen>
      <Body>
        <TopBar title="People" back={route.group(groupId)}
          right={invite.copy ? (
            <button className="iconbtn" aria-label="Copy invite link" onClick={invite.copy}>
              <Icon name={invite.copied ? "check" : "link"} size={18}
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
                <div className="rmain">
                  <div className="rtitle">{m.name}</div>
                </div>
                {m.id === data.me
                  ? <Icon name="check" size={16} style={{ color: "var(--brand)", flex: "none" }} />
                  : null}
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="iconbtn" aria-label={`Rename ${m.name}`}
                    onClick={(e) => { e.stopPropagation(); setAsk({ kind: "rename", id: m.id, name: m.name }); }}>
                    <Icon name="edit" size={14} />
                  </button>
                  {m.id !== data.me ? (
                    <button className="iconbtn" aria-label={`Remove ${m.name}`}
                      onClick={(e) => { e.stopPropagation(); setAsk({ kind: "remove", id: m.id, name: m.name }); }}>
                      <Icon name="trash" size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}

            <GhostRow icon="plus" label="Add member" onClick={() => setAsk({ kind: "add" })} />

            {data.me ? (
              <GhostRow icon="trash" label="Leave group" danger={true}
                onClick={() => setAsk({ kind: "leave" })} />
            ) : null}
          </div>
        </Scroll>
      </Body>

      {ask?.kind === "add" ? (
        <PromptDialog title="Add member" placeholder="Name" confirm="Add"
          autoCapitalize="words" maxLength={40}
          onSubmit={(name) => add(name)} onClose={() => setAsk(null)} />
      ) : null}

      {ask?.kind === "rename" ? (
        <PromptDialog title="New name" initial={ask.name} confirm="Rename"
          autoCapitalize="words" maxLength={40}
          valid={(v) => v.trim().length > 0 && v.trim() !== ask.name}
          onSubmit={(name) => rename(ask.id, name)} onClose={() => setAsk(null)} />
      ) : null}

      {ask?.kind === "remove" ? (
        <ConfirmDialog title={`Remove ${ask.name}?`} confirm="Remove" danger={true}
          onConfirm={() => remove(ask.id)} onClose={() => setAsk(null)}>
          <p>Their past expenses stay exactly as they were — removing someone doesn't
            redistribute money already owed or owing.</p>
        </ConfirmDialog>
      ) : null}

      {ask?.kind === "leave" ? (
        <ConfirmDialog title={leaveTitle} confirm={leaveTitle} danger={true}
          onConfirm={leave} onClose={() => setAsk(null)}>
          {lastMember ? (
            <>
              <p>You're the last person in <b>{group.name}</b>. Leaving deletes the group —
                there's nobody left to keep it for.</p>
              <p>Its expenses stay in the log, unreachable rather than erased. Nothing about
                it comes back on its own.</p>
            </>
          ) : (
            <p>You'll be removed from <b>{group.name}</b>. Your past expenses stay exactly as
              they were — leaving doesn't redistribute money you already owed or were owed.</p>
          )}
        </ConfirmDialog>
      ) : null}
    </Screen>
  );
}
