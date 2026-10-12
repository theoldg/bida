"use client";
// Doc: docs/entry.md#the-entry-on-screen

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  entryEffect, groupCreateOf, isCoSponsored, isImported, ownCurrencySplit, payerList, resolvePayers,
  resolveEntrySplit, resolveSplit, restoreEntryDrafts, sortOps, splitParticipants,
  type CurrencyCode, type Expense, type Group, type Op, type RateSource, type Settlement,
} from "@bida/core";
import { Card, Eyebrow, KV, You, signClass } from "@/components/bits";
import { FitLine, FitTitle } from "@/components/fit-line";
import { MemberBill } from "@/components/member-bill";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { useDeleteEntry } from "@/components/delete-entry";
import { RateChip, RateDialog } from "@/components/rate-dialog";
import { editExpense, editSettlement, restoreEntry } from "@/lib/db/commands";
import { db } from "@/lib/db/dexie";
import { syncGroup } from "@/lib/db/sync";
import { useLive } from "@/lib/db/live";
import { kindOf, type EntryKind } from "@/lib/entry-kind";
import { rateDayOf } from "@/lib/entry-rate";
import { copy } from "@/lib/copy";
import { bare, money, moneyParts, plural, whenLabel } from "@/lib/format";
import { savedBill } from "@/lib/draft";
import { entryParent, parseEntrySource, route } from "@/lib/group-link";
import { slidingDock, useFold } from "@/lib/fold";
import { markReturn } from "@/lib/nav";
import { historyMeta } from "@/lib/row-meta";
import { useClaimGate, useGroupData, type GroupData } from "@/lib/hooks";

/**
 * Largest first, ending at the size it wraps at. All below the amount, which
 * never drops under 28px — the money leads.
 */
const ENTRY_TITLE_SIZES = [26, 22, 17] as const;

/**
 * The id is looked up in both tables (random ids, can't collide), so every ledger
 * row has a screen (ADR-0010).
 */
export default function EntryPage() {
  return <QueryBoundary><EntryScreen /></QueryBoundary>;
}

/**
 * A notification's tap can land here before the sync that brings the entry in, so
 * "Gone" waits for one sync of the group and a read of what it wrote.
 */
function useArriving(groupId: string | undefined, entryId: string | undefined, found: boolean): boolean {
  const [looked, setLooked] = useState<string>();
  const key = `${groupId}/${entryId}`;
  useEffect(() => {
    if (found || !groupId || !entryId) return;
    let live = true;
    void (async () => {
      await syncGroup(groupId).catch(() => {});
      // The live read catches up a beat after the sync resolves.
      const d = db();
      const row = (await d.expenses.get(entryId)) ?? (await d.settlements.get(entryId));
      if (live && (!row || row.deletedAt)) setLooked(key);
    })();
    return () => { live = false; };
  }, [found, groupId, entryId, key]);
  return !found && looked !== key;
}

function EntryScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const entryId = params.get("e") ?? undefined;
  // Back belongs to whichever screen linked in (lib/group-link.ts).
  const via = parseEntrySource(params.get("via"));
  const parent = groupId ? entryParent(groupId, via) : "/";
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  // Deleted here, it keeps drawing the entry as it was: the live read lands
  // before the navigation does.
  const going = useRef(false);
  const lastLive = useRef<Expense | Settlement>(undefined);
  const found = data.expenses.find((e) => e.id === entryId)
    ?? data.settlements.find((s) => s.id === entryId);
  if (found) lastLive.current = found;
  const live = found ?? (going.current ? lastLive.current : undefined);
  // Drawn as it was, at the rates it was saved at, under a band holding Restore
  // (ADR-0031).
  const tombstoned = !live && entryId
    ? [data.withTombstones.expenses[entryId], data.withTombstones.settlements[entryId]]
      .find((row) => !!row?.deletedAt)
    : undefined;
  const row = live ?? tombstoned;
  const expense = row && row.id in data.withTombstones.expenses ? row as Expense : undefined;
  const settlement = row && !expense ? row as Settlement : undefined;
  const del = useDeleteEntry({
    groupId, me: data.me, kind: expense ? kindOf(expense) : "transfer", entryId: row?.id ?? "",
    before: () => { going.current = true; },
    then: () => { if (groupId) { markReturn(route.group(groupId)); router.replace(route.group(groupId)); } },
  });
  const [restoring, setRestoring] = useState(false);
  const [askRate, setAskRate] = useState(false);
  const arriving = useArriving(groupId, entryId, !!row);

  // From the log itself: revisions are ops, not a counter. A delete or a restore
  // is not an edit of what the entry says.
  const log = useLive("entryLog", async () => {
    if (!entryId) return { count: 0 };
    const ops = sortOps(await db().ops.where("entityId").equals(entryId).toArray());
    // Its create shares the group's (`isImported`).
    const first = ops.find((o) => o.kind === "create");
    const imported = !!first && isImported(first,
      groupCreateOf(await db().ops.where("entityId").equals(first.groupId).toArray()));
    const lifecycle = (o: Op) => o.kind === "delete"
      || (Object.keys(o.patch).length === 1 && "deletedAt" in o.patch);
    const revisions = ops.filter((o) => !lifecycle(o));
    return {
      count: revisions.length,
      creator: revisions[0]?.actor,
      imported,
      lastEditor: revisions.at(-1)?.actor,
      lastDelete: ops.filter((o) => o.kind === "delete").at(-1),
    };
  }, [entryId]);

  if (!groupId) return <BadLink />;
  if (data.loading || unclaimed) return <Blank back={parent} />;
  if (!data.group) return <BadLink />;
  const group = data.group;
  const entry = expense ?? settlement;
  const deleted = !!entry && !live;

  if (!entry && arriving) {
    return (
      <Screen><Body>
        <TopBar title=" " back={parent} />
        <div className="empty arriving" role="status">
          <span className="spinner" aria-hidden="true" />{copy.entry.arriving}
        </div>
      </Body></Screen>
    );
  }
  if (!entry) {
    return (
      <Screen><Body>
        <TopBar title={copy.entry.gone.title} back={parent} />
        <Empty title={copy.entry.gone.body} />
      </Body></Screen>
    );
  }

  const kind: EntryKind = expense ? kindOf(expense) : "transfer";
  const title = expense?.description.trim();
  const edits = Math.max(0, (log?.count ?? 0) - 1);
  const entity = expense ? "expense" as const : "settlement" as const;
  const brings = deleted
    ? restoreEntryDrafts(data.withTombstones, entity, entry.id).slice(1)
      .filter((d) => d.entity === "member").map((d) => data.nameOf(d.entityId))
    : [];
  async function restore() {
    const actor = data.me;
    if (!groupId || !entry || !actor || restoring) return;
    setRestoring(true);
    // The screen turns back into the live entry by itself.
    try { await restoreEntry(groupId, actor, entity, entry.id); } finally { setRestoring(false); }
  }
  const foreign = entry.currency !== group.baseCurrency;
  // Blank until the log lands: a wrong name for a frame is worse than none.
  const historyLine = log?.creator ? historyMeta({
    edits,
    creator: data.nameOf(log.creator),
    lastEditor: data.nameOf(log.lastEditor ?? log.creator),
    imported: log.imported
      && (group.importedFrom ? copy.history.importSource[group.importedFrom] : true),
  }) : [""];

  return (
    <Screen>
      <Body>
        {/* Two bounded strings, so the bar is one height everywhere; the title is
            below. */}
        <TopBar
          title={deleted ? copy.entry.deletedTitle(copy.entryKind.label[kind]) : copy.entryKind.label[kind]}
          sub={whenLabel(entry)}
          back={parent}
          right={deleted ? null : (
            <button className="iconbtn" onClick={del.ask} aria-label={copy.act.delete}>
              <Icon name="trash" size={18} />
            </button>
          )}
        />

        <Scroll>
          {deleted ? (
            <div className="pad" style={{ paddingTop: 2, paddingBottom: 8 }}>
              <div className="deletedband" role="status">
                <p>
                  <b><Icon name="trash" size={14} /> {copy.entry.deleted(log?.lastDelete && data.nameOf(log.lastDelete.actor))}</b>
                </p>
                <button className="btn" onClick={restore} disabled={restoring}>{copy.entry.restore}</button>
              </div>
              {brings.length > 0 ? <p className="hint">{copy.entry.restoreBrings(brings)}</p> : null}
            </div>
          ) : null}
          {/* The screen is the form at rest. A transfer's head stays bare above
              its card. */}
          <div className="pad" style={{ paddingTop: 2, paddingBottom: expense ? 0 : undefined }}>
          <div className={expense ? "card entryhead" : "entryhead"}>
            {/* The bar already says "Expense". */}
            {title ? (
              <FitTitle className="entrytitle selectable" text={title} sizes={ENTRY_TITLE_SIZES} />
            ) : null}
            <div className="entryfig">
              <EntryFigure minor={entry.baseAmountMinor} currency={group.baseCurrency} />
              {foreign ? (
                <EntrySpent minor={entry.amountMinor} currency={entry.currency}>
                  {/* A deleted entry is drawn as it was, which no dialog edits. */}
                  <RateChip rate={entry.rateToBase} disabled={deleted}
                    aria-label={copy.rates.editTitle(entry.currency)}
                    onClick={() => setAskRate(true)} />
                </EntrySpent>
              ) : null}
            </div>
            {expense && kind !== "transfer" ? <>
              <div className="hairline" />
              <EntryBy expense={expense} kind={kind} group={group} data={data} />
            </> : null}
          </div>
          </div>

          {expense
            ? <ExpenseDetail expense={expense} kind={kind} group={group} data={data} />
            : <TransferDetail settlement={settlement!} data={data} />}

        </Scroll>
        {/* Docked as the form's Save is (`.whodock`). The one way into this
            entry's history — quiet, since it is read more than pressed. */}
        <div className="pad whodock" ref={slidingDock} style={{ paddingTop: 2 }}>
          <div className="entryhist">
            <FitLine className="entryhistline" options={historyLine}
              icon={<Icon name="clock" size={14} />} trail={<Icon name="chev" size={13} />}
              body={(shown) => (
                <Link href={route.history(groupId, entry.id, via)} className="entryhistbody">{shown}</Link>
              )} />
          </div>
          {deleted ? null : (
            <Link href={route.editEntry(groupId, entry.id, via)} className="btn btn-s">{copy.act.edit}</Link>
          )}
        </div>
      </Body>

      {del.dialog}
      {askRate && foreign ? (
        <RateDialog
          currency={entry.currency}
          base={group.baseCurrency}
          day={rateDayOf(entry.occurredAt)}
          current={{ rate: entry.rateToBase, source: entry.rateSource ?? "group" }}
          onSave={async (rate: string, rateSource: RateSource) => {
            if (!data.me) return;
            if (expense) await editExpense(groupId, data.me, entry.id, { rateToBase: rate, rateSource });
            else await editSettlement(groupId, data.me, entry.id, { rateToBase: rate, rateSource });
          }}
          onClose={() => setAskRate(false)}
        />
      ) : null}
    </Screen>
  );
}

