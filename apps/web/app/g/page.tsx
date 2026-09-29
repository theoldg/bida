"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  payerList, resolvePayers, shareOf, splitParticipants,
  type Expense, type Member, type Settlement,
} from "@bida/core";
import { kindOf, myEffect, type EntryKind } from "@/lib/entry-kind";
import { signClass } from "@/components/bits";
import {
  BadLink, Blank, Body, Empty, Fab, LedgerSkeleton, QueryBoundary, ScanFab, Screen, Scroll,
  SkeletonVeil, TopBar,
} from "@/components/chrome";
import { FitLine } from "@/components/fit-line";
import { GroupMenu } from "@/components/group-menu";
import { DemoCard } from "@/components/demo";
import { LedgerInstall, SkeletonBanner } from "@/components/install";
import { NewEdits } from "@/components/new-edits";
import { RollingFigure } from "@/components/rolling-figure";
import { Icon } from "@/components/icons";
import { LedgerRows } from "@/components/ledger-rows";
import { useLongPressMenu } from "@/components/long-press";
import { SyncBanner } from "@/components/sync-banner";
import { copy } from "@/lib/copy";
import { useDeleteEntry } from "@/components/delete-entry";
import { setLastOpenedGroup } from "@/lib/db/device";
import { syncGroup } from "@/lib/db/sync";
import { dayLabel, money } from "@/lib/format";
import { ledgerItems, type LedgerRow } from "@/lib/ledger";
import { route } from "@/lib/group-link";
import { useLedgerPosition } from "@/lib/ledger-position";
import { awaitRoll, peekSaved, SAVED_BEAT, clearDeleted, peekDeleted } from "@/lib/ledger-motion";
import { keepShown, ROLL_BEAT, shownBefore } from "@/lib/roll";
import { expenseMeta, transferMeta } from "@/lib/row-meta";
import { useClaimGate, useDevice, useGroupData } from "@/lib/hooks";
import type { GroupData } from "@/lib/hooks";

/**
 * The group's ledger: where a group opens, and the only screen that leaves it.
 * Everything else about the group is pressed into from here — the balances
 * from the card at its head (app/g/balances), the rest from the top-bar menu.
 */
export default function GroupPage() {
  return <QueryBoundary><GroupScreen /></QueryBoundary>;
}

/** How long a skeleton must have been up for its hand-off to fade (ms). */
const SKELETON_SEEN = 100;

