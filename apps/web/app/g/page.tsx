"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { shareOf, splitParticipants, type Expense, type Settlement } from "@hajsik/core";
import { Avatar, Card, Eyebrow, signClass } from "../../components/bits";
import {
  Banner, Body, BottomNav, Empty, Fab, QueryBoundary, Screen, Scroll, Tabs, TopBar,
} from "../../components/chrome";
import { Icon } from "../../components/icons";
import { dayLabel, money, plural } from "../../lib/format";
import { route } from "../../lib/group-link";
import { useGroupData, useOnline, usePersonalMode } from "../../lib/hooks";
import type { GroupData } from "../../lib/hooks";

type Tab = "expenses" | "balances" | "settle";

export default function GroupPage() {
  return <QueryBoundary><GroupScreen /></QueryBoundary>;
}

function GroupScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const tab = (params.get("tab") ?? "expenses") as Tab;
  const data = useGroupData(groupId);
  const personal = usePersonalMode();
  const online = useOnline();

  if (!groupId) return <Screen><Body><TopBar title="No group" back={route.groups()} /></Body></Screen>;
  if (data.loading) return <Screen><Body><TopBar title=" " /></Body></Screen>;
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

  const { group, members } = data;

  return (
    <Screen>
      <Body>
        {!online && data.pendingOps > 0 ? (
          <Banner icon="off">
            Offline — {plural(data.pendingOps, "change")} waiting. They'll go up on their own.
          </Banner>
        ) : null}

        <TopBar
          title={group.name}
          sub={`${plural(members.length, "person", "people")} · base ${group.baseCurrency}`}
          back={route.groups()}
          right={<Link className="iconbtn" href={route.members(group.id)} aria-label="People">
            <Icon name="users" size={16} />
          </Link>}
        />

        <Tabs tabs={[
          { label: "Expenses", href: route.group(group.id), on: tab === "expenses" },
          { label: "Balances", href: route.group(group.id, "balances"), on: tab === "balances" },
          { label: "Settle up", href: route.group(group.id, "settle"), on: tab === "settle" },
        ]} />

        {tab === "expenses" ? <ExpensesTab data={data} personal={personal} />
          : tab === "balances" ? <BalancesTab data={data} />
          : <SettleTab data={data} />}
      </Body>

      {tab === "expenses" ? <Fab href={route.addExpense(group.id)} /> : null}

      <BottomNav items={[
        { label: "Expenses", icon: "list", href: route.group(group.id), on: tab === "expenses" },
        { label: "Balances", icon: "scale", href: route.group(group.id, "balances"),
          on: tab !== "expenses" },
        { label: "History", icon: "clock", href: route.history(group.id) },
      ]} />
    </Screen>
  );
}

// ------------------------------------------------------------- expenses

type Entry =
  | { kind: "expense"; at: number; expense: Expense }
  | { kind: "settlement"; at: number; settlement: Settlement };

