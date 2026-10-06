"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  groupCreateOf, isCoSponsored, isImported, ownCurrencySplit, payerList, receiptExtras, resolvePayers,
  resolveEntrySplit, resolveSplit, restoreEntryDrafts, sortOps, splitParticipants,
  type CurrencyCode, type Expense, type Group, type Op, type RateSource, type Settlement,
} from "@bida/core";
import { Card, Eyebrow, KV, signClass } from "@/components/bits";
import { FitLine, FitTitle, useRefit } from "@/components/fit-line";
import { MemberBill } from "@/components/member-bill";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { Icon } from "@/components/icons";
import { useDeleteEntry } from "@/components/delete-entry";
import { RateChip, RateDialog } from "@/components/rate-dialog";
import { restoreEntry, setRate } from "@/lib/db/commands";
import { db } from "@/lib/db/dexie";
import { syncGroup } from "@/lib/db/sync";
import { useLive } from "@/lib/db/live";
import { effectSum, kindOf, type EntryKind } from "@/lib/entry-kind";
import { fitIndex, styleOf, textWidth } from "@/lib/fit";
import { copy } from "@/lib/copy";
import { money, moneyParts, plural, whenLabel } from "@/lib/format";
import { billExtrasIn, billLabels, receiptBreakdown } from "@/lib/scan/items";
import { entryParent, parseEntrySource, route } from "@/lib/group-link";
import { markReturn } from "@/lib/nav";
import { historyMeta } from "@/lib/row-meta";
import { useClaimGate, useGroupData, type GroupData } from "@/lib/hooks";

/**
 * The title's type sizes, largest first, ending at the size it wraps at: a
 * one-word title is a heading, a sentence a paragraph. All below the amount,
 * which never drops under 28px — the money leads.
 */
const ENTRY_TITLE_SIZES = [26, 22, 17] as const;

/**
 * One entry, whichever of the three it is. The id is looked up in both tables
 * (random ids, can't collide), so every ledger row has a screen (ADR-0010).
 */
export default function EntryPage() {
  return <QueryBoundary><EntryScreen /></QueryBoundary>;
}

/**
 * Whether an entry this phone doesn't have may still be on its way. A
 * notification's tap lands here before the sync that brings the entry in —
 * the push outran the pull — so "Gone" waits for one sync of the group (joining
 * the one opening the app started) and a read of what it wrote. Only a row
 * still missing after that is gone; so is one a failed sync didn't bring,
 * since nothing more comes until the next. A deleted one has a screen.
 */
