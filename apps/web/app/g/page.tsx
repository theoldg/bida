"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  payerList, resolvePayers, shareOf, splitParticipants,
  type Expense, type Member, type Settlement,
} from "@hajsik/core";
import { kindOf, myEffect } from "../../lib/entry-kind";
import { Card, Eyebrow, signClass } from "../../components/bits";
import {
  Banner, Blank, Body, BottomNav, Empty, Fab, QueryBoundary, Screen, Scroll, SkeletonRows, TopBar,
} from "../../components/chrome";
import { ConfirmDialog } from "../../components/dialog";
import { Icon } from "../../components/icons";
import { useLongPressMenu } from "../../components/long-press";
import { copy } from "../../lib/copy";
import { deleteExpense, deleteSettlement } from "../../lib/db/commands";
import { syncGroup } from "../../lib/db/sync";
import { dayLabel, money, plural } from "../../lib/format";
import { route } from "../../lib/group-link";
import { useGroupData, useInviteLink, useOnline, useSyncHealth } from "../../lib/hooks";
import type { GroupData } from "../../lib/hooks";

type Tab = "ledger" | "balances";

export default function GroupPage() {
  return <QueryBoundary><GroupScreen /></QueryBoundary>;
}

function GroupScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const tab = (params.get("tab") ?? "ledger") as Tab;
  const data = useGroupData(groupId);
  const online = useOnline();
  const sync = useSyncHealth(groupId);
  // The invite link is a property of the group rather than of the phone, which
  // is why it stayed on the group's own top bar when the options and settings
  // screens went (ADR-0007).
  const invite = useInviteLink(groupId);

  // Opening a group is the moment you want to know whether it is current, so
  // ask the server then rather than waiting for the loop's next 60s tick. A
  // dead server records its first failure here; the engine's own backoff
  // retries seconds later, which is what turns the banner on. The rejection is
  // the recorded failure — `useSyncHealth` reads it, nothing here needs it.
  useEffect(() => {
    if (groupId) void syncGroup(groupId).catch(() => {});
  }, [groupId]);

  // Joining isn't finished until "who are you" is answered, and this screen is
  // the one place that used to let a phone skip it — a bookmark, or the join
  // flow's back arrow and then the group row. Unclaimed, nothing here works
  // the way it reads: every row is somebody else's, and People offered a trash
  // button on every name including the last.
  const unclaimed = !data.loading && !!data.group && !data.me;
  useEffect(() => {
    if (groupId && unclaimed) router.replace(route.claim(groupId));
  }, [groupId, unclaimed, router]);

  if (!groupId) return <Blank title={copy.group.noGroup} back={route.groups()} />;
  // Loading used to be a top bar over nothing — indistinguishable from a tap
  // that didn't land. Draw the whole frame instead: the group's name is the
  // only thing here that has to wait for Dexie.
  // The skeleton covers the redirect above too: a flash of somebody else's
  // ledger before it lands is worse than a frame that is still loading.
  if (data.loading || unclaimed) {
    return (
      <Screen>
        <Body>
          <TopBar title=" " back={route.groups()} />
          <Scroll><SkeletonRows count={6} /></Scroll>
        </Body>
        {tab === "ledger" ? <Fab href={route.addEntry(groupId)} /> : null}
        <BottomNav items={[
          { label: copy.group.tabs.ledger, icon: "list", href: route.group(groupId), on: tab === "ledger" },
          { label: copy.group.tabs.balances, icon: "scale", href: route.group(groupId, "balances"),
            on: tab === "balances" },
        ]} />
      </Screen>
    );
  }
  if (!data.group) {
    return (
      <Screen><Body>
        <TopBar title={copy.group.notFound.title} back={route.groups()} />
        <Empty title={copy.group.notFound.empty}>{copy.group.notFound.body}</Empty>
      </Body></Screen>
    );
  }

  const { group } = data;

  return (
    <Screen>
      <Body>
        {/* Three ways for a group to be out of step with its friends, in the
            order of how badly you need to know. Being offline is the benign
            one and says so; a server that won't answer is the one that used to
            be invisible; a refused key is the one that never heals by itself.
            No colour on any of them — that is spent on balances (ADR-0023). */}
        {!online ? (
          <Banner icon="off">
            {data.pendingOps > 0
              ? copy.group.offlinePending(plural(data.pendingOps, copy.noun.change))
              : copy.group.offlineIdle}
          </Banner>
        ) : sync.rejected ? (
          <Banner icon="sync">{copy.group.rejected}</Banner>
        ) : sync.failing ? (
          <Banner icon="sync">
            {data.pendingOps > 0
              ? copy.group.unreachablePending(plural(data.pendingOps, copy.noun.change))
              : copy.group.unreachableIdle}
          </Banner>
        ) : null}

        <TopBar
          title={group.name}
          back={route.groups()}
          right={<>
            <Link className="iconbtn" href={route.history(group.id)} aria-label={copy.group.history}>
              <Icon name="clock" size={18} />
            </Link>
            <Link className="iconbtn" href={route.members(group.id)} aria-label={copy.group.people}>
              <Icon name="users" size={18} />
            </Link>
            {invite.copy ? (
              <button className="iconbtn" aria-label={copy.group.copyLink} onClick={invite.copy}>
                <Icon name={invite.copied ? "check" : "link"} size={18}
                  style={invite.copied ? { color: "var(--brand)" } : undefined} />
              </button>
            ) : null}
          </>}
        />

        {tab === "ledger" ? <LedgerTab data={data} /> : <BalancesTab data={data} />}
      </Body>

      {tab === "ledger" ? <Fab href={route.addEntry(group.id)} /> : null}

      {/* One navigation, at the bottom, and only what a group actually is: what
          moved through it, and who is up or down because of it. "Settle" was a
          third destination and is now the bottom half of Balances; "Group" was
          a fourth and is now Settings, next to the group list, because every
          switch on it belonged to the phone rather than to this group. The
          first tab is "Ledger", not "Expenses", because two of the three
          things on it aren't expenses (ADR-0010). */}
      <BottomNav items={[
        { label: copy.group.tabs.ledger, icon: "list", href: route.group(group.id), on: tab === "ledger" },
        { label: copy.group.tabs.balances, icon: "scale", href: route.group(group.id, "balances"),
          on: tab === "balances" },
      ]} />
    </Screen>
  );
}

