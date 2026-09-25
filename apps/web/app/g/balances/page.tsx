"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { Transfer } from "@bida/core";
import { Card, Eyebrow, signClass } from "@/components/bits";
import {
  BadLink, Body, Empty, QueryBoundary, Screen, Scroll, SupportFab, TopBar,
} from "@/components/chrome";
import { ConfirmDialog } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { SyncBanner } from "@/components/sync-banner";
import { copy } from "@/lib/copy";
import { recordSettlement } from "@/lib/db/commands";
import { money, plural } from "@/lib/format";
import { route } from "@/lib/group-link";
import { useClaimGate, useGroupData } from "@/lib/hooks";
import type { GroupData } from "@/lib/hooks";

/**
 * Who is up, who is down, and settling. Pressed into from the ledger's balance
 * card, so back is the ledger. The corner is the tip jar's (app/g/tip), not the
 * ledger's two ways to start an expense.
 */
export default function BalancesPage() {
  return <QueryBoundary><BalancesScreen /></QueryBoundary>;
}

function BalancesScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);

  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  // The frame while loading, as on the ledger: a bare top bar looks like a tap
  // that didn't land.
  if (unclaimed || !data.group) {
    return (
      <Screen>
        <Body><TopBar title={copy.group.balances} back={route.group(groupId)} /></Body>
        <SupportFab href={route.tip(groupId)} />
      </Screen>
    );
  }

  const { group } = data;
  return (
    <Screen>
      <Body>
        <SyncBanner groupId={group.id} pendingOps={data.pendingOps} />
        <TopBar title={copy.group.balances} sub={group.name} back={route.group(group.id)} />
        <Balances data={data} />
      </Body>
      <SupportFab href={route.tip(group.id)} />
    </Screen>
  );
}

/**
 * The bars, then the shortest set of payments that ends them — one scroll,
 * since the payments are what you do about the bars.
 */
