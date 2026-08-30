"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  payerList, resolvePayers, shareOf, splitParticipants, type Expense, type Settlement,
} from "@hajsik/core";
import { Avatar, Card, Eyebrow, signClass } from "../../components/bits";
import {
  Banner, Blank, Body, BottomNav, Empty, Fab, QueryBoundary, Screen, Scroll, SkeletonRows, TopBar,
} from "../../components/chrome";
import { Icon } from "../../components/icons";
import { dayLabel, money, plural } from "../../lib/format";
import { route } from "../../lib/group-link";
import { useGroupData, useInviteLink, useOnline, useSyncHealth } from "../../lib/hooks";
import type { GroupData } from "../../lib/hooks";

type Tab = "expenses" | "balances";

export default function GroupPage() {
  return <QueryBoundary><GroupScreen /></QueryBoundary>;
}

function GroupScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const tab = (params.get("tab") ?? "expenses") as Tab;
  const data = useGroupData(groupId);
  const online = useOnline();
  const sync = useSyncHealth(groupId);
  // The invite link is a property of the group rather than of the phone, which
  // is why it stayed on the group's own top bar when the options screen went
  // (ADR-0014) and the settings screen after it (ADR-0026).
  const invite = useInviteLink(groupId);

  if (!groupId) return <Blank title="No group" back={route.groups()} />;
  // Loading used to be a top bar over nothing — indistinguishable from a tap
  // that didn't land. Draw the whole frame instead: the group's name is the
  // only thing here that has to wait for Dexie.
  if (data.loading) {
    return (
      <Screen>
        <Body>
          <TopBar title=" " back={route.groups()} />
          <Scroll><SkeletonRows count={6} /></Scroll>
        </Body>
        {tab === "expenses" ? <Fab href={route.addExpense(groupId)} /> : null}
        <BottomNav items={[
          { label: "Expenses", icon: "list", href: route.group(groupId), on: tab === "expenses" },
          { label: "Balances", icon: "scale", href: route.group(groupId, "balances"),
            on: tab === "balances" },
        ]} />
      </Screen>
    );
  }
  if (!data.group) {
    return (
      <Screen><Body>
        <TopBar title="Not found" back={route.groups()} />
        <Empty title="That group isn't on this phone">
          Open the invite link again, or pick another group.
        </Empty>
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
        {!online && data.pendingOps > 0 ? (
          <Banner icon="off">
            Offline — {plural(data.pendingOps, "change")} waiting. They'll go up on their own.
          </Banner>
        ) : sync.rejected ? (
          <Banner icon="sync">
            This phone's link no longer opens this group, so nothing is syncing.
            Ask someone for a fresh invite link.
          </Banner>
        ) : sync.failing ? (
          <Banner icon="sync">
            Can't reach the server — {data.pendingOps > 0
              ? `${plural(data.pendingOps, "change")} still only on this phone.`
              : "you may not have everyone's latest."} Still trying.
          </Banner>
        ) : null}

        <TopBar
          title={group.name}
          back={route.groups()}
          right={<>
            <Link className="iconbtn" href={route.history(group.id)} aria-label="History">
              <Icon name="clock" size={18} />
            </Link>
            <Link className="iconbtn" href={route.members(group.id)} aria-label="People">
              <Icon name="users" size={18} />
            </Link>
            {invite.copy ? (
              <button className="iconbtn" aria-label="Copy invite link" onClick={invite.copy}>
                <Icon name={invite.copied ? "check" : "link"} size={18}
                  style={invite.copied ? { color: "var(--brand)" } : undefined} />
              </button>
            ) : null}
          </>}
        />

        {tab === "expenses" ? <ExpensesTab data={data} /> : <BalancesTab data={data} />}
      </Body>

      {tab === "expenses" ? <Fab href={route.addExpense(group.id)} /> : null}

      {/* One navigation, at the bottom, and only what a group actually is: what
          was spent, and who is up or down because of it. "Settle" was a third
          destination and is now the bottom half of Balances; "Group" was a
          fourth and is now Settings, next to the group list, because every
          switch on it belonged to the phone rather than to this group. */}
      <BottomNav items={[
        { label: "Expenses", icon: "list", href: route.group(group.id), on: tab === "expenses" },
        { label: "Balances", icon: "scale", href: route.group(group.id, "balances"),
          on: tab === "balances" },
      ]} />
    </Screen>
  );
}

