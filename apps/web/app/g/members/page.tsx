"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { entriesInvolving } from "@bida/core";
import { BadLink, Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { ChoiceDialog, ConfirmDialog, Dialog } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { InviteButton } from "@/components/invite";
import { AddName } from "@/components/name-adder";
import { copy } from "@/lib/copy";
import { addMember, claimIdentity, removeMember } from "@/lib/db/commands";
import { money, plural } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";

/**
 * People: who is in the group, and which of them this phone is.
 *
 * **Who this phone is is a button of its own below the list, never a tap on
 * somebody's name.** A list whose rows rewrite your identity cannot say so
 * before it happens, and the same rows carry a trash button — one miss and you
 * have signed the group's log as someone else. So it is asked, with the same
 * weight as "Edit" on an entry: the button opens the list as a `ChoiceDialog`
 * (ADR-0008), and picking writes the claim op (ADR-0003).
 *
 * Adding is the last row of the list rather than a dialog — a group is filled
 * in one burst of typing (components/name-adder.tsx). Removing keeps its
 * dialog: one decision, with a consequence to state (ADR-0008).
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
  | { kind: "who" }
  | { kind: "remove"; id: string; name: string }
  | { kind: "blocked"; name: string; body: string; entries: BlockingEntry[] };

function MembersScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  const [ask, setAsk] = useState<Ask | null>(null);

  if (!groupId) return <BadLink />;
  if (data.loading || unclaimed) return <Blank back={route.group(groupId)} />;
  if (!data.group) return <BadLink />;
  const group = data.group;
  const names = data.members.map((m) => m.name);
  // Past the gate this phone has said who it is, so every write below signs
  // with a real name. The guards are what convince the compiler of it.
  const me = data.me;

  async function claim(memberId: string) {
    if (!groupId || memberId === me) return;
    await claimIdentity(groupId, memberId);
  }

  async function remove(memberId: string) {
    if (!groupId || !me) return;
    await removeMember(groupId, me, memberId);
    setAsk(null);
  }

  // A tombstoned member's past entries stay exactly as they were
  // (removeMember's whole point), but "past" means past: someone still named on
  // a live one — a payer, a name in the split, a side of a transfer — is an
  // open balance, not a stray one. Removing them leaves the entry untouched and
  // un-editable by anyone who can no longer pick them.
  //
  // **Both kinds, via core.** Ask about expenses alone and a transfer's
  // counterparty can be removed, leaving the payer +50 on screen with nothing
  // balancing them and a settle-up row with a dead id behind it.
  function askRemove(memberId: string, name: string) {
    // A group with nobody in it is a screen with nothing to do on it: the
    // entry form can't seed a payer and gives up, silently. Your own row has
    // no trash button, so the last one standing can only be somebody else's —
    // which happens when everyone but you has already gone.
    if (data.members.length <= 1) {
      setAsk({ kind: "blocked", name, body: copy.members.lastBody, entries: [] });
      return;
    }
    // The verdict is the registry's — one declaration for the refusal and the
    // repair that covers it when two phones write past it (core/invariants.ts).
    // `entriesInvolving` is only asked what to *name*, never whether to refuse.
    const refused = data.guard({
      entity: "member", entityId: memberId, kind: "delete", patch: {},
    });
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
    setAsk(refused
      ? {
        kind: "blocked", name, entries: blocking,
        body: copy.members.blockedBody(plural(blocking.length, copy.noun.entry)),
      }
      : { kind: "remove", id: memberId, name });
  }

  async function add(name: string) {
    if (!groupId || !me) return;
    await addMember(groupId, me, name);
  }

  return (
    <Screen>
      <Body>
        <TopBar title={copy.members.title} back={route.group(groupId)}
          right={<InviteButton groupId={groupId} />} />

        <Scroll>
          <div className="rows">
            {data.members.map((m) => (
              <div key={m.id} className="row">
                <div className="rmain">
                  <div className="rtitle">{m.name}</div>
                </div>
                {/* Your row's check and everybody else's trash are the same
                    slot, so the column reads as one column — including the add
                    row's own control at the foot of the list. */}
                {m.id === me ? (
                  <span className="rmark">
                    <Icon name="check" size={16} style={{ color: "var(--brand)" }} />
                  </span>
                ) : (
                  <button className="iconbtn" aria-label={copy.members.removeLabel(m.name)}
                    onClick={() => askRemove(m.id, m.name)}>
                    <Icon name="trash" size={14} />
                  </button>
                )}
              </div>
            ))}

            <AddName placeholder={copy.members.addPlaceholder} taken={names} onAdd={add} />
          </div>

          {/* Its own button below the list, not a row in it — the same weight
              as "Edit" on an entry (app/g/entry/page.tsx), because rewriting
              whose name every future entry is signed with is a bigger act
              than the taps above it. Which name is yours is already on the
              list, as the check mark. */}
          <div className="pad" style={{ paddingTop: 4 }}>
            <button className="btn btn-s" onClick={() => setAsk({ kind: "who" })}>
              {copy.members.whoChange}
            </button>
          </div>
        </Scroll>
      </Body>

      {ask?.kind === "who" && me ? (
        <ChoiceDialog title={copy.members.whoTitle} value={me}
          options={data.members.map((m) => ({ value: m.id, label: m.name }))}
          onPick={claim} onClose={() => setAsk(null)} />
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
              <Link key={e.id} href={route.entry(groupId, e.id, "members")} className="drow-pick">
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
    </Screen>
  );
}
