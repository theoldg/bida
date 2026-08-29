"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { isCoSponsored, payerList, resolvePayers, resolveSplit, splitParticipants } from "@hajsik/core";
import { Card, Eyebrow, KV } from "../../../components/bits";
import { Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../components/chrome";
import { Icon } from "../../../components/icons";
import { deleteExpense } from "../../../lib/db/commands";
import { db } from "../../../lib/db/dexie";
import { clockTime, dayLabel, money } from "../../../lib/format";
import { route } from "../../../lib/group-link";
import { useGroupData } from "../../../lib/hooks";

export default function ExpensePage() {
  return <QueryBoundary><ExpenseScreen /></QueryBoundary>;
}

function ExpenseScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const expenseId = params.get("e") ?? undefined;
  const data = useGroupData(groupId);
  const expense = data.expenses.find((e) => e.id === expenseId);

  // "edited ×3" comes from the log itself: revisions are ops, not a counter
  // somebody has to remember to increment.
  const opCount = useLiveQuery(
    async () => (expenseId ? db().ops.where("entityId").equals(expenseId).count() : 0),
    [expenseId],
  ) ?? 0;

  if (!groupId || !data.group) return <Screen><Body><TopBar title=" " back={true} /></Body></Screen>;
  const group = data.group;

  if (!expense) {
    return (
      <Screen><Body>
        <TopBar title="Gone" back={route.group(groupId)} />
        <Empty title="This expense isn't here any more">It may have been deleted.</Empty>
      </Body></Screen>
    );
  }

  const payer = data.memberById.get(expense.paidBy);
  const coSponsored = isCoSponsored(expense);
  // What each payer put in, in the base currency — the figure that actually
  // moves their balance, so it is the one worth showing next to their name.
  const putIn = resolvePayers(expense);
  const participants = splitParticipants(expense.split);
  let shares: Record<string, number> = {};
  try {
    shares = resolveSplit(expense.baseAmountMinor, expense.split, { tiebreakSeed: expense.id }).shares;
  } catch { /* a broken split still deserves a readable screen */ }
  const foreign = expense.currency !== group.baseCurrency;
  const edits = Math.max(0, opCount - 1);
  // A finished who-had-what grid writes an ordinary `shares` spec (see
  // SplitTab in @hajsik/core) — without this check it would read as
  // "as parts", which isn't what anyone typed.
  const isReceipt = expense.splitTab === "receipt"
    || (!expense.splitTab && expense.split.mode === "shares" && (expense.receiptItems?.length ?? 0) > 0);

  async function remove() {
    if (!expense || !groupId) return;
    if (!confirm("Delete this expense? It stays in the group's history either way.")) return;
    await deleteExpense(groupId, data.me ?? expense.paidBy, expense.id);
    router.replace(route.group(groupId));
  }

  return (
    <Screen>
      <Body>
        <TopBar
          title={expense.description || "Untitled"}
          sub={`${dayLabel(expense.occurredAt)} · ${clockTime(expense.occurredAt)}`}
          back={route.group(groupId)}
          right={<>
            <Link className="iconbtn" href={route.history(groupId, expense.id)} aria-label="History">
              <Icon name="clock" size={18} />
            </Link>
            <button className="iconbtn" onClick={remove} aria-label="Delete">
              <Icon name="trash" size={18} />
            </button>
          </>}
        />

        <Scroll>
          <div className="pad" style={{ paddingTop: 2 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
              <span className="bignum" style={{ fontSize: 32 }}>
                {money(expense.baseAmountMinor, group.baseCurrency)}
              </span>
              {foreign ? (
                <span className="num" style={{ fontSize: 13, color: "var(--muted)" }}>
                  {money(expense.amountMinor, expense.currency)}
                </span>
              ) : null}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
              {foreign ? <span className="chip">@ {expense.rateToBase}</span> : null}
              {edits > 0 ? (
                <Link href={route.history(groupId, expense.id)} className="chip">
                  <Icon name="clock" size={11} /> edited ×{edits}
                </Link>
              ) : null}
            </div>
          </div>

          <div className="pad" style={{ paddingTop: 2 }}>
            <Card>
              {coSponsored ? (
                <>
                  <Eyebrow style={{ marginBottom: 4 }}>Paid by · {payerList(expense).length} people</Eyebrow>
                  {payerList(expense).map((id) => {
                    const m = data.memberById.get(id);
                    const own = expense.payers?.[id] ?? 0;
                    return (
                      <KV key={id}
                        k={m?.name ?? "Someone"}
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
                <KV k="Paid by" v={<span style={{ fontFamily: "var(--f-body)", fontWeight: 600 }}>
                  {payer?.name ?? "Someone"}
                </span>} />
              )}
              <div className="hairline" />
              <Eyebrow style={{ marginBottom: 4 }}>
                Split · {isReceipt ? "from receipt"
                  : expense.split.mode === "equal" ? "evenly"
                  : expense.split.mode === "exact" ? "as amounts"
                  : expense.split.mode === "shares" ? "as parts" : "by percent"}
              </Eyebrow>
              {data.members.map((m) => {
                const inIt = participants.includes(m.id);
                const weight = expense.split.mode === "shares" ? expense.split.weights[m.id] ?? 0 : 0;
                const detail = expense.split.mode === "shares" && !isReceipt && inIt
                  ? ` · ${weight} part${weight === 1 ? "" : "s"}`
                  : expense.split.mode === "percent" && inIt
                    ? ` · ${(expense.split.bps[m.id] ?? 0) / 100}%`
                    : "";
                return (
                  <KV key={m.id} dim={!inIt}
                    k={`${m.name}${inIt ? detail : " · not involved"}`}
                    v={inIt ? money(shares[m.id] ?? 0, group.baseCurrency) : "—"} />
                );
              })}
            </Card>
          </div>

          <div className="pad" style={{ paddingTop: 4 }}>
            <Link href={route.editExpense(groupId, expense.id)} className="btn btn-s">Edit</Link>
          </div>
          <div style={{ height: 24 }} />
        </Scroll>
      </Body>
    </Screen>
  );
}