function ExpensesTab({ data, personal }: { data: GroupData; personal: boolean }) {
  const { group, expenses, settlements, memberById, me, balances } = data;
  if (!group) return null;

  const entries: Entry[] = [
    ...expenses.map((e): Entry => ({ kind: "expense", at: e.occurredAt, expense: e })),
    ...settlements.map((s): Entry => ({ kind: "settlement", at: s.occurredAt, settlement: s })),
  ].sort((a, b) => b.at - a.at);

  let lastDay = "";

  return (
    <>
      {personal && me ? (
        <div className="pers-summary pad" style={{ paddingBottom: 0, gap: 8 }}>
          <Card style={{ flex: 1, background: "var(--hl)", borderColor: "var(--hl-edge)", padding: "9px 11px" }}>
            <div style={{
              fontSize: 10, fontFamily: "var(--f-mono)", letterSpacing: ".1em", textTransform: "uppercase",
              color: "var(--hl-ink)", fontWeight: 600,
            }}>Your share</div>
            <div className="bignum" style={{ fontSize: 17, color: "var(--hl-ink)" }}>
              {money(balances.owedMinor[me] ?? 0, group.baseCurrency)}
            </div>
          </Card>
          <Card style={{ flex: 1, padding: "9px 11px" }}>
            <div style={{
              fontSize: 10, fontFamily: "var(--f-mono)", letterSpacing: ".1em", textTransform: "uppercase",
              color: "var(--muted)", fontWeight: 600,
            }}>You paid</div>
            <div className="bignum" style={{ fontSize: 17 }}>
              {money(balances.paidMinor[me] ?? 0, group.baseCurrency)}
            </div>
          </Card>
        </div>
      ) : null}

      <Scroll>
        {entries.length === 0 ? (
          <Empty title="Nothing spent yet">
            Tap + and put in the first thing somebody paid for.
          </Empty>
        ) : null}

        <div className="rows">
          {entries.map((entry) => {
            const day = dayLabel(entry.at);
            const label = day === lastDay ? null : (lastDay = day);
            return (
              <div key={entry.kind === "expense" ? entry.expense.id : entry.settlement.id}>
                {label ? <div className="daylabel">{label}</div> : null}
                {entry.kind === "expense"
                  ? <ExpenseRow data={data} expense={entry.expense} personal={personal} />
                  : <SettlementRow data={data} settlement={entry.settlement} />}
              </div>
            );
          })}
        </div>
        <div style={{ height: 88 }} />
      </Scroll>
    </>
  );

  function ExpenseRow({ expense, personal }: { data: GroupData; expense: Expense; personal: boolean }) {
    const payer = memberById.get(expense.paidBy);
    const involved = me ? splitParticipants(expense.split).includes(me) : false;
    const mine = me === expense.paidBy || involved;
    const myShare = me && involved ? shareOf(expense.baseAmountMinor, expense.split, me, { tiebreakSeed: expense.id }) : 0;
    const participants = splitParticipants(expense.split).length;
    const foreign = expense.currency !== group!.baseCurrency;

    return (
      <Link href={route.expense(group!.id, expense.id)}
        className={`row${personal ? (mine ? " mine" : " notmine") : ""}`}>
        <Avatar member={payer} name={payer?.name} />
        <div className="rmain">
          <div className="rtitle">{expense.description || "Untitled"}</div>
          <div className="rmeta">
            {payer ? (payer.id === me ? "You paid" : `${payer.name} paid`) : "Someone paid"}
            {" · "}
            {expense.split.mode === "equal"
              ? `split ${participants} ways`
              : `${participants} people, ${expense.split.mode}`}
          </div>
        </div>
        <div className="ramt">
          <div className="big">{money(expense.baseAmountMinor, group!.baseCurrency)}</div>
          {foreign ? (
            <div className="sm">{money(expense.amountMinor, expense.currency)}</div>
          ) : null}
          <div className="sm share">
            {involved ? `you: ${money(myShare, group!.baseCurrency)}` : "not yours"}
          </div>
        </div>
      </Link>
    );
  }

  function SettlementRow({ settlement }: { data: GroupData; settlement: Settlement }) {
    const from = memberById.get(settlement.fromMember);
    const to = memberById.get(settlement.toMember);
    return (
      <div className="row">
        <span className="avatar" style={{
          background: "var(--card-3)", color: "var(--muted)", borderStyle: "dashed",
        }}><Icon name="swap" size={15} /></span>
        <div className="rmain">
          <div className="rtitle">
            {from?.id === me ? "You" : from?.name ?? "?"} paid {to?.id === me ? "you" : to?.name ?? "?"}
          </div>
          <div className="rmeta">Reimbursement{settlement.note ? ` · ${settlement.note}` : ""}</div>
        </div>
        <div className="ramt">
          <div className="big" style={{ color: "var(--muted)" }}>
            {money(settlement.baseAmountMinor, group!.baseCurrency)}
          </div>
          <div className="sm">settled</div>
        </div>
      </div>
    );
  }
}

// ------------------------------------------------------------- balances

function BalancesTab({ data }: { data: GroupData }) {
  const { group, members, balances, me, transfers } = data;
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
                  {m.id === me ? "You" : m.name}
                </div>
                <div className="bar">
                  {net === 0 ? null : net > 0
                    ? <i className="c" style={{ width }} />
                    : <i className="d" style={{ width, right: "50%" }} />}
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
          <Card style={{ background: "var(--debit-bg)", borderColor: "transparent" }}>
            <div style={{ fontSize: 12.5, color: "var(--debit)", fontWeight: 600 }}>
              {plural(balances.problems.length, "expense")} couldn't be split
            </div>
            <p style={{ fontSize: 11.5, color: "var(--ink-2)", margin: "5px 0 0" }}>
              {balances.problems[0]!.reason}. They're left out of the balances above.
            </p>
          </Card>
        </div>
      ) : null}

      <div className="pad" style={{ paddingTop: 6 }}>
        <Eyebrow style={{ marginBottom: 9 }}>Group total</Eyebrow>
        <Card>
          <div className="kv">
            <span className="k">Spent together</span>
            <span className="v">{money(balances.totalSpendMinor, group.baseCurrency)}</span>
          </div>
          <div className="kv">
            <span className="k">Payments to square up</span>
            <span className="v">{transfers.length}</span>
          </div>
        </Card>
      </div>
      <div style={{ height: 24 }} />
    </Scroll>
  );
}

// --------------------------------------------------------------- settle

function SettleTab({ data }: { data: GroupData }) {
  const { group, memberById, transfers, me } = data;
  if (!group) return null;

  return (
    <Scroll>
      <div className="pad">
        <Eyebrow style={{ marginBottom: 9 }}>
          {transfers.length === 0 ? "Nothing to settle"
            : `Simplest way to settle · ${plural(transfers.length, "payment")}`}
        </Eyebrow>

        {transfers.length === 0 ? (
          <Empty title="Everyone's square">
            Nobody owes anybody anything right now.
          </Empty>
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
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t.from === me ? "You" : from?.name}</span>
                <Icon name="swap" size={15} style={{ color: "var(--muted)" }} />
                <Avatar member={to} size={26} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t.to === me ? "you" : to?.name}</span>
                <span className="bignum spacer" style={{ fontSize: 13.5 }}>
                  {money(t.amountMinor, group.baseCurrency)}
                </span>
              </Link>
            );
          })}
        </div>

        {transfers.length > 0 ? (
          <p style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "center", margin: "10px 0 0", lineHeight: 1.4 }}>
            Tap a payment to record it once the money has actually moved.
          </p>
        ) : null}
      </div>
      <div style={{ height: 24 }} />
    </Scroll>
  );
}
