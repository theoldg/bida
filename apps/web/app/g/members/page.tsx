"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { entriesInvolving } from "@hajsik/core";
import { GhostRow } from "../../../components/bits";
import { Banner, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { ConfirmDialog, Dialog, PromptDialog } from "../../../components/dialog";
import { Icon } from "../../../components/icons";
import { AddName } from "../../../components/name-adder";
import { copy } from "../../../lib/copy";
import {
  addMember, claimIdentity, forgetGroup, removeMember, renameMember,
} from "../../../lib/db/commands";
import { money } from "../../../lib/format";
import { route } from "../../../lib/group-link";
import { useGroupData, useInviteLink } from "../../../lib/hooks";
import { nameTaken } from "../../../lib/names";

/**
 * People: who is in the group, and which of them this phone is.
 *
 * Identity used to be a second copy of this same list on the group options
 * screen. One list, one place to tap: the check mark is who you are, and
 * tapping another name moves it — an op on the shared log, like every other
 * change (ADR-0003).
 *
 * Adding is the last row of the list rather than a dialog — a group is filled
 * in one burst of typing, and a scrim per name made that four acts instead of
 * one (components/name-adder.tsx). Renaming and removing keep their dialogs:
 * each is one decision, and a removal has a consequence to state (ADR-0008).
 */
export default function MembersPage() {
  return <QueryBoundary><MembersScreen /></QueryBoundary>;
}

/** One thing still naming a member, of either kind — the dialog treats them alike. */
interface BlockingEntry {
  id: string;
  label: string;
  baseAmountMinor: number;
}

type Ask =
  | { kind: "rename"; id: string; name: string }
  | { kind: "remove"; id: string; name: string }
  | { kind: "blocked"; name: string; body: string; entries: BlockingEntry[] }
  | { kind: "forget" };

function MembersScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const invite = useInviteLink(groupId);
  const [ask, setAsk] = useState<Ask | null>(null);

  if (!groupId || !data.group) return <Blank back={groupId ? route.group(groupId) : route.groups()} />;
  const group = data.group;
  const names = data.members.map((m) => m.name);

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

  // A tombstoned member's past entries are meant to stay exactly as they were
  // (removeMember's whole point), but "past" means past: someone still named
  // on a live one — a payer, a name in the split, a side of a transfer — isn't
  // a stray balance, they're an open one. Removing them wouldn't touch the
  // entry, just make it un-editable by anyone who can no longer pick them.
  //
  // Both kinds, via core, because asking about expenses alone is what let a
  // transfer's counterparty be removed — leaving the payer +50 on screen with
  // nothing balancing them, and a settle-up row with no name and a dead id
  // behind it.
  function askRemove(memberId: string, name: string) {
    // A group with nobody in it is a screen with nothing to do on it: the
    // entry form can't seed a payer and gives up, silently. Reachable only
    // from a phone that hasn't claimed anyone — that's the state where every
    // row, including the last, still offers a trash button.
    if (data.members.length <= 1) {
      setAsk({ kind: "blocked", name, body: copy.members.lastBody, entries: [] });
      return;
    }
    const involved = entriesInvolving(data, memberId);
    const blocking: BlockingEntry[] = [
      ...involved.expenses.map((e) => ({
        id: e.id,
        label: e.description || copy.group.untitled,
        baseAmountMinor: e.baseAmountMinor,
      })),
      ...involved.settlements.map((s) => ({
        id: s.id,
        label: copy.group.paidTo(data.nameOf(s.fromMember), data.nameOf(s.toMember)),
        baseAmountMinor: s.baseAmountMinor,
      })),
    ];
    setAsk(blocking.length > 0
      ? { kind: "blocked", name, body: copy.members.blockedBody(name), entries: blocking }
      : { kind: "remove", id: memberId, name });
  }

  async function add(name: string) {
    if (!groupId) return;
    const memberId = await addMember(groupId, data.me, name);
    // A brand-new phone that just created this member is almost certainly them.
    if (!data.me) await claimIdentity(groupId, memberId);
  }

  async function forget() {
    if (!groupId) return;
    await forgetGroup(groupId);
    router.replace(route.groups());
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.members.title} back={route.group(groupId)}
          right={invite.copy ? (
            <button className="iconbtn" aria-label={copy.group.copyLink} onClick={invite.copy}>
              <Icon name={invite.copied ? "check" : "link"} size={18}
                style={invite.copied ? { color: "var(--brand)" } : undefined} />
            </button>
          ) : null} />

        <Scroll>
          {!data.me ? (
            <div className="pad" style={{ paddingBottom: 0 }}>
              <Banner icon="users">{copy.members.claimPrompt}</Banner>
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
                  <button className="iconbtn" aria-label={copy.members.rename(m.name)}
                    onClick={(e) => { e.stopPropagation(); setAsk({ kind: "rename", id: m.id, name: m.name }); }}>
                    <Icon name="edit" size={14} />
                  </button>
                  {m.id !== data.me ? (
                    <button className="iconbtn" aria-label={copy.members.removeLabel(m.name)}
                      onClick={(e) => { e.stopPropagation(); askRemove(m.id, m.name); }}>
                      <Icon name="trash" size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}

            <AddName placeholder={copy.members.addPlaceholder} taken={names} onAdd={add} />

            {data.me ? (
              <GhostRow icon="trash" label={copy.members.forget}
                onClick={() => setAsk({ kind: "forget" })} />
            ) : null}
          </div>
        </Scroll>
      </Body>

      {ask?.kind === "rename" ? (
        <PromptDialog title={copy.members.newName} initial={ask.name} confirm={copy.act.rename}
          autoCapitalize="words" maxLength={40}
          /* Renaming is the other door onto two people with one name, so it is
             shut here too — Rename simply doesn't light up for a name already
             on the list. */
          valid={(v) => v.trim().length > 0 && v.trim() !== ask.name
            && !nameTaken(v, names.filter((n) => n !== ask.name))}
          onSubmit={(name) => rename(ask.id, name)} onClose={() => setAsk(null)} />
      ) : null}

      {ask?.kind === "remove" ? (
        <ConfirmDialog title={copy.members.removeTitle(ask.name)} confirm={copy.act.remove} danger={true}
          onConfirm={() => remove(ask.id)} onClose={() => setAsk(null)}>
          <p>{copy.members.removeBody}</p>
        </ConfirmDialog>
      ) : null}

      {ask?.kind === "blocked" ? (
        <Dialog title={copy.members.blockedTitle(ask.name)} onClose={() => setAsk(null)}>
          <div className="dbody"><p>{ask.body}</p></div>
          <div className="dlist">
            {ask.entries.map((e) => (
              <Link key={e.id} href={route.entry(groupId, e.id)} className="drow-pick">
                <span className="rmain">
                  <span className="rtitle">{e.label}</span>
                </span>
                <span className="rmeta">{money(e.baseAmountMinor, group.baseCurrency)}</span>
              </Link>
            ))}
          </div>
          <div className="drow">
            <button className="btn btn-p" onClick={() => setAsk(null)}>{copy.act.close}</button>
          </div>
        </Dialog>
      ) : null}

      {ask?.kind === "forget" ? (
        <ConfirmDialog title={copy.members.forget} confirm={copy.members.forget}
          onConfirm={forget} onClose={() => setAsk(null)}>
          <p>{copy.members.forgetBody}</p>
        </ConfirmDialog>
      ) : null}
    </Screen>
  );
}