/** Which way a row moves your balance — drives the coloured edge on the row. */
function lean(minor: number): string {
  return minor > 0 ? "up" : minor < 0 ? "down" : "flat";
}

// ------------------------------------------------------------- expenses

/**
 * One row of the ledger. `row` names the table it came from, not the entry's
 * kind — an income is a `row: "expense"` — because which of the three it is
 * lives on the expense itself (`kindOf`).
 */
type Entry =
  | { row: "expense"; at: number; createdAt: number; expense: Expense }
  | { row: "settlement"; at: number; createdAt: number; settlement: Settlement };

function LedgerTab({ data }: { data: GroupData }) {
  const { group, expenses, settlements, memberById, me, balances } = data;
  if (!group) return null;
  // Read out once past the guard: both row components take them as props.
  const { id: gid, baseCurrency: base } = group;

  // The ledger's whole job is answering "does this one help me or hurt me?",
  // so every row carries its own effect on your balance — what you put in for
  // it, minus what you owe for it — signed and coloured. They add up to `net`.
  const net = me ? balances.byMember[me] ?? 0 : 0;

  const entries: Entry[] = [
    ...expenses.map((e): Entry => ({ row: "expense", at: e.occurredAt, createdAt: e.createdAt ?? e.occurredAt, expense: e })),
    ...settlements.map((s): Entry => ({ row: "settlement", at: s.occurredAt, createdAt: s.createdAt ?? s.occurredAt, settlement: s })),
  ].sort((a, b) => (b.at - a.at) || (b.createdAt - a.createdAt));

  let lastDay = "";

  return (
    <>
      {me ? (
        <div className="mysummary pad">
          {/* The tint is neutral on purpose: the eyebrow and the figure are
              already signed and coloured, and a card-sized wash of green or
              red is the loudest thing on a screen that spends colour only on
              money. */}
          <Card style={{ flex: 1, padding: "10px 12px" }}>
            <div className="eyebrow" style={{ color: net === 0 ? "var(--muted)" : "inherit" }}>
              <span className={signClass(net)}>
                {net < 0 ? copy.group.you.owe : net > 0 ? copy.group.you.owed : copy.group.you.square}
              </span>
            </div>
            <div className={`bignum ${signClass(net)}`} style={{ fontSize: 24, marginTop: 1 }}>
              {money(net, group.baseCurrency, net !== 0)}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
              {copy.group.you.paidAndShare(
                money(balances.paidMinor[me] ?? 0, group.baseCurrency),
                money(balances.owedMinor[me] ?? 0, group.baseCurrency))}
            </div>
            {/* Only where there is income to account for: on a group with
                none, this line would be two zeroes explaining nothing. */}
            {(balances.receivedMinor[me] ?? 0) > 0 || (balances.incomeShareMinor[me] ?? 0) > 0 ? (
              <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                {copy.group.you.tookAndCut(
                  money(balances.receivedMinor[me] ?? 0, group.baseCurrency),
                  money(balances.incomeShareMinor[me] ?? 0, group.baseCurrency))}
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      <Scroll>
        {entries.length === 0 ? (
          <Empty title={copy.group.empty.title}>{copy.group.empty.body}</Empty>
        ) : null}

        <div className="rows">
          {entries.map((entry) => {
            const day = dayLabel(entry.at);
            const label = day === lastDay ? null : (lastDay = day);
            return (
              <div key={entry.row === "expense" ? entry.expense.id : entry.settlement.id}>
                {label ? <div className="daylabel">{label}</div> : null}
                {entry.row === "expense"
                  ? <ExpenseRow expense={entry.expense} gid={gid} base={base} me={me} memberById={memberById} />
                  : <SettlementRow settlement={entry.settlement} gid={gid} base={base} me={me} memberById={memberById} />}
              </div>
            );
          })}
        </div>
        <div style={{ height: 88 }} />
      </Scroll>
    </>
  );
}

/**
 * Hoisted out of `LedgerTab` rather than nested inside it, as `SettlementRow`
 * is: a nested function component is a new identity on every render, which
 * would discard this row's own state — the open delete confirmation — the
 * moment a live query elsewhere in the group redraws the ledger.
 */
function ExpenseRow({ expense, gid, base, me, memberById }: {
  expense: Expense; gid: string; base: string; me: string | undefined; memberById: Map<string, Member>;
}) {
  const kind = kindOf(expense);
  const income = kind === "income";
  const payer = memberById.get(expense.paidBy);
  const payers = payerList(expense);
  const involved = me ? splitParticipants(expense.split).includes(me) : false;
  const putIn = me ? resolvePayers(expense)[me] ?? 0 : 0;
  const share = me && involved
    ? shareOf(expense.baseAmountMinor, expense.split, me, { tiebreakSeed: expense.id })
    : 0;
  const myNet = myEffect(me, { kind, putIn, share });
  const mine = putIn !== 0 || involved;
  const participants = splitParticipants(expense.split).length;
  const foreign = expense.currency !== base;
  const [asking, setAsking] = useState(false);

  const { onContextMenu, menu } = useLongPressMenu([
    { label: copy.act.delete, icon: "trash", danger: true, onSelect: () => setAsking(true) },
  ]);

  async function remove() {
    await deleteExpense(gid, me ?? expense.paidBy, expense.id);
  }

  return (
    <>
      <Link href={route.entry(gid, expense.id)}
        className={`row ${mine ? `mine ${lean(myNet)}` : "notmine"}`} onContextMenu={onContextMenu}>
        <div className="rmain">
          <div className="rtitle">{expense.description || copy.group.untitled}</div>
          <div className="rmeta">
            {copy.group.payers(payer?.name ?? copy.someone,
              payers.length > 1 ? plural(payers.length - 1, copy.noun.other) : null,
              copy.entryKind.verb[kind])}
            {" · "}
            {expense.split.mode === "equal"
              ? (income ? copy.group.sharedWays : copy.group.splitWays)(plural(participants, copy.noun.way))
              : copy.group.splitAs(participants, copy.split.mode[expense.split.mode].toLowerCase())}
          </div>
        </div>
        <div className="ramt">
          {/* An income's figure carries a "+": it is the group's number, not
              yours, and without a sign it reads as one more thing spent. */}
          <div className="big">{money(expense.baseAmountMinor, base, income)}</div>
          {foreign ? (
            <div className="sm">{money(expense.amountMinor, expense.currency)}</div>
          ) : null}
          <div className={`sm share ${signClass(myNet)}`}>
            {mine ? money(myNet, base, myNet !== 0) : copy.group.notYours}
          </div>
        </div>
      </Link>

      {menu}

      {asking ? (
        <ConfirmDialog title={copy.entry.deleteTitle(copy.entryKind.label[kind].toLowerCase())}
          confirm={copy.act.delete} danger={true} onConfirm={remove} onClose={() => setAsking(false)}>
          <p>{copy.entry.deleteBody}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/**
 * A transfer's row. It carries the same long press as an expense's: a transfer
 * is an entry like the other two (ADR-0010), and the one it doesn't belong to
 * is the one you most want to take back.
 */
function SettlementRow({ settlement, gid, base, me, memberById }: {
  settlement: Settlement; gid: string; base: string; me: string | undefined;
  memberById: Map<string, Member>;
}) {
  const from = memberById.get(settlement.fromMember);
  const to = memberById.get(settlement.toMember);
  const myNet = myEffect(me, { kind: "transfer", settlement });
  const [asking, setAsking] = useState(false);

  const { onContextMenu, menu } = useLongPressMenu([
    { label: copy.act.delete, icon: "trash", danger: true, onSelect: () => setAsking(true) },
  ]);

  async function remove() {
    await deleteSettlement(gid, me ?? settlement.fromMember, settlement.id);
  }

  return (
    <>
      <Link href={route.entry(gid, settlement.id)}
        className={`row ${myNet !== 0 ? `mine ${lean(myNet)}` : "notmine"}`} onContextMenu={onContextMenu}>
        <div className="rmain">
          <div className="rtitle">
            {copy.group.paidTo(from?.name ?? copy.unknown, to?.name ?? copy.unknown)}
          </div>
          <div className="rmeta">
            {settlement.note ? copy.group.transferNote(settlement.note) : copy.group.transfer}
          </div>
        </div>
        <div className="ramt">
          <div className="big" style={{ color: "var(--muted)" }}>
            {money(settlement.baseAmountMinor, base)}
          </div>
          <div className={`sm share ${signClass(myNet)}`}>
            {myNet !== 0 ? money(myNet, base, true) : copy.group.notYours}
          </div>
        </div>
      </Link>

      {menu}

      {asking ? (
        <ConfirmDialog title={copy.entry.deleteTitle(copy.entryKind.label.transfer.toLowerCase())}
          confirm={copy.act.delete} danger={true} onConfirm={remove} onClose={() => setAsking(false)}>
          <p>{copy.entry.deleteBody}</p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

// ------------------------------------------------- balances and settling

/**
 * Who is up, who is down, and the shortest set of payments that ends it.
 *
 * These were two tabs. They are one question asked twice — the bars tell you
 * a number is wrong, and the payments are the only thing you can do about it,
 * so they belong on the same scroll.
 */
function BalancesTab({ data }: { data: GroupData }) {
  const { group, members, balances, nameOf, me, transfers } = data;
  if (!group) return null;
  // Everyone carrying a balance, not only everyone still in the group. A
  // removed member with a position is precisely who you need to see, and
  // leaving them off is what made the bars stop summing to zero on screen
  // while `byMember` went on summing to zero underneath.
  const live = new Set(members.map((m) => m.id));
  const rows = [
    ...members.map((m) => ({ id: m.id, name: m.name, gone: false })),
    ...Object.keys(balances.byMember)
      .filter((id) => !live.has(id) && (balances.byMember[id] ?? 0) !== 0)
      .map((id) => ({ id, name: nameOf(id), gone: true }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];
  const widest = Math.max(1, ...rows.map((r) => Math.abs(balances.byMember[r.id] ?? 0)));

  return (
    <Scroll>
      <div style={{ padding: "14px 0 4px" }}>
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
        <Eyebrow style={{ marginBottom: 9 }}>{copy.group.settleUp}</Eyebrow>

        {transfers.length === 0 ? (
          <Empty title={copy.group.allSquare} />
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {transfers.map((t) => {
            const involvesMe = t.from === me || t.to === me;
            return (
              <Link key={`${t.from}-${t.to}`}
                href={route.transferBetween(group.id, t.from, t.to, t.amountMinor)}
                className={`card${involvesMe ? " mine" : ""}`}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 12px", position: "relative" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{nameOf(t.from)}</span>
                <Icon name="arrow" size={16} style={{ color: "var(--muted)" }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{nameOf(t.to)}</span>
                <span className="bignum spacer" style={{ fontSize: 13.5 }}>
                  {money(t.amountMinor, group.baseCurrency)}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="pad" style={{ paddingTop: 12 }}>
        <Card>
          <div className="kv">
            <span className="k">{copy.group.spentTogether}</span>
            <span className="v">{money(balances.totalSpendMinor, group.baseCurrency)}</span>
          </div>
          {/* Income is never netted into what the trip cost — the two are
              different questions and the card asks both, but only once there
              is an answer to the second one. */}
          {balances.totalIncomeMinor > 0 ? (
            <div className="kv">
              <span className="k">{copy.group.takenIn}</span>
              <span className="v">
                {money(balances.totalIncomeMinor, group.baseCurrency, true)}
              </span>
            </div>
          ) : null}
        </Card>
      </div>
      <div style={{ height: 24 }} />
    </Scroll>
  );
}
