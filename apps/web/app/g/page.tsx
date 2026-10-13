"use client";
// Doc: docs/frontend.md

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  entryEffect, payerList, resolvePayers, splitParticipants,
  type Expense, type Member, type Settlement,
} from "@bida/core";
import { kindOf, type EntryKind } from "@/lib/entry-kind";
import { signClass } from "@/components/bits";
import {
  BadLink, Blank, Body, Empty, Fab, LedgerSkeleton, QueryBoundary, ScanFab, Screen, Scroll,
  SkeletonVeil, TopBar,
} from "@/components/chrome";
import { FitLine } from "@/components/fit-line";
import { GroupMenu } from "@/components/group-menu";
import { HistoryButton } from "@/components/history-button";
import { DemoCard } from "@/components/demo";
import { LedgerInstall, SkeletonBanner } from "@/components/install";
import { RollingFigure } from "@/components/rolling-figure";
import { Icon } from "@/components/icons";
import { LedgerRows } from "@/components/ledger-rows";
import { LedgerSearch, useLedgerQuery } from "@/components/ledger-search";
import { useLongPressMenu } from "@/components/long-press";
import { SyncBanner } from "@/components/sync-banner";
import { copy } from "@/lib/copy";
import { useDeleteEntry } from "@/components/delete-entry";
import { setLastOpenedGroup } from "@/lib/db/device";
import { syncGroup } from "@/lib/db/sync";
import { dayLabel, money, plural } from "@/lib/format";
import { ledgerItems, searchContextOf, searchLedger, type LedgerRow } from "@/lib/ledger";
import { route } from "@/lib/group-link";
import { useLedgerPosition, yieldPosition } from "@/lib/ledger-position";
import { awaitRoll, clearDeleted, letRoll, peekDeleted, peekSaved, type LedgerItem } from "@/lib/ledger-motion";
import { keepShown, ROLL_BEAT, shownBefore } from "@/lib/roll";
import { transferMeta } from "@/lib/row-meta";
import { useClaimGate, useDevice, useGroupData, warmGroup, warmGroupsList } from "@/lib/hooks";
import type { GroupData } from "@/lib/hooks";

/**
 * The group's ledger: where a group opens, and the only screen that leaves it.
 */
export default function GroupPage() {
  return <QueryBoundary><GroupScreen /></QueryBoundary>;
}

const SKELETON_SEEN = 100;

function GroupScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
  const deleted = useDevice()?.deletedGroups;
  // Opening a group is when you want it current, not the next 60s tick.
  useEffect(() => {
    if (groupId) void syncGroup(groupId).catch(() => {});
  }, [groupId]);

  // Every other screen of the group reads what this one does, but history;
  // and the list is one Back away.
  useEffect(() => {
    if (groupId) warmGroup(groupId, { history: true });
    warmGroupsList();
  }, [groupId]);

  // So `/new` can default a fresh group's currency to the one you spend in.
  useEffect(() => {
    if (groupId) void setLastOpenedGroup(groupId);
  }, [groupId]);

  const unclaimed = useClaimGate(groupId, data);

  // Only a skeleton that was seen dissolves: under SKELETON_SEEN a fade would
  // stretch a flash into a wait. A launch's mark covers this first render too
  // (lib/first-frame.ts).
  const skeletonSince = useRef<number>(undefined);
  const fade = useRef<boolean>(undefined);
  const [veiled, setVeiled] = useState(true);

  if (!groupId) return <Blank title={copy.group.noGroup} back={route.groups()} />;

  // Also covers the redirect, rather than flashing somebody else's ledger.
  if (data.loading || unclaimed) {
    skeletonSince.current ??= document.documentElement.dataset.frame === "ledger" ? 0 : performance.now();
    return <LedgerSkeleton groupId={groupId} head={<SkeletonBanner groupId={groupId} />} />;
  }
  // A group deleted from the server takes this phone's copy with it.
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
  fade.current ??= skeletonSince.current !== undefined && performance.now() - skeletonSince.current >= SKELETON_SEEN;

  return (
    <Screen>
      <Body>
        <SyncBanner groupId={group.id} pendingOps={data.pendingOps} />
        <TopBar
          title={group.name}
          back={route.groups()}
          right={<><HistoryButton groupId={group.id} /><GroupMenu groupId={group.id} data={data} /></>}
        />
        <Ledger data={data} />
      </Body>
      {fade.current && veiled ? <SkeletonVeil head={<SkeletonBanner groupId={group.id} />} onGone={() => setVeiled(false)} /> : null}

      <ScanFab href={route.scan(group.id)} />
      <Fab href={route.addEntry(group.id)} />
    </Screen>
  );
}

