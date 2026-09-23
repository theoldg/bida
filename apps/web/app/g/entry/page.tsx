"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  isCoSponsored, payerList, receiptExtras, resolvePayers, resolveSplit, splitParticipants,
  type Expense, type Group, type Settlement,
} from "@bida/core";
import { Card, Eyebrow, KV } from "@/components/bits";
import { FitTitle } from "@/components/fit-line";
import { MemberBill } from "@/components/member-bill";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "@/components/chrome";
import { ConfirmDialog } from "@/components/dialog";
import { Icon } from "@/components/icons";
import { deleteExpense, deleteSettlement } from "@/lib/db/commands";
import { db } from "@/lib/db/dexie";
import { syncGroup } from "@/lib/db/sync";
import { useLive } from "@/lib/db/live";
import { kindOf, type EntryKind } from "@/lib/entry-kind";
import { copy } from "@/lib/copy";
import { money, plural, rateText, whenLabel } from "@/lib/format";
import { billExtrasIn, billLabels, receiptBreakdown } from "@/lib/scan/items";
import { entryParent, parseEntrySource, route } from "@/lib/group-link";
import { useBillEnglish, useClaimGate, useGroupData, type GroupData } from "@/lib/hooks";

/**
 * The title's type sizes, largest first, ending at the size it wraps at: a
 * one-word title is a heading, a sentence a paragraph. All below the amount's
 * 32px — the money leads.
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
 * still missing or tombstoned after that is gone; so is one a failed sync
 * didn't bring, since nothing more comes until the next.
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
  const expense = data.expenses.find((e) => e.id === entryId);
  const settlement = expense ? undefined : data.settlements.find((s) => s.id === entryId);
  const [asking, setAsking] = useState(false);
  const arriving = useArriving(groupId, entryId, !!(expense ?? settlement));

  // "edited ×3" comes from the log itself: revisions are ops, not a counter
  // somebody has to remember to increment.
  const opCount = useLive(
    "entryOpCount",
    async () => (entryId ? db().ops.where("entityId").equals(entryId).count() : 0),
    [entryId],
  ) ?? 0;

  if (!groupId) return <BadLink />;
  if (data.loading || unclaimed) return <Blank back={parent} />;
  if (!data.group) return <BadLink />;
  const group = data.group;
  const entry = expense ?? settlement;

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
  const edits = Math.max(0, opCount - 1);
  const foreign = entry.currency !== group.baseCurrency;
  async function remove() {
    const actor = data.me;
    if (!groupId || !entry || !actor) return;
    if (expense) await deleteExpense(groupId, actor, expense.id);
    else await deleteSettlement(groupId, actor, entry.id);
    router.replace(route.group(groupId));
  }

  return (
    <Screen>
      <Body>
        {/* The bar holds the kind and the date — two bounded strings, so it is
            the same height everywhere. The title, of unknown length, is below
            (`.entrytitle`). */}
        <TopBar
          title={copy.entryKind.label[kind]}
          sub={whenLabel(entry)}
          back={parent}
          right={<>
            <Link className="iconbtn" href={route.history(groupId, entry.id, via)} aria-label={copy.entry.history}>
              <Icon name="clock" size={18} />
            </Link>
            <button className="iconbtn" onClick={() => setAsking(true)} aria-label={copy.act.delete}>
              <Icon name="trash" size={18} />
            </button>
          </>}
        />

        <Scroll>
          <div className="pad" style={{ paddingTop: 2 }}>
            {/* Nothing when there is no title: the bar already says "Expense". A
                transfer has none — its words are the note. */}
            {title ? (
              <FitTitle className="entrytitle selectable" text={title} sizes={ENTRY_TITLE_SIZES} />
            ) : null}
            <div className="entryfig">
              <span className="bignum">{money(entry.baseAmountMinor, group.baseCurrency)}</span>
              {foreign ? (
                <span className="num">{money(entry.amountMinor, entry.currency)}</span>
              ) : null}
            </div>
            <div className="entrychips">
              {foreign ? <span className="chip">{copy.entry.rate(rateText(entry.rateToBase))}</span> : null}
              {edits > 0 ? (
                <Link href={route.history(groupId, entry.id, via)} className="chip">
                  <Icon name="clock" size={11} /> {copy.entry.editedTimes(edits)}
                </Link>
              ) : null}
            </div>
          </div>

          {expense
            ? <ExpenseDetail expense={expense} kind={kind} group={group} data={data} />
            : <TransferDetail settlement={settlement!} data={data} />}

          <div className="pad" style={{ paddingTop: 4 }}>
            <Link href={route.editEntry(groupId, entry.id, via)} className="btn btn-s">{copy.act.edit}</Link>
          </div>
          <div style={{ height: 24 }} />
        </Scroll>
      </Body>

      {asking ? (
        <ConfirmDialog title={copy.entry.deleteTitle(copy.entryKind.label[kind].toLowerCase())}
          confirm={copy.act.delete}
          danger={true} onConfirm={remove} onClose={() => setAsking(false)}>
          <p>{copy.entry.deleteBody}</p>
        </ConfirmDialog>
      ) : null}
    </Screen>
  );
}