/**
 * The code and the fraction at half size, so the digits that matter carry the
 * weight. `--chars` lets the CSS shrink a long sum to a narrow phone.
 */
function EntryFigure({ minor, currency }: { minor: number; currency: CurrencyCode }) {
  const p = moneyParts(minor, currency);
  const code = <span className={isSymbol(p.currency) ? "ccy sym" : "ccy"}>{p.currency}</span>;
  return (
    <span className="bignum entryamt" style={{ "--chars": p.whole.length } as CSSProperties}>
      {p.currencyFirst ? code : null}
      <span className="whole">{p.whole}<span className="frac">{p.fraction}</span></span>
      {p.currencyFirst ? null : code}
    </span>
  );
}

/** One glyph at a code's size reads as a speck, so it is sized up. */
const isSymbol = (currency: string) => [...currency].length === 1;

function EntrySpent({ minor, currency, children }: {
  minor: number; currency: CurrencyCode; children: ReactNode;
}) {
  const p = moneyParts(minor, currency);
  const code = <span className={isSymbol(p.currency) ? "num sym" : "num"}>{p.currency}</span>;
  return (
    <span className="entryspent">
      {p.currencyFirst ? code : null}
      <span className="num">{p.whole}{p.fraction}</span>
      {p.currencyFirst ? null : code}
      {children}
    </span>
  );
}