// ------------------------------------------------------------- expenses

/**
 * By the arrays read, not per visit: the same answer is handed to every visit
 * (lib/db/live.ts), and sorting and labelling 10,000 entries again on each
 * open cost a tenth of a second. Today's date is in the key, as the labels say
 * "Yesterday".
 */
const itemsCache = new WeakMap<Expense[], { settlements: Settlement[]; today: string; items: LedgerItem<LedgerRow>[] }>();

function itemsFor(expenses: Expense[], settlements: Settlement[]): LedgerItem<LedgerRow>[] {
  const today = new Date().toDateString();
  const known = itemsCache.get(expenses);
  if (known && known.settlements === settlements && known.today === today) return known.items;
  const items = ledgerItems(expenses, settlements, dayLabel);
  itemsCache.set(expenses, { settlements, today, items });
  return items;
}

function Ledger({ data }: { data: GroupData }) {
  const { group, expenses, settlements, memberById, me, balances, withTombstones } = data;
  // An entry deleted from its own screen is drawn where it was, so the position
  // comes back to it, and goes a beat later, on screen, with the roll.
  const groupId = group?.id ?? "";
  const [ghost, setGhost] = useState(() => peekDeleted(groupId));
  useEffect(() => {
    if (!ghost) return;
    clearDeleted();
    const t = setTimeout(() => { yieldPosition(); letRoll(groupId); setGhost(null); }, ROLL_BEAT);
    return () => clearTimeout(t);
  }, [ghost, groupId]);
  const items = useMemo(() => {
    const keep = <T extends { id: string }>(live: T[], all: Record<string, T>) =>
      !ghost || !all[ghost] || live.some((e) => e.id === ghost) ? live : [...live, all[ghost]];
    return itemsFor(keep(expenses, withTombstones.expenses), keep(settlements, withTombstones.settlements));
  }, [expenses, settlements, withTombstones, ghost]);
  const scroll = useRef<HTMLDivElement>(null);
  useLedgerPosition(scroll, groupId);
  const [query, setQuery] = useLedgerQuery(groupId);
  const searchContext = useMemo(() => searchContextOf(memberById, group?.baseCurrency ?? "", {
    kindWord: (kind) => copy.entryKind.label[kind],
    tierLabel: (tier) => copy.group.search.by[tier],
  }), [memberById, group?.baseCurrency]);
  // The field answers each keystroke at once and the list follows when it can:
  // a keystroke typed while 10,000 rows are searched supersedes that search.
  const shown = useDeferredValue(query);
  const found = useMemo(() => searchLedger(items, shown, searchContext), [items, shown, searchContext]);
  if (!group) return null;
  // A space alone included: the bar stands in the column on the same test.
  const searching = shown !== "";
  const { id: gid, baseCurrency: base } = group;

  // Every row carries its own effect on your balance, signed and coloured; they
  // add up to `net`.
  const net = me ? balances.byMember[me] ?? 0 : 0;

  return (
    <>
    <LedgerSearch groupId={gid} query={query} onQuery={setQuery} listed={shown} />
    <Scroll ref={scroll}>
      {/* Hidden rather than dropped: the card keeps the figure it has drawn. */}
      <div className="lhead" hidden={searching}>
      {/* The demo card outranks the install offer: what group you are standing in
          comes before what to do with this browser. */}
      <DemoCard groupId={gid} />
      <LedgerInstall groupId={gid} />
      {me ? <MySummary net={net} base={base} gid={gid} /> : null}
      </div>

      <div className="searchroom">
      {items.length === 0 ? (
        <Empty title={copy.group.empty.title}>{copy.group.empty.body}</Empty>
      ) : found.length === 0 ? (
        <Empty title={copy.group.search.none.title}>{copy.group.search.none.body(shown.trim())}</Empty>
      ) : null}

      {/* Keyed by the search, so a keystroke redraws at once: the rows' fold and
          fade are for an entry that came or went. */}
      <LedgerRows key={searching ? shown : ""} groupId={gid} items={found} windowed row={(entry: LedgerRow) => entry.row === "expense"
        ? <ExpenseRow expense={entry.expense} gid={gid} base={base} me={me} memberById={memberById} />
        : <SettlementRow settlement={entry.settlement} gid={gid} base={base} me={me} memberById={memberById} />} />
      <div style={{ height: 88 }} />
      </div>
    </Scroll>
    </>
  );
}

