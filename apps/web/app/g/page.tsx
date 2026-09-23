"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import {
  payerList, resolvePayers, shareOf, splitParticipants,
  type Expense, type Member, type Settlement, type Transfer,
} from "@bida/core";
import { kindOf, myEffect } from "@/lib/entry-kind";
import { Card, Eyebrow, signClass } from "@/components/bits";
import {
  BadLink, Banner, Blank, Body, BottomNav, Empty, Fab, QueryBoundary, ScanFab, Screen, Scroll, SkeletonRows,
  SupportFab, TopBar,
} from "@/components/chrome";
import { ConfirmDialog } from "@/components/dialog";
import { FitLine } from "@/components/fit-line";
import { GroupMenu } from "@/components/group-menu";
import { DemoCard } from "@/components/demo";
import { LedgerInstall } from "@/components/install";
import { NewEdits } from "@/components/new-edits";
import { Icon } from "@/components/icons";
import { useLongPressMenu } from "@/components/long-press";
import { copy } from "@/lib/copy";
import { deleteExpense, deleteSettlement, recordSettlement } from "@/lib/db/commands";
import { setLastOpenedGroup } from "@/lib/db/device";
import { syncGroup } from "@/lib/db/sync";
import { dayLabel, money, plural } from "@/lib/format";
import { entryOf, ledgerRows } from "@/lib/ledger";
import { route } from "@/lib/group-link";
import { expenseMeta, transferMeta } from "@/lib/row-meta";
import { useClaimGate, useDevice, useGroupData, useOnline, useSyncHealth } from "@/lib/hooks";
import type { GroupData } from "@/lib/hooks";

type Tab = "ledger" | "balances";

export default function GroupPage() {
  return <QueryBoundary><GroupScreen /></QueryBoundary>;
}

function GroupScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const tab = (params.get("tab") ?? "ledger") as Tab;
  const data = useGroupData(groupId);
  const online = useOnline();
  const sync = useSyncHealth(groupId);
  // Ids only, and only ever a handful: what this phone knows was deleted.
  const deleted = useDevice()?.deletedGroups;
  // Opening a group is when you want it current, so sync now rather than on
  // the next 60s tick. A failure is recorded by the engine and read by
  // `useSyncHealth`; the backoff retry is what turns the banner on.
  useEffect(() => {
    if (groupId) void syncGroup(groupId).catch(() => {});
  }, [groupId]);

  // Remembered so `/new` can default a fresh group's currency to the one you
  // spend in most recently, instead of always landing on EUR.
  useEffect(() => {
    if (groupId) void setLastOpenedGroup(groupId);
  }, [groupId]);

  // Joining isn't finished until "who are you" is answered; unclaimed, there
  // is no honest name to sign a write with. See `useClaimGate`.
  const unclaimed = useClaimGate(groupId, data);

  if (!groupId) return <Blank title={copy.group.noGroup} back={route.groups()} />;

  // The two tabs are one screen, and the ledger is the one you arrive on — so
  // back from balances is the ledger, and only the ledger leaves the group.
  const back = tab === "balances" ? route.group(groupId) : route.groups();
  // **Draw the whole frame while loading** — a bare top bar looks like a tap
  // that didn't land. It also covers the redirect above, rather than flashing
  // somebody else's ledger.
  if (data.loading || unclaimed) {
    return (
      <Screen>
        <Body>
          <TopBar title=" " back={back} />
          <Scroll><SkeletonRows count={6} /></Scroll>
        </Body>
        {tab === "ledger"
          ? <><ScanFab href={route.scan(groupId)} /><Fab href={route.addEntry(groupId)} /></>
          : <SupportFab href={route.tip(groupId)} />}
        <BottomNav items={[
          { label: copy.group.tabs.ledger, icon: "list", href: route.group(groupId), on: tab === "ledger" },
          { label: copy.group.tabs.balances, icon: "seesaw", href: route.group(groupId, "balances"),
            on: tab === "balances" },
        ]} />
      </Screen>
    );
  }
  // A group deleted from the server takes this phone's copy with it
  // (lib/db/sync.ts), so the screen says "deleted" rather than "bad link".
  if (!data.group) {
    return deleted?.includes(groupId)
      ? (
        <Screen><Body>
          <TopBar title=" " back={route.groups()} />
          <Scroll><Empty title={copy.join.deleted.title}>{copy.join.deleted.body}</Empty></Scroll>
        </Body></Screen>
      )
      : <BadLink />;
  }

  const { group } = data;

  return (
    <Screen>
      <Body>
        {/* Three ways to be out of step, most urgent last: offline (benign), a
            server that won't answer, a refused key (never heals by itself). No
            colour — that is for balances (ADR-0023). */}
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
          back={back}
          /* One button: the group's own actions are a menu
             (components/group-menu.tsx), which leaves the bar to its name. */
          right={<GroupMenu groupId={group.id} data={data} />}
        />

        {tab === "ledger" ? <LedgerTab data={data} /> : <BalancesTab data={data} />}
      </Body>

      {/* Two ways to start an expense, on the ledger only. The balances tab's
          corner is for the tip jar (app/g/tip). */}
      {tab === "ledger" ? (
        <>
          <ScanFab href={route.scan(group.id)} />
          <Fab href={route.addEntry(group.id)} />
        </>
      ) : <SupportFab href={route.tip(group.id)} />}

      {/* One navigation, only what a group is: what moved through it, and who
          is up or down. "Ledger", not "Expenses", because two of its three
          kinds aren't expenses (ADR-0010). */}
      <BottomNav items={[
        { label: copy.group.tabs.ledger, icon: "list", href: route.group(group.id), on: tab === "ledger" },
        { label: copy.group.tabs.balances, icon: "seesaw", href: route.group(group.id, "balances"),
          on: tab === "balances" },
      ]} />
    </Screen>
  );
}