/** Who put the money in, and how it was shared out. Same card either way. */
function ExpenseDetail({ expense, kind, group, data }: {
  expense: Expense; kind: EntryKind; group: Group; data: GroupData;
}) {
  // Which language this phone reads a scanned bill in — the toggle on the
  // who-had-what bar, which the expense's own copy of the bill obeys too
  // (`billLabel`).
  const english = useBillEnglish();
  const payer = data.memberById.get(expense.paidBy);
  const coSponsored = isCoSponsored(expense);
  // What each payer put in, in the base currency — the figure that actually
  // moves their balance, so it is the one worth showing next to their name.
  const putIn = resolvePayers(expense);
  const participants = splitParticipants(expense.split);
  const foreign = expense.currency !== group.baseCurrency;
  let shares: Record<string, number> = {};
  try {
    shares = resolveSplit(expense.baseAmountMinor, expense.split, { tiebreakSeed: expense.id }).shares;
  } catch { /* a broken split still deserves a readable screen */ }
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
              {copy.entry.payerCount(copy.entryKind.payer[kind],
                plural(payerList(expense).length, copy.noun.person))}
            </Eyebrow>
            {payerList(expense).map((id) => {
              const m = data.memberById.get(id);
              const own = expense.payers?.[id] ?? 0;
              return (
                <KV key={id}
                  k={m?.name ?? copy.someone}
                  v={<>
                    {money(putIn[id] ?? 0, group.baseCurrency)}
                    {foreign ? <span style={{ color: "var(--muted)" }}>
                      {" "}({money(own, expense.currency)})
                    </span> : null}
                  </>} />
              );
            })}
          </>
        ) : (
          <KV k={copy.entryKind.payer[kind]} v={<span style={{ fontFamily: "var(--f-body)", fontWeight: 600 }}>
            {payer?.name ?? copy.someone}
          </span>} />
        )}
        <div className="hairline" />
        <Eyebrow style={{ marginBottom: 4 }}>
          {copy.entry.splitMode(copy.entryKind.split[kind],
            copy.split.mode[expense.split.mode].toLowerCase())}
        </Eyebrow>
        {/* Only the people in the split. A row per outsider saying they owe
            nothing is the longest part of a two-person expense in a big group,
            and it says what their absence already says. */}
        {data.members.filter((m) => participants.includes(m.id)).map((m) => {
          // Parts are somebody's own number and worth printing; a receipt's
          // weights are the bill's arithmetic and are shown as the bill
          // instead, line by line, under the row (`MemberBill`).
          const detail = expense.split.mode === "shares"
            ? ` · ${plural(expense.split.weights[m.id] ?? 0, copy.noun.part)}`
            : expense.split.mode === "percent"
              ? ` · ${(expense.split.bps[m.id] ?? 0) / 100}%`
              : "";
          const k = `${m.name}${detail}`;
          const v = money(shares[m.id] ?? 0, group.baseCurrency);
          const lines = bill?.[m.id];
          if (!lines?.length) return <KV key={m.id} k={k} v={v} />;
          return <MemberBill key={m.id} name={k} total={v} lines={lines}
            format={(minor) => money(minor, expense.currency)} startOpen={m.id === data.me} />;
        })}
      </Card>
    </div>
  );
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