/** The whole card is the button. The figure is sized to its own length. */
function MySummary({ net, base, gid }: { net: number; base: string; gid: string }) {
  // Unsigned: "You owe" already says the direction, and a "-" reads as
  // arithmetic.
  const figure = money(Math.abs(net), base);
  // A figure that moved while it was away rolls from what it drew last
  // (lib/roll.ts).
  const [before] = useState(() => shownBefore(gid, base));
  const [hold] = useState(() => peekSaved(gid) === null && peekDeleted(gid) === null ? undefined
    : (go: () => void) => awaitRoll(gid, go));
  useEffect(() => keepShown(gid, net, base), [gid, net, base]);
  // The sign trails `net` until the figure sets off, so a settle-up fades from
  // red as it rolls to zero.
  const [tone, setTone] = useState(() => before ?? net);
  const latest = useRef(net);
  latest.current = net;
  // A flip of sign alone rolls nothing, so nothing would start it.
  useEffect(() => setTone((t) => (Math.abs(t) === Math.abs(net) ? net : t)), [net]);
  const label = tone < 0 ? copy.group.you.owe : tone > 0 ? copy.group.you.owed : copy.group.you.square;
  return (
    <div className="mysummary pad">
      <Link href={route.balances(gid)} className={`card mysum ${signClass(tone)}`}
        style={{ "--chars": figure.length } as CSSProperties}>
        <span className="mysumtext">
          <span className="eyebrow">{label}</span>
          <span className="bignum">
            <RollingFigure minor={Math.abs(net)} currency={base}
              from={before === null ? null : Math.abs(before)} wait={ROLL_BEAT} hold={hold}
              onStart={() => setTone(latest.current)} />
          </span>
        </span>
        <Icon name="chev" size={20} className="mysumchev" />
      </Link>
    </div>
  );
}

/**
 * **Hoisted out of `Ledger`, never nested inside it**: a nested component is a
 * new identity every render, discarding an open delete confirmation. Memoised:
 * the ledger redraws as it scrolls, and a row whose entry hasn't changed has
 * nothing new to say.
 */