/** One payer is a line, named nowhere else; several are rows. */
function EntryBy({ expense, kind, group, data }: {
  expense: Expense; kind: "expense" | "income"; group: Group; data: GroupData;
}) {
  if (!isCoSponsored(expense)) {
    return (
      <p className="entryby">
        {copy.entry.byLead[kind]} <b>{data.memberById.get(expense.paidBy)?.name ?? copy.someone}</b>
        {expense.paidBy === data.me ? <You /> : null}
      </p>
    );
  }
  const payers = payerList(expense);
  const foreign = expense.currency !== group.baseCurrency;
  // In base: the figure that actually moves their balance.
  const putIn = resolvePayers(expense);
  return <>
    <Eyebrow style={{ marginBottom: 4 }}>
      {copy.entryKind.payer[kind]} <b>{plural(payers.length, copy.noun.person)}</b>
    </Eyebrow>
    {payers.map((id) => {
      const own = expense.payers?.[id] ?? 0;
      return (
        <KV key={id}
          k={id === data.me
            ? <span>{data.memberById.get(id)?.name ?? copy.someone}<You /></span>
            : data.memberById.get(id)?.name ?? copy.someone}
          v={foreign
            ? <TwoCurrencies base={money(putIn[id] ?? 0, group.baseCurrency)}
              own={money(own, expense.currency)} />
            : money(putIn[id] ?? 0, group.baseCurrency)} />
      );
    })}
  </>;
}

/**
 * The ledger row's second figure. Where two of the card's numbers made it, it
 * unfolds to the sum written out as at school, the result under a rule.
 */
function YourBalance({ kind, up, down, net, currency }: {
  kind: "expense" | "income"; up: number; down: number; net: number; currency: CurrencyCode;
}) {
  const { open, toggle, ref: fold } = useFold<HTMLDivElement>();
  const result = money(net, currency, net !== 0);
  const label = copy.entry.yourBalance;
  if (!(up > 0 && down > 0)) {
    return (
      <div className="kv yourbal">
        <span className="k eyebrow">{label}</span>
        <span className="v"><b className={signClass(net)}>{result}</b></span>
      </div>
    );
  }
  const [upWord, downWord] = copy.entry.sumWords[kind];
  // What follows the last digit is a column of its own, so the digits line up.
  const cut = result.search(/\d\D*$/) + 1;
  return (
    <div ref={fold} className="yourbal">
      <button type="button" className="kv" aria-expanded={open} onClick={toggle}>
        <span className="k eyebrow">
          {label}<Icon name="chev" size={11} className={`kvchev${open ? " on" : ""}`} />
        </span>
        <span className="v">{open ? null : <b className={signClass(net)}>{result}</b>}</span>
      </button>
      {open ? (
        <div className="sumrows">
          <span className="w">{upWord}</span><span>{bare(up, currency)}</span><span />
          <span className="w">{downWord}</span><span>− {bare(down, currency)}</span><span />
          <span /><b className={`eq ${signClass(net)}`}>{result.slice(0, cut)}</b>
          <b className={`eq ${signClass(net)}`}>{result.slice(cut)}</b>
        </div>
      ) : null}
    </div>
  );
}