// ------------------------------------------------------------- expenses

function LedgerTab({ data }: { data: GroupData }) {
  const { group, expenses, settlements, memberById, me, balances } = data;
  if (!group) return null;
  // Read out once past the guard: both row components take them as props.
  const { id: gid, baseCurrency: base } = group;

  // The ledger answers "does this one help me or hurt me?", so every row
  // carries its own effect on your balance — what you put in for it, minus what
  // you owe for it — signed and coloured in the figure. They add up to `net`.
  const net = me ? balances.byMember[me] ?? 0 : 0;

  const entries = ledgerRows(expenses, settlements);

  let lastDay = "";

  return (
    <Scroll>
      {/* Inside the scroll, not fixed above it, so the ledger isn't pushed a
          third of the way down. */}
      {/* Either platform's install offer, folded to one line (docs/ios.md),
          or once installed the notifications offer (docs/notifications.md).
          Here because launches and joins both land on this screen. */}
      {/* Above the install offer, because it outranks it: what group you are
          standing in comes before what to do with this browser. It draws
          nothing for every other group. */}
      <DemoCard groupId={gid} />
      <LedgerInstall groupId={gid} />
      {me ? <MySummary net={net} base={base} /> : null}
      {/* Between where you stand and the rows, since it is why either moved. */}
      <NewEdits groupId={gid} currency={base} />

      {entries.length === 0 ? (
        <Empty title={copy.group.empty.title}>{copy.group.empty.body}</Empty>
      ) : null}

      <div className="rows">
        {entries.map((entry) => {
          const day = dayLabel(entryOf(entry).occurredAt);
          const label = day === lastDay ? null : (lastDay = day);
          return (
            <div key={entryOf(entry).id}>
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
  );
}

/**
 * Where you stand, on one line: the words on the left, the figure on the right.
 * The figure is sized to its own length (`.mysummary` in globals.css), so a
 * six-digit sum shrinks to fit rather than wrapping under the words.
 */
function MySummary({ net, base }: { net: number; base: string }) {
  const label = net < 0 ? copy.group.you.owe : net > 0 ? copy.group.you.owed : copy.group.you.square;
  // Unsigned, unlike every other figure: "You owe" already says the direction,
  // and a "-" reads as arithmetic rather than debt.
  const figure = money(Math.abs(net), base);
  return (
    <div className="mysummary pad">
      {/* Neutral tint on purpose: the words and figure already carry the colour. */}
      <Card className={`mysum ${signClass(net)}`}
        style={{ "--label": label.length, "--chars": figure.length } as CSSProperties}>
        <span className="eyebrow">{label}</span>
        <span className="bignum">{figure}</span>
      </Card>
    </div>
  );
}

/**
 * **Hoisted out of `LedgerTab`, never nested inside it** (as `SettlementRow`
 * is): a nested function component is a new identity on every render, which
 * would discard this row's open delete confirmation the moment a live query
 * elsewhere in the group redraws the ledger.
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

  const { hold, menu } = useLongPressMenu([
    { label: copy.act.delete, icon: "trash", danger: true, onSelect: () => setAsking(true) },
  ]);

  async function remove() {
    if (!me) return;
    await deleteExpense(gid, me, expense.id);
  }

  return (
    <>
      <Link href={route.entry(gid, expense.id)}
        className={`row entryrow ${mine ? "" : "notmine"}`} {...hold}>
        <div className="rmain">
          <div className="rtitle">{expense.description || copy.group.untitled}</div>
          {/* Who paid, how many ways, in what mode — more than a phone's
              width holds when a name is long. The ladder that decides what
              goes first is `lib/row-meta.ts`; this only picks off it. */}
          <FitLine className="rmeta" options={expenseMeta({
            payer: payer?.name ?? copy.someone,
            coPayers: payers.length - 1,
            kind,
            ways: participants,
            mode: expense.split.mode,
          })} />
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
 * A transfer's row, with the same long press as an expense's (ADR-0010).
 */
function SettlementRow({ settlement, gid, base, me, memberById }: {
  settlement: Settlement; gid: string; base: string; me: string | undefined;
  memberById: Map<string, Member>;
}) {
  const from = memberById.get(settlement.fromMember);
  const to = memberById.get(settlement.toMember);
  const myNet = myEffect(me, { kind: "transfer", settlement });
  const [asking, setAsking] = useState(false);

  const { hold, menu } = useLongPressMenu([
    { label: copy.act.delete, icon: "trash", danger: true, onSelect: () => setAsking(true) },
  ]);

  async function remove() {
    if (!me) return;
    await deleteSettlement(gid, me, settlement.id);
  }

  return (
    <>
      <Link href={route.entry(gid, settlement.id)}
        className={`row entryrow ${myNet !== 0 ? "" : "notmine"}`} {...hold}>
        <div className="rmain">
          <div className="rtitle">
            {copy.group.paidTo(from?.name ?? copy.unknown, to?.name ?? copy.unknown)}
          </div>
          <FitLine className="rmeta" options={transferMeta(settlement.note)} />
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
 * Who is up, who is down, and the shortest set of payments that ends it — one
 * scroll, since the payments are what you do about the bars.
 */
function BalancesTab({ data }: { data: GroupData }) {
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
      </div>
      <div style={{ height: 24 }} />

      {settling && me ? (
        <SettleDialog t={settling} groupId={group.id} actor={me} base={group.baseCurrency}
          nameOf={nameOf} onClose={() => setSettling(undefined)} />
      ) : null}
    </Scroll>
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