function GroupScreen() {
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const data = useGroupData(groupId);
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

  // When the skeleton went up, so the ledger can dissolve it rather than cut to
  // it — but only one that was seen: under SKELETON_SEEN it barely registered,
  // and a fade would stretch a flash into a wait. A launch reopening this group
  // wore the same frame on `/` since first paint (lib/resume-hint.ts), and
  // that mark is still on during this screen's first render. Decided once, on
  // the ledger's first render.
  const skeletonSince = useRef<number>(undefined);
  const fade = useRef<boolean>(undefined);
  const [veiled, setVeiled] = useState(true);

  if (!groupId) return <Blank title={copy.group.noGroup} back={route.groups()} />;

  // The whole frame while loading, which also covers the redirect above rather
  // than flashing somebody else's ledger.
  if (data.loading || unclaimed) {
    skeletonSince.current ??= document.documentElement.hasAttribute("data-resuming") ? 0 : performance.now();
    return <LedgerSkeleton groupId={groupId} head={<SkeletonBanner groupId={groupId} />} />;
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
  fade.current ??= skeletonSince.current !== undefined && performance.now() - skeletonSince.current >= SKELETON_SEEN;

  return (
    <Screen>
      <Body>
        <SyncBanner groupId={group.id} pendingOps={data.pendingOps} />
        <TopBar
          title={group.name}
          back={route.groups()}
          /* One button: the group's own actions are a menu
             (components/group-menu.tsx), which leaves the bar to its name. */
          right={<GroupMenu groupId={group.id} data={data} />}
        />
        <Ledger data={data} />
      </Body>
      {fade.current && veiled ? <SkeletonVeil head={<SkeletonBanner groupId={group.id} />} onGone={() => setVeiled(false)} /> : null}

      {/* Two ways to start an expense. */}
      <ScanFab href={route.scan(group.id)} />
      <Fab href={route.addEntry(group.id)} />
    </Screen>
  );
}

// ------------------------------------------------------------- expenses

function Ledger({ data }: { data: GroupData }) {
  const { group, expenses, settlements, memberById, me, balances, withTombstones } = data;
  // Back from deleting on its own screen, the row is drawn once more, as it
  // was, and let go after a beat so it folds out where it stands.
  const [gone, setGone] = useState(() => group ? peekDeleted(group.id) : null);
  useEffect(() => {
    if (!gone) return;
    clearDeleted();
    const timer = setTimeout(() => setGone(null), SAVED_BEAT);
    return () => clearTimeout(timer);
  }, [gone]);
  const items = useMemo(() => {
    const expense = gone ? withTombstones.expenses[gone] : undefined;
    const settlement = gone ? withTombstones.settlements[gone] : undefined;
    const live = expenses.some((e) => e.id === gone) || settlements.some((s) => s.id === gone);
    return ledgerItems(
      expense && !live ? [...expenses, expense] : expenses,
      settlement && !live ? [...settlements, settlement] : settlements,
      dayLabel,
    );
  }, [expenses, settlements, gone, withTombstones]);
  const scroll = useRef<HTMLDivElement>(null);
  useLedgerPosition(scroll, group?.id ?? "");
  if (!group) return null;
  // Read out once past the guard: both row components take them as props.
  const { id: gid, baseCurrency: base } = group;

  // The ledger answers "does this one help me or hurt me?", so every row
  // carries its own effect on your balance — what you put in for it, minus what
  // you owe for it — signed and coloured in the figure. They add up to `net`.
  const net = me ? balances.byMember[me] ?? 0 : 0;

  return (
    <Scroll ref={scroll}>
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
      {me ? <MySummary net={net} base={base} gid={gid} /> : null}
      {/* Between where you stand and the rows, since it is why either moved. */}
      <NewEdits groupId={gid} currency={base} source={group.importedFrom} />

      {items.length === 0 ? (
        <Empty title={copy.group.empty.title}>{copy.group.empty.body}</Empty>
      ) : null}

      <LedgerRows groupId={gid} items={items} row={(entry: LedgerRow) => entry.row === "expense"
        ? <ExpenseRow expense={entry.expense} gid={gid} base={base} me={me} memberById={memberById} />
        : <SettlementRow settlement={entry.settlement} gid={gid} base={base} me={me} memberById={memberById} />} />
      <div style={{ height: 88 }} />
    </Scroll>
  );
}

/**
 * Where you stand, and the way to the balances: the whole card is the button,
 * so it wears a chevron and the press wash of `a.card`.
 * The figure is sized to its own length (`.mysum` in globals.css), so a long
 * sum shrinks to fit rather than running under the chevron.
 */
function MySummary({ net, base, gid }: { net: number; base: string; gid: string }) {
  const label = net < 0 ? copy.group.you.owe : net > 0 ? copy.group.you.owed : copy.group.you.square;
  // Unsigned, unlike every other figure: "You owe" already says the direction,
  // and a "-" reads as arithmetic rather than debt.
  const figure = money(Math.abs(net), base);
  // What this card drew last time, read once: a figure that moved while it was
  // away — a save, another phone's edit — rolls from it (lib/roll.ts).
  const [before] = useState(() => shownBefore(gid, base));
  // Back from a save, the ledger may glide up to this card; the roll waits for
  // it to arrive (components/ledger-rows.tsx).
  const [hold] = useState(() => peekSaved(gid) === null ? undefined
    : (go: () => void) => awaitRoll(gid, go));
  useEffect(() => keepShown(gid, net, base), [gid, net, base]);
  return (
    <div className="mysummary pad">
      <Link href={route.balances(gid)} className={`card mysum ${signClass(net)}`}
        style={{ "--chars": figure.length } as CSSProperties}>
        <span className="mysumtext">
          <span className="eyebrow">{label}</span>
          <span className="bignum">
            <RollingFigure minor={Math.abs(net)} currency={base}
              from={before === null ? null : Math.abs(before)} wait={ROLL_BEAT} hold={hold} />
          </span>
        </span>
        <Icon name="chev" size={20} className="mysumchev" />
      </Link>
    </div>
  );
}

/**
 * **Hoisted out of `Ledger`, never nested inside it** (as `SettlementRow`
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
  const { hold, menu } = useEntryMenu(gid, me, kind, expense.id);

  return (
    <>
      <Link href={route.entry(gid, expense.id)} data-entry={expense.id}
        className={`row entryrow ${mine ? "" : "notmine"}`} {...hold}>
        <div className="rmain">
          <div className="rtitle">{expense.description || copy.group.untitled}</div>
          {/* Who paid, how many ways, in what mode — more than a phone's
              width holds when a name is long. The ladder that decides what
              goes first is `lib/row-meta.ts`; this only picks off it. */}
          <FitLine className="rmeta" options={expenseMeta({
            payer: payer?.name ?? copy.someone,
            coPayers: payers.filter((id) => id !== expense.paidBy)
              .map((id) => memberById.get(id)?.name ?? copy.someone),
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
    </>
  );
}

/**
 * A ledger row's long press: edit, or delete after the question
 * (`useDeleteEntry`). `menu` carries both the card and the question.
 */
function useEntryMenu(gid: string, me: string | undefined, kind: EntryKind, entryId: string) {
  const router = useRouter();
  const del = useDeleteEntry({ groupId: gid, me, kind, entryId });
  const { hold, menu } = useLongPressMenu([
    { label: copy.act.edit, icon: "edit", onSelect: () => router.push(route.editEntry(gid, entryId, "ledger")) },
    { label: copy.act.delete, icon: "trash", danger: true, onSelect: del.ask },
  ], del.asking);
  return { hold, menu: <>{menu}{del.dialog}</> };
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
          <div className="big" style={{ color: "var(--muted)" }}>
            {money(settlement.baseAmountMinor, base)}
          </div>
          <div className={`sm share ${signClass(myNet)}`}>
            {myNet !== 0 ? money(myNet, base, true) : copy.group.notYours}
          </div>
        </div>
      </Link>

      {menu}
    </>
  );
}
