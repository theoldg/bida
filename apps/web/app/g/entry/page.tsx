"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  isCoSponsored, payerList, resolvePayers, resolveSplit, splitParticipants,
  type Expense, type Group, type Settlement,
} from "@hajsik/core";
import { Card, Eyebrow, KV } from "../../../components/bits";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { ConfirmDialog } from "../../../components/dialog";
import { Icon } from "../../../components/icons";
import { deleteExpense, deleteSettlement } from "../../../lib/db/commands";
import { db } from "../../../lib/db/dexie";
import { kindOf, type EntryKind } from "../../../lib/entry-kind";
import { copy } from "../../../lib/copy";
import { clockTime, dayLabel, money, plural } from "../../../lib/format";
import { route } from "../../../lib/group-link";
import { useGroupData, type GroupData } from "../../../lib/hooks";

/**
 * One entry, whichever of the three it is. The id in the query string is
 * looked up in both tables — expense ids and settlement ids are both random
 * and can't collide — so every row in the ledger has a screen, and a transfer
 * is no longer the one thing you could add and never open again (ADR-0010).
 */
export default function EntryPage() {
  return <QueryBoundary><EntryScreen /></QueryBoundary>;
}

function EntryScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const entryId = params.get("e") ?? undefined;
  const data = useGroupData(groupId);
  const expense = data.expenses.find((e) => e.id === entryId);
  const settlement = expense ? undefined : data.settlements.find((s) => s.id === entryId);
  const [asking, setAsking] = useState(false);

  // "edited ×3" comes from the log itself: revisions are ops, not a counter
  // somebody has to remember to increment.
  const opCount = useLiveQuery(
    async () => (entryId ? db().ops.where("entityId").equals(entryId).count() : 0),
    [entryId],
  ) ?? 0;

  if (!groupId) return <BadLink />;
  if (data.loading) return <Blank back={route.group(groupId)} />;
  if (!data.group) return <BadLink />;
  const group = data.group;
  const entry = expense ?? settlement;

  if (!entry) {
    return (
      <Screen><Body>
        <TopBar title={copy.entry.gone.title} back={route.group(groupId)} />
        <Empty title={copy.entry.gone.body}>{copy.entry.gone.why}</Empty>
      </Body></Screen>
    );
  }

  const kind: EntryKind = expense ? kindOf(expense) : "transfer";
  const edits = Math.max(0, opCount - 1);
  const foreign = entry.currency !== group.baseCurrency;
  async function remove() {
    if (!groupId || !entry) return;
    const actor = data.me ?? (expense ? expense.paidBy : settlement!.fromMember);
    if (expense) await deleteExpense(groupId, actor, expense.id);
    else await deleteSettlement(groupId, actor, entry.id);
    router.replace(route.group(groupId));
  }

  return (
    <Screen>
      <Body>
        <TopBar
          title={expense ? (expense.description || copy.group.untitled) : copy.group.transfer}
          sub={`${dayLabel(entry.occurredAt)} · ${clockTime(entry.occurredAt)}`}
          back={route.group(groupId)}
          right={<>
            <Link className="iconbtn" href={route.history(groupId, entry.id)} aria-label={copy.entry.history}>
              <Icon name="clock" size={18} />
            </Link>
            <button className="iconbtn" onClick={() => setAsking(true)} aria-label={copy.act.delete}>
              <Icon name="trash" size={18} />
            </button>
          </>}
        />

        <Scroll>
          <div className="pad" style={{ paddingTop: 2 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
              <span className="bignum" style={{ fontSize: 32 }}>
                {money(entry.baseAmountMinor, group.baseCurrency)}
              </span>
              {foreign ? (
                <span className="num" style={{ fontSize: 13, color: "var(--muted)" }}>
                  {money(entry.amountMinor, entry.currency)}
                </span>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
              {/* Expenses are the default and say nothing; the two that run
                  differently name themselves once, here. */}
              {kind !== "expense" ? <span className="chip hl">{copy.entryKind.label[kind]}</span> : null}
              {foreign ? <span className="chip">{copy.entry.rate(entry.rateToBase)}</span> : null}
              {edits > 0 ? (
                <Link href={route.history(groupId, entry.id)} className="chip">
                  <Icon name="clock" size={11} /> {copy.entry.editedTimes(edits)}
                </Link>
              ) : null}
            </div>
          </div>

          {expense
            ? <ExpenseDetail expense={expense} kind={kind} group={group} data={data} />
            : <TransferDetail settlement={settlement!} data={data} />}

          <div className="pad" style={{ paddingTop: 4 }}>
            <Link href={route.editEntry(groupId, entry.id)} className="btn btn-s">{copy.act.edit}</Link>
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
  // A finished who-had-what grid writes an ordinary `shares` spec (see
  // SplitTab in @hajsik/core) — without this check it would read as
  // "as parts", which isn't what anyone typed.
  //
  // The items are what make it a receipt, not the tab: `splitTab` records
  // which tab was open, and opening Receipt and saving without scanning
  // anything stores "receipt" over an ordinary even split. This screen called
  // that "from receipt" while the ledger row next to it said "split 2 ways".
  // The form draws the same distinction, as `onReceiptTab`.
  const isReceipt = (expense.receiptItems?.length ?? 0) > 0
    && (expense.splitTab === "receipt"
      || (!expense.splitTab && expense.split.mode === "shares"));

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
            isReceipt ? copy.entry.fromReceipt : copy.split.mode[expense.split.mode].toLowerCase())}
        </Eyebrow>
        {data.members.map((m) => {
          const inIt = participants.includes(m.id);
          const weight = expense.split.mode === "shares" ? expense.split.weights[m.id] ?? 0 : 0;
          const detail = expense.split.mode === "shares" && !isReceipt && inIt
            ? ` · ${plural(weight, copy.noun.part)}`
            : expense.split.mode === "percent" && inIt
              ? ` · ${(expense.split.bps[m.id] ?? 0) / 100}%`
              : "";
          return (
            <KV key={m.id} dim={!inIt}
              k={`${m.name}${inIt ? detail : ` · ${copy.entry.notInvolved}`}`}
              v={inIt ? money(shares[m.id] ?? 0, group.baseCurrency) : copy.none} />
          );
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