function ExpenseDetail({ expense, kind, group, data }: {
  expense: Expense; kind: EntryKind; group: Group; data: GroupData;
}) {
  const english = expense.receiptEnglish === true;
  const me = data.me;
  // One span: a flex box would float the smaller tag off the baseline.
  const yours = (id: string, name: string, detail = "") =>
    (id === me ? <span>{name}<You />{detail}</span> : `${name}${detail}`);
  const putIn = resolvePayers(expense);
  const participants = splitParticipants(expense.split);
  const foreign = expense.currency !== group.baseCurrency;
  let shares: Record<string, number> = {};
  try {
    shares = resolveEntrySplit(expense).shares;
  } catch { /* a broken split still deserves a readable screen */ }
  // The form showed these figures, so the saved entry does too.
  let ownShares: Record<string, number> = {};
  if (foreign) {
    try {
      ownShares = resolveSplit(expense.amountMinor, ownCurrencySplit(expense), { tiebreakSeed: expense.id }).shares;
    } catch { /* as above */ }
  }
  const bill = savedBill(expense, english);

  return (
    <div className="pad" style={{ paddingTop: 0 }}>
      <div className="splitrule entrysplit" aria-hidden="true"><span /></div>
      <Card>
        <Eyebrow style={{ marginBottom: 4 }}>
          {copy.entry.splitMode(copy.entryKind.split[kind],
            // `??`: a mode this build doesn't know heads as itself.
            (copy.split.mode[expense.split.mode] ?? expense.split.mode).toLowerCase())}
        </Eyebrow>
        {/* Only the people in the split: a row per outsider owing nothing says
            what their absence already says. */}
        {/* Removed members too: a deleted entry can name somebody gone since. */}
        {[...data.memberById.values()].filter((m) => participants.includes(m.id))
          .sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
          // A receipt's weights are the bill's arithmetic, shown as the bill
          // instead.
          const detail = expense.split.mode === "shares"
            ? ` · ${plural(expense.split.weights[m.id] ?? 0, copy.noun.part)}`
            : "";
          const k = yours(m.id, m.name, detail);
          const v = foreign
            ? <TwoCurrencies base={money(shares[m.id] ?? 0, group.baseCurrency)}
              own={money(ownShares[m.id] ?? 0, expense.currency)} />
            : money(shares[m.id] ?? 0, group.baseCurrency);
          const lines = bill?.[m.id];
          if (!lines?.length) return <KV key={m.id} k={k} v={v} />;
          return <MemberBill key={m.id} name={k} total={v} lines={lines}
            format={(minor) => money(minor, expense.currency)} />;
        })}
      </Card>
      {me && kind !== "transfer" && ((putIn[me] ?? 0) > 0 || participants.includes(me)) ? (
        <div className="balline">
          <YourBalance kind={kind} {...entryEffect(expense, me)}
            currency={group.baseCurrency} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Stacked, not bracketed: a column of brackets read as one long line of digits.
 */
function TwoCurrencies({ base, own }: { base: string; own: string }) {
  return <span className="twoccy">{base}<span className="ownccy">{own}</span></span>;
}

function TransferDetail({ settlement, data }: { settlement: Settlement; data: GroupData }) {
  const from = data.memberById.get(settlement.fromMember);
  const to = data.memberById.get(settlement.toMember);
  return (
    <div className="pad" style={{ paddingTop: 2 }}>
      <div className="card transfer">
        <span className="tside">
          <span className="eyebrow">{copy.entry.from}</span>
          <span className="who">{from?.name ?? copy.none}</span>
        </span>
        <span className="tswap" aria-hidden="true"><Icon name="arrow" size={18} /></span>
        <span className="tside">
          <span className="eyebrow">{copy.entry.to}</span>
          <span className="who">{to?.name ?? copy.none}</span>
        </span>
      </div>
      {settlement.note ? (
        <p className="selectable" style={{ fontSize: 13, color: "var(--ink-2)", margin: "10px 2px 0" }}>
          {settlement.note}
        </p>
      ) : null}
    </div>
  );
}