const ExpenseRow = memo(function ExpenseRow({ expense, gid, base, me, memberById }: {
  expense: Expense; gid: string; base: string; me: string | undefined; memberById: Map<string, Member>;
}) {
  const kind = kindOf(expense);
  const income = kind === "income";
  const payer = memberById.get(expense.paidBy);
  const payers = payerList(expense);
  const involved = me ? splitParticipants(expense.split).includes(me) : false;
  const putIn = me ? resolvePayers(expense)[me] ?? 0 : 0;
  const myNet = me ? entryEffect(expense, me).net : 0;
  const mine = putIn !== 0 || involved;
  const participants = splitParticipants(expense.split).length;
  const foreign = expense.currency !== base;
  const { hold, menu } = useEntryMenu(gid, me, kind, expense.id);

  return (
    <>
      <Link href={route.entry(gid, expense.id)} data-entry={expense.id}
        className={`row entryrow ${mine ? "" : "notmine"}`} {...hold}>
        <div className="rmain">
          <div className="rtitle">{expense.description || copy.group.untitled}</div>
          <ExpenseMeta payer={payer?.name ?? copy.someone} income={income}
            coPayers={payers.filter((id) => id !== expense.paidBy).length} ways={participants} />
        </div>
        <div className="ramt">
          {/* An income's figure carries a "−", or it reads as one more thing
              spent. Display only — the stored amount stays positive. */}
          <div className="big">{money(income ? -expense.baseAmountMinor : expense.baseAmountMinor, base)}</div>
          {foreign ? (
            <div className="sm">{money(expense.amountMinor, expense.currency)}</div>
          ) : null}
          <div className={`sm share ${signClass(myNet)}`}>
            {mine ? money(myNet, base, myNet !== 0) : copy.group.notYours}
          </div>
        </div>
      </Link>

      {menu}
    </>
  );
});

/**
 * The name is never dropped and takes the ellipsis; the head count is the one
 * thing that goes, wrapping onto a clipped line. No measuring.
 */
function ExpenseMeta({ payer, coPayers, ways, income }: {
  payer: string; coPayers: number; ways: number; income: boolean;
}) {
  return (
    <div className="rmeta paidby">
      <span className="who">
        <span className="name">{payer}</span>
        {coPayers > 0 ? <span className="more">{copy.group.morePayers(coPayers)}</span> : null}
      </span>
      <span className="waysbox">
        <span className="ways">
          <span className="sep" aria-hidden="true">·</span>
          <Icon name="users" size={12} />
          <span aria-hidden="true">{ways}</span>
          <span className="vh">{copy.group.sharedBy(plural(ways, copy.noun.person))}</span>
        </span>
      </span>
      {income ? <span className="incometag">{copy.group.incomeTag}</span> : null}
    </div>
  );
}

function useEntryMenu(gid: string, me: string | undefined, kind: EntryKind, entryId: string) {
  const router = useRouter();
  const del = useDeleteEntry({ groupId: gid, me, kind, entryId });
  const { hold, menu } = useLongPressMenu([
    { label: copy.act.edit, icon: "edit", onSelect: () => router.push(route.editEntry(gid, entryId, "ledger")) },
    { label: copy.act.delete, icon: "trash", danger: true, onSelect: del.ask },
  ], del.asking);
  return { hold, menu: <>{menu}{del.dialog}</> };
}

const SettlementRow = memo(function SettlementRow({ settlement, gid, base, me, memberById }: {
  settlement: Settlement; gid: string; base: string; me: string | undefined;
  memberById: Map<string, Member>;
}) {
  const from = memberById.get(settlement.fromMember);
  const to = memberById.get(settlement.toMember);
  const myNet = me ? entryEffect(settlement, me).net : 0;
  const { hold, menu } = useEntryMenu(gid, me, "transfer", settlement.id);

  return (
    <>
      <Link href={route.entry(gid, settlement.id)} data-entry={settlement.id}
        className={`row entryrow ${myNet !== 0 ? "" : "notmine"}`} {...hold}>
        <div className="rmain">
          <div className="rtitle">
            {copy.group.paidTo(from?.name ?? copy.unknown, to?.name ?? copy.unknown)}
          </div>
          <FitLine className="rmeta" options={transferMeta(settlement.note)} />
        </div>
        <div className="ramt">
          <div className="big">{money(settlement.baseAmountMinor, base)}</div>
          <div className={`sm share ${signClass(myNet)}`}>
            {myNet !== 0 ? money(myNet, base, true) : copy.group.notYours}
          </div>
        </div>
      </Link>

      {menu}
    </>
  );
});