function useArriving(groupId: string | undefined, entryId: string | undefined, found: boolean): boolean {
  const [looked, setLooked] = useState<string>();
  const key = `${groupId}/${entryId}`;
  useEffect(() => {
    if (found || !groupId || !entryId) return;
    let live = true;
    void (async () => {
      await syncGroup(groupId).catch(() => {});
      // The live read catches up a beat after the sync resolves; a row that is
      // there now will be `found` then, so only an absent one ends the wait.
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
  // Not the ledger, sometimes: the feed and the two blocked-removal dialogs
  // link in from beside this screen, and back belongs to whichever it was
  // (lib/group-link.ts).
  const via = parseEntrySource(params.get("via"));
  const parent = groupId ? entryParent(groupId, via) : "/";
  const data = useGroupData(groupId);
  const unclaimed = useClaimGate(groupId, data);
  // Deleted here, the screen is on its way to the ledger and keeps drawing the
  // entry as it was: the live read lands before the navigation does, and must
  // not flash the deleted screen on the way out.
  const going = useRef(false);
  const lastLive = useRef<Expense | Settlement>(undefined);
  const found = data.expenses.find((e) => e.id === entryId)
    ?? data.settlements.find((s) => s.id === entryId);
  if (found) lastLive.current = found;
  const live = found ?? (going.current ? lastLive.current : undefined);
  // Deleted, it is drawn as it was, at the rates it was saved at, under a band
  // that says so and holds Restore (ADR-0031).
  const tombstoned = !live && entryId
    ? [data.withTombstones.expenses[entryId], data.withTombstones.settlements[entryId]]
      .find((row) => !!row?.deletedAt)
    : undefined;
  const row = live ?? tombstoned;
  // Ids are random, so the table it is in says which of the two it is.
  const expense = row && row.id in data.withTombstones.expenses ? row as Expense : undefined;
  const settlement = row && !expense ? row as Settlement : undefined;
  const del = useDeleteEntry({
    groupId, me: data.me, kind: expense ? kindOf(expense) : "transfer", entryId: row?.id ?? "",
    before: () => { going.current = true; },
    // Back to the ledger as it was left, less the row (lib/ledger-position.ts).
    then: () => { if (groupId) { markReturn(route.group(groupId)); router.replace(route.group(groupId)); } },
  });
  const [restoring, setRestoring] = useState(false);
  const [askRate, setAskRate] = useState<CurrencyCode | null>(null);
  const arriving = useArriving(groupId, entryId, !!row);

  // "Edited 3 times" comes from the log itself: revisions are ops, not a
  // counter somebody has to remember to increment. A delete or a restore is
  // not an edit of what the entry says. The first revision names who created
  // it, the last who changed it last, and the last delete who deleted it.
  const log = useLive("entryLog", async () => {
    if (!entryId) return { count: 0 };
    const ops = sortOps(await db().ops.where("entityId").equals(entryId).toArray());
    // Came in with the group: its create shares the group's (`isImported`).
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
  // What pressing Restore also brings back, named before the press.
  const brings = deleted
    ? restoreEntryDrafts(data.withTombstones, entity, entry.id).slice(1)
      .map((d) => (d.entity === "member" ? data.nameOf(d.entityId) : copy.entry.theRate(d.entityId)))
    : [];
  async function restore() {
    const actor = data.me;
    if (!groupId || !entry || !actor || restoring) return;
    setRestoring(true);
    // The screen turns back into the live entry by itself: the row it reads
    // is the one this writes.
    try { await restoreEntry(groupId, actor, entity, entry.id); } finally { setRestoring(false); }
  }
  const foreign = entry.currency !== group.baseCurrency;
  // Blank until the log lands, a beat behind the row: a wrong name for a frame
  // is worse than none, and the link keeps its height either way.
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
        {/* The bar holds the kind and the date — two bounded strings, so it is
            the same height everywhere. The title, of unknown length, is below
            (`.entrytitle`). */}
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
          {/* Deleted, it says so before anything else on the screen, and Restore
              is in the same strip: drawn as it was, the rest reads exactly like
              a live entry. */}
          {deleted ? (
            <div className="pad" style={{ paddingTop: 2, paddingBottom: 8 }}>
              <div className="deletedband" role="status">
                <p>
                  <b><Icon name="trash" size={14} /> {copy.entry.deleted}</b>
                  {/* Who comes from the log, a read behind the row: until it lands, when. */}
                  <span>{copy.entry.deletedBy(log?.lastDelete && data.nameOf(log.lastDelete.actor),
                    whenLabel({ occurredAt: entry.deletedAt! }))}</span>
                </p>
                <button className="btn" onClick={restore} disabled={restoring}>{copy.entry.restore}</button>
              </div>
              {brings.length > 0 ? <p className="hint">{copy.entry.restoreBrings(brings)}</p> : null}
            </div>
          ) : null}
          <div className="pad entryhead" style={{ paddingTop: 2 }}>
            {/* Nothing when there is no title: the bar already says "Expense". A
                transfer has none — its words are the note. */}
            {title ? (
              <FitTitle className="entrytitle selectable" text={title} sizes={ENTRY_TITLE_SIZES} />
            ) : null}
            <div className={`entryfig${expense ? " ruled" : ""}`}>
              <EntryFigure minor={entry.baseAmountMinor} currency={group.baseCurrency} />
              {foreign ? (
                <EntrySpent minor={entry.amountMinor} currency={entry.currency}>
                  {/* The group's rate, so the editor's door to it: a deleted
                      entry is drawn at the rate it was saved at, which no
                      dialog edits. */}
                  <RateChip rate={entry.rateToBase} disabled={deleted}
                    aria-label={copy.rates.editTitle(entry.currency)}
                    onClick={() => setAskRate(entry.currency)} />
                </EntrySpent>
              ) : null}
            </div>
            {/* Who, under the rule. A transfer's card is nothing but who, so it
                has no line here. */}
            {expense && kind !== "transfer" ? <EntryBy expense={expense} kind={kind} data={data} /> : null}
          </div>

          {expense
            ? <ExpenseDetail expense={expense} kind={kind} group={group} data={data} />
            : <TransferDetail settlement={settlement!} data={data} />}

        </Scroll>
        {/* Docked as the form's Save is (`.whodock`): under the card while the
            entry fits, at the foot once a long split scrolls above it. The one
            way into this entry's history — who made it, or how often it changed
            and who last — quiet, since it is read more than it is pressed. A
            deleted entry keeps it where Edit would be. */}
        <div className="pad whodock" style={{ paddingTop: 2 }}>
          <Link href={route.history(groupId, entry.id, via)} className="entryhist">
            <FitLine className="entryhistline" bodyClassName="entryhistbody" options={historyLine}
              icon={<Icon name="clock" size={14} />} trail={<Icon name="chev" size={13} />} />
          </Link>
          {deleted ? null : (
            <Link href={route.editEntry(groupId, entry.id, via)} className="btn btn-s">{copy.act.edit}</Link>
          )}
        </div>
      </Body>

      {del.dialog}
      {askRate !== null ? (
        <RateDialog
          currency={askRate}
          base={group.baseCurrency}
          current={data.rates[askRate]}
          entryCount={data.currencies.find((c) => c.currency === askRate)?.entryCount ?? 0}
          onSave={async (rate: string, source: RateSource, asOf: number) => {
            if (data.me) await setRate(groupId, data.me, askRate, rate, source, asOf);
          }}
          onClose={() => setAskRate(null)}
        />
      ) : null}
    </Screen>
  );
}

/**
 * The head's figure: the whole part large, the code and the fraction at half
 * its size — so the digits that matter carry the weight. A lone symbol is
 * `.sym`, sized up: one glyph at a code's size reads as a speck. `--chars` lets
 * the CSS shrink a sum too long for a narrow phone to its width (`.entryamt`).
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

/** "€" rather than "PLN": one glyph, which hugs its digits (`.entryamt .sym`). */
const isSymbol = (currency: string) => [...currency].length === 1;

/**
 * The sum as spent, and the rate that made it the figure above: one run of
 * text from the left margin, the code on whichever side the locale puts it.
 */
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

/**
 * "paid by Adaś". One payer is named here and nowhere else on the screen;
 * several keep their card rows, which carry what each put in, so this line
 * only counts them. How many ways it was split is the card's rows.
 */
function EntryBy({ expense, kind, data }: {
  expense: Expense; kind: "expense" | "income"; data: GroupData;
}) {
  const payers = payerList(expense);
  const several = isCoSponsored(expense);
  const who = several
    ? plural(payers.length, copy.noun.person)
    : data.memberById.get(expense.paidBy)?.name ?? copy.someone;
  const mine = !several && expense.paidBy === data.me;
  return (
    <div className="entryby">
      <p>{copy.entry.byLead[kind]} <b>{who}</b>{mine ? <You /> : null}</p>
    </div>
  );
}

/** Beside your own name, wherever the entry prints it. */
function You() {
  return <span className="youtag"> ({copy.entry.you})</span>;
}

/** A figure with no currency code, for the middle of a sum that ends with one. */
function bare(minor: number, currency: CurrencyCode): string {
  const p = moneyParts(minor, currency);
  return `${p.whole}${p.fraction}`;
}

/**
 * Room the one-line sum must have to spare, beyond the `.kv` gap, before it
 * stays on the line: one that only just fits crowds its label.
 */
const SUM_SLACK = 24;

/**
 * What this entry did to your balance — the ledger row's second figure,
 * signed and coloured as it is there. When two of the card's numbers made it
 * (you paid and had a share), it is written as their difference, uncoloured:
 * "50.00 − 20.00 = +CRD 30.00" beside the label, and as soon as that stops
 * fitting comfortably, written out as at school: one number under the other
 * and the result under a rule.
 */
function YourBalance({ up, down, net, currency }: {
  up: number; down: number; net: number; currency: CurrencyCode;
}) {
  const both = up > 0 && down > 0;
  const result = money(net, currency, net !== 0);
  const line = both ? `${bare(up, currency)} − ${bare(down, currency)} = ` : "";
  const row = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  const fig = useRef<HTMLElement>(null);
  const [column, setColumn] = useState(false);

  useRefit(row, (el) => {
    if (!both) return setColumn(false);
    if (!label.current || !fig.current) return;
    // A mono face: the bold result advances like the regular sum.
    const sum = textWidth(line + result, styleOf(fig.current));
    // The `.kv` gap between label and figure, then the slack.
    setColumn(fitIndex([label.current.offsetWidth + 12 + SUM_SLACK + sum, 0], el.clientWidth) === 1);
  }, [line, result, both]);

  // Whatever follows the last digit ("zł", or a code the locale puts after)
  // is a column of its own, so the result's digits stand under the operands'.
  const cut = result.search(/\d\D*$/) + 1;
  // One root whatever the form, so the observer above keeps watching it.
  return (
    <div ref={row} className={column ? "yourbal col" : "kv yourbal"}>
      {/* Set as the card's section heads are ("PAID BY"), since it is one. */}
      <span ref={label} className="k eyebrow">{copy.entry.yourBalance}</span>
      {column ? (
        <div className="sumcol">
          <span>{bare(up, currency)}</span><span />
          <span>− {bare(down, currency)}</span><span />
          <b ref={fig} className={`eq ${signClass(net)}`}>{result.slice(0, cut)}</b>
          <b className={`eq ${signClass(net)}`}>{result.slice(cut)}</b>
        </div>
      ) : (
        <span className="v">{line}<b ref={fig} className={signClass(net)}>{result}</b></span>
      )}
    </div>
  );
}

/** Who put the money in, and how it was shared out. Same card either way. */
function ExpenseDetail({ expense, kind, group, data }: {
  expense: Expense; kind: EntryKind; group: Group; data: GroupData;
}) {
  // Which language the bill is read in — the toggle on the who-had-what bar,
  // saved with the expense (`billLabel`).
  const english = expense.receiptEnglish === true;
  const coSponsored = isCoSponsored(expense);
  const me = data.me;
  // One span, not a fragment: a scanned row's name sits in a flex box that
  // centres its children, which would float the smaller tag off the baseline.
  // The tag goes on the name, before any detail: "Luke (you) · 2 parts".
  const yours = (id: string, name: string, detail = "") =>
    (id === me ? <span>{name}<You />{detail}</span> : `${name}${detail}`);
  // What each payer put in, in the base currency — the figure that actually
  // moves their balance, so it is the one worth showing next to their name.
  const putIn = resolvePayers(expense);
  const participants = splitParticipants(expense.split);
  const foreign = expense.currency !== group.baseCurrency;
  let shares: Record<string, number> = {};
  try {
    shares = resolveEntrySplit(expense).shares;
  } catch { /* a broken split still deserves a readable screen */ }
  // The same shares in the entry's own currency, beside the base ones as the
  // payers' are: the form showed these figures, so the saved entry does too.
  let ownShares: Record<string, number> = {};
  if (foreign) {
    try {
      ownShares = resolveSplit(expense.amountMinor, ownCurrencySplit(expense), { tiebreakSeed: expense.id }).shares;
    } catch { /* as above */ }
  }
  // A receipt expense keeps its grid (ADR-0016), so each person's row opens
  // onto their copy of the bill. Seeded with the entry's id, the seed the saved
  // weights were rounded with, so these lines are those weights itemised.
  const bill = expense.split.mode === "receipt" && expense.receiptItems?.length
    ? receiptBreakdown(
      billLabels(expense.receiptItems, english),
      (expense.receiptAssignments ?? []).map((row) => new Set(row)),
      billExtrasIn(receiptExtras(expense), english),
      new Set(expense.receiptInvolved ?? []),
      expense.currency,
      expense.id,
    ).lines
    : null;

  return (
    <div className="pad" style={{ paddingTop: 2 }}>
      <Card>
        {coSponsored ? (
          <>
            <Eyebrow style={{ marginBottom: 4 }}>
              {copy.entryKind.payer[kind] /* the head already counts them */}
            </Eyebrow>
            {payerList(expense).map((id) => {
              const m = data.memberById.get(id);
              const own = expense.payers?.[id] ?? 0;
              return (
                <KV key={id}
                  k={yours(id, m?.name ?? copy.someone)}
                  v={foreign
                    ? <TwoCurrencies base={money(putIn[id] ?? 0, group.baseCurrency)}
                      own={money(own, expense.currency)} />
                    : money(putIn[id] ?? 0, group.baseCurrency)} />
              );
            })}
            <div className="hairline" />
          </>
        ) : null /* one payer is named in the head (`EntryBy`) */}
        <Eyebrow style={{ marginBottom: 4 }}>
          {copy.entry.splitMode(copy.entryKind.split[kind],
            copy.split.mode[expense.split.mode].toLowerCase())}
        </Eyebrow>
        {/* Only the people in the split. A row per outsider saying they owe
            nothing is the longest part of a two-person expense in a big group,
            and it says what their absence already says. */}
        {/* Removed members too: a deleted entry can name somebody gone since. */}
        {[...data.memberById.values()].filter((m) => participants.includes(m.id))
          .sort((a, b) => a.name.localeCompare(b.name)).map((m) => {
          // Parts are somebody's own number and worth printing; a receipt's
          // weights are the bill's arithmetic and are shown as the bill
          // instead, line by line, under the row (`MemberBill`).
          const detail = expense.split.mode === "shares"
            ? ` · ${plural(expense.split.weights[m.id] ?? 0, copy.noun.part)}`
            : expense.split.mode === "percent"
              ? ` · ${(expense.split.bps[m.id] ?? 0) / 100}%`
              : "";
          const k = yours(m.id, m.name, detail);
          const v = foreign
            ? <TwoCurrencies base={money(shares[m.id] ?? 0, group.baseCurrency)}
              own={money(ownShares[m.id] ?? 0, expense.currency)} />
            : money(shares[m.id] ?? 0, group.baseCurrency);
          const lines = bill?.[m.id];
          if (!lines?.length) return <KV key={m.id} k={k} v={v} />;
          return <MemberBill key={m.id} name={k} total={v} lines={lines}
            format={(minor) => money(minor, expense.currency)} startOpen={m.id === me} />;
        })}
        {/* Unless you neither paid nor had a share. */}
        {me && kind !== "transfer" && ((putIn[me] ?? 0) > 0 || participants.includes(me)) ? <>
          <div className="hairline" />
          <YourBalance {...effectSum(kind, putIn[me] ?? 0, participants.includes(me) ? shares[me] ?? 0 : 0)}
            currency={group.baseCurrency} />
        </> : null}
      </Card>
    </div>
  );
}

/**
 * A base figure over the same figure in the entry's own currency. Stacked, not
 * bracketed beside it: a column of brackets read as one long line of digits.
 */
function TwoCurrencies({ base, own }: { base: string; own: string }) {
  return <span className="twoccy">{base}<span className="ownccy">{own}</span></span>;
}

/** Two people and an arrow. There is nothing else to a transfer. */
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