/** Which way a row moves your balance — drives the coloured edge on the row. */
function lean(minor: number): string {
  return minor > 0 ? "up" : minor < 0 ? "down" : "flat";
}

/** "Marie paid" · "Marie + 1 other paid". */
function payersLabel(name: string | undefined, others: number): string {
  const who = name ?? "Someone";
  if (others <= 0) return `${who} paid`;
  return `${who} + ${others} other${others === 1 ? "" : "s"} paid`;
}

// ------------------------------------------------------------- expenses

type Entry =
  | { kind: "expense"; at: number; createdAt: number; expense: Expense }
  | { kind: "settlement"; at: number; createdAt: number; settlement: Settlement };

function ExpensesTab({ data }: { data: GroupData }) {
  const { group, expenses, settlements, memberById, me, balances } = data;
  if (!group) return null;
  // Read out here, not `group!.baseCurrency` at each use: the row renderers
  // below are hoisted function declarations, so they are created before this
  // guard runs and TypeScript won't carry its narrowing into them.
  const { id: gid, baseCurrency: base } = group;

  // The ledger's whole job is answering "does this one help me or hurt me?",
  // so every row carries its own effect on your balance — what you put in for
  // it, minus what you owe for it — signed and coloured. They add up to `net`.
  const net = me ? balances.byMember[me] ?? 0 : 0;

  const entries: Entry[] = [
    ...expenses.map((e): Entry => ({ kind: "expense", at: e.occurredAt, createdAt: e.createdAt ?? e.occurredAt, expense: e })),
    ...settlements.map((s): Entry => ({ kind: "settlement", at: s.occurredAt, createdAt: s.createdAt ?? s.occurredAt, settlement: s })),
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
                {net < 0 ? "You owe" : net > 0 ? "You're owed" : "You're square"}
              </span>
            </div>
            <div className={`bignum ${signClass(net)}`} style={{ fontSize: 24, marginTop: 1 }}>
              {money(net, group.baseCurrency, net !== 0)}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-2)", marginTop: 2 }}>
              you paid {money(balances.paidMinor[me] ?? 0, group.baseCurrency)}
              {" · "}your share {money(balances.owedMinor[me] ?? 0, group.baseCurrency)}
            </div>
          </Card>
        </div>
      ) : null}

      <Scroll>
        {entries.length === 0 ? (
          <Empty title="Nothing spent yet">Tap + to add the first thing.</Empty>
        ) : null}

        <div className="rows">
          {entries.map((entry) => {
            const day = dayLabel(entry.at);
            const label = day === lastDay ? null : (lastDay = day);
            return (
              <div key={entry.kind === "expense" ? entry.expense.id : entry.settlement.id}>
                {label ? <div className="daylabel">{label}</div> : null}
                {entry.kind === "expense"
                  ? <ExpenseRow expense={entry.expense} />
                  : <SettlementRow settlement={entry.settlement} />}
              </div>
            );
          })}
        </div>
        <div style={{ height: 88 }} />
      </Scroll>
    </>
  );

  function ExpenseRow({ expense }: { expense: Expense }) {
    const payer = memberById.get(expense.paidBy);
    const payers = payerList(expense);
    const involved = me ? splitParticipants(expense.split).includes(me) : false;
    const putIn = me ? resolvePayers(expense)[me] ?? 0 : 0;
    const myShare = me && involved
      ? shareOf(expense.baseAmountMinor, expense.split, me, { tiebreakSeed: expense.id })
      : 0;
    const myNet = putIn - myShare;
    const mine = putIn !== 0 || involved;
    const participants = splitParticipants(expense.split).length;
    const foreign = expense.currency !== base;

    return (
      <Link href={route.expense(gid, expense.id)}
        className={`row ${mine ? `mine ${lean(myNet)}` : "notmine"}`}>
        <Avatar member={payer} />
        <div className="rmain">
          <div className="rtitle">{expense.description || "Untitled"}</div>
          <div className="rmeta">
            {payersLabel(payer?.name, payers.length - 1)}
            {" · "}
            {expense.split.mode === "equal" ? `split ${participants} ways`
              : expense.split.mode === "shares" ? `${participants} people, as parts`
              : expense.split.mode === "exact" ? `${participants} people, as amounts`
              : `${participants} people, by percent`}
          </div>
        </div>
        <div className="ramt">
          <div className="big">{money(expense.baseAmountMinor, base)}</div>
          {foreign ? (
            <div className="sm">{money(expense.amountMinor, expense.currency)}</div>
          ) : null}
          <div className={`sm share ${signClass(myNet)}`}>
            {mine ? money(myNet, base, myNet !== 0) : "not yours"}
          </div>
        </div>
      </Link>
    );
  }

  function SettlementRow({ settlement }: { settlement: Settlement }) {
    const from = memberById.get(settlement.fromMember);
    const to = memberById.get(settlement.toMember);
    // Paying somebody back moves your balance up by exactly what you handed
    // over; being paid back moves it down. Same arithmetic as an expense.
    const myNet = me === settlement.fromMember ? settlement.baseAmountMinor
      : me === settlement.toMember ? -settlement.baseAmountMinor : 0;

    return (
      <div className={`row ${myNet !== 0 ? `mine ${lean(myNet)}` : "notmine"}`}>
        <span className="avatar" style={{
          background: "var(--card-3)", color: "var(--muted)", borderStyle: "dashed",
        }}><Icon name="arrow" size={15} /></span>
        <div className="rmain">
          <div className="rtitle">
            {from?.name ?? "?"} paid {to?.name ?? "?"}
          </div>
          <div className="rmeta">Reimbursement{settlement.note ? ` · ${settlement.note}` : ""}</div>
        </div>
        <div className="ramt">
          <div className="big" style={{ color: "var(--muted)" }}>
            {money(settlement.baseAmountMinor, base)}
          </div>
          <div className={`sm share ${signClass(myNet)}`}>
            {myNet !== 0 ? money(myNet, base, true) : "not yours"}
          </div>
        </div>
      </div>
    );
  }
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
  const { group, members, balances, memberById, me, transfers } = data;
  if (!group) return null;
  const widest = Math.max(1, ...members.map((m) => Math.abs(balances.byMember[m.id] ?? 0)));

  return (
    <Scroll>
      <div style={{ padding: "14px 0 4px" }}>
        {members.map((m) => {
          const net = balances.byMember[m.id] ?? 0;
          const width = `${(Math.abs(net) / widest) * 50}%`;
          return (
            <div key={m.id} className={`balrow${m.id === me ? " mine" : ""}`}>
              <Avatar member={m} />
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
                  {m.name}
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
              {plural(balances.problems.length, "expense")} couldn't be split
            </div>
            <p style={{ fontSize: 11.5, color: "var(--ink-2)", margin: "5px 0 0" }}>
              {balances.problems[0]!.reason}. They're left out of the balances above.
            </p>
          </Card>
        </div>
      ) : null}

      <div className="pad" style={{ paddingTop: 10 }}>
        <Eyebrow style={{ marginBottom: 9 }}>Settle up</Eyebrow>

        {transfers.length === 0 ? (
          <Empty title="Everyone's square" />
        ) : null}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {transfers.map((t) => {
            const from = memberById.get(t.from);
            const to = memberById.get(t.to);
            const involvesMe = t.from === me || t.to === me;
            return (
              <Link key={`${t.from}-${t.to}`}
                href={route.settleWith(group.id, t.from, t.to, t.amountMinor)}
                className={`card${involvesMe ? " mine" : ""}`}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "11px 12px", position: "relative" }}>
                <Avatar member={from} size={26} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{from?.name}</span>
                <Icon name="arrow" size={16} style={{ color: "var(--muted)" }} />
                <Avatar member={to} size={26} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{to?.name}</span>
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
            <span className="k">Spent together</span>
            <span className="v">{money(balances.totalSpendMinor, group.baseCurrency)}</span>
          </div>
        </Card>
      </div>
      <div style={{ height: 24 }} />
    </Scroll>
  );
}