function Balances({ data }: { data: GroupData }) {
  const { group, members, balances, nameOf, me, transfers } = data;
  // Which suggested payment is being confirmed, if any — the card is the only
  // thing standing between a tap here and a write.
  const [settling, setSettling] = useState<Transfer | undefined>(undefined);
  if (!group) return null;
  // **Everyone carrying a balance, not only current members.** A removed
  // member with a position is who you need to see, and dropping them makes the
  // bars stop summing to zero on screen.
  const live = new Set(members.map((m) => m.id));
  const rows = [
    ...members.map((m) => ({ id: m.id, name: m.name, gone: false })),
    ...Object.keys(balances.byMember)
      .filter((id) => !live.has(id) && (balances.byMember[id] ?? 0) !== 0)
      .map((id) => ({ id, name: nameOf(id), gone: true }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];
  // Yours first — the payments you have to make or collect are what you came
  // for. Stable, so the rest keep settle-up's own order.
  const mineFirst = [...transfers].sort((a, b) =>
    Number(b.from === me || b.to === me) - Number(a.from === me || a.to === me));
  const widest = Math.max(1, ...rows.map((r) => Math.abs(balances.byMember[r.id] ?? 0)));

  return (
    <Scroll>
      <div className="balrows">
        {rows.map((m) => {
          const net = balances.byMember[m.id] ?? 0;
          const width = `${(Math.abs(net) / widest) * 50}%`;
          return (
            <div key={m.id} className={`balrow${m.id === me ? " mine" : ""}`}>
              <div>
                <div className="balname" style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
                  {m.name}
                  {m.gone ? <span className="balgone">{copy.group.hasLeft}</span> : null}
                </div>
                <div className="bar">
                  {net === 0 ? null : net > 0
                    ? <i className="c" style={{ width }} />
                    : <i className="d" style={{ width }} />}
                  <span className="axis" />
                </div>
              </div>
              <div className={`bignum ${signClass(net)}`} style={{ fontSize: 14 }}>
                {money(net, group.baseCurrency, net !== 0)}
              </div>
            </div>
          );
        })}
      </div>

      {balances.problems.length > 0 ? (
        <div className="pad">
          <Card style={{ borderLeft: "2px solid var(--debit)" }}>
            <div style={{ fontSize: 12.5, color: "var(--debit)", fontWeight: 600 }}>
              {copy.group.unsplittable(plural(balances.problems.length, copy.noun.expense))}
            </div>
            <p style={{ fontSize: 11.5, color: "var(--ink-2)", margin: "5px 0 0" }}>
              {copy.group.unsplittableWhy(balances.problems[0]!.reason)}
            </p>
          </Card>
        </div>
      ) : null}

      <div className="pad" style={{ paddingTop: 10 }}>
        <Eyebrow style={{ marginBottom: 9 }}>{copy.group.suggestedReimbursements}</Eyebrow>

        {transfers.length === 0 ? (
          <Empty title={copy.group.allSquare} />
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {mineFirst.map((t) => {
            const involvesMe = t.from === me || t.to === me;
            return (
              <button key={`${t.from}-${t.to}`} type="button"
                onClick={() => setSettling(t)}
                className={`card${involvesMe ? " mine" : ""}`}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 12px",
                  position: "relative", width: "100%", textAlign: "left" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{nameOf(t.from)}</span>
                <Icon name="arrow" size={16} style={{ color: "var(--muted)" }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{nameOf(t.to)}</span>
                <span className="bignum spacer" style={{ fontSize: 13.5 }}>
                  {money(t.amountMinor, group.baseCurrency)}
                </span>
              </button>
            );
          })}
        </div>
        {me ? <NotWho net={balances.byMember[me] ?? 0} /> : null}
      </div>
      <div className="fabclear" />

      {settling && me ? (
        <SettleDialog t={settling} groupId={group.id} actor={me} base={group.baseCurrency}
          nameOf={nameOf} onClose={() => setSettling(undefined)} />
      ) : null}
    </Scroll>
  );
}

/**
 * Why the list may send you to someone who never paid for you: the one thing
 * about settle-up a first-timer reads as a bug. Folded, in the install page's
 * idiom, so it costs one quiet line to those who already know; absent when you
 * are square, since then no row is yours to object to.
 */
function NotWho({ net }: { net: number }) {
  const [open, setOpen] = useState(false);
  if (net === 0) return null;
  const { ask, answer } = net < 0 ? copy.group.notWho.owe : copy.group.notWho.owed;
  return (
    <div className="installfold notwho">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="chev" size={10} className={`kvchev${open ? " on" : ""}`} />
        {ask}
      </button>
      {open ? <p>{answer}</p> : null}
    </div>
  );
}

/**
 * What a suggested payment opens: the row again, enlarged, and two buttons.
 * Nothing is editable — two names, an arrow and a figure are all Record
 * writes, and the only question is whether it happened. A different payment
 * is an ordinary entry, or an edit afterwards.
 */
function SettleDialog({ t, groupId, actor, base, nameOf, onClose }: {
  t: Transfer;
  groupId: string; actor: string; base: string;
  nameOf: (id: string) => string;
  onClose: () => void;
}) {
  const from = nameOf(t.from);
  const to = nameOf(t.to);
  return (
    <ConfirmDialog title={copy.group.recordTitle} confirm={copy.act.record}
      onConfirm={async () => {
        await recordSettlement(groupId, actor, {
          fromMember: t.from,
          toMember: t.to,
          amountMinor: t.amountMinor,
          currency: base,
          // The suggestion is already in the group's own currency, so there is
          // no rate to ask for and none to apply.
          rateToBase: "1",
          occurredAt: Date.now(),
          note: copy.form.reimbursement,
        });
        onClose();
      }}
      onClose={onClose}>
      <div className="settle">
        <div className="settleflow">
          <span className="settlename">{from}</span>
          <Icon name="arrow" size={18} className="settlearrow" />
          <span className="settlename">{to}</span>
        </div>
        <div className="bignum settleamt">{money(t.amountMinor, base)}</div>
      </div>
    </ConfirmDialog>
  );
}
