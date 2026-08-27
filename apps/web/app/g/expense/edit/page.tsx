"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  convertMinor, exponentOf, isValidRate, parseMinor, resolveSplit, splitParticipants,
} from "@hajsik/core";
import { Avatar, Card, Chip } from "../../../../components/bits";
import { Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../../components/chrome";
import { Icon } from "../../../../components/icons";
import { COMMON_CURRENCIES } from "../../../../lib/currencies";
import { addExpense, editExpense } from "../../../../lib/db/commands";
import { bare, dateInputValue, money, withDate } from "../../../../lib/format";
import { route } from "../../../../lib/group-link";
import { useGroupData } from "../../../../lib/hooks";
import { blankDraft, clearDraft, getDraft, saveDraft, useDraft, type ExpenseDraft } from "../../../../lib/draft";

export default function EditExpensePage() {
  return <QueryBoundary><EditExpenseScreen /></QueryBoundary>;
}

function EditExpenseScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const expenseId = params.get("e") ?? undefined;

  const data = useGroupData(groupId);
  const draft = useDraft(groupId);

  // Seed the draft once the group is loaded: from the expense being edited, or
  // blank with everyone included and the phone's owner paying.
  useEffect(() => {
    if (!groupId || data.loading || !data.group) return;
    const existing = getDraft(groupId);
    if (existing && existing.expenseId === expenseId) return;
    if (expenseId) {
      const e = data.expenses.find((x) => x.id === expenseId);
      if (!e) return;
      saveDraft(groupId, {
        expenseId,
        amountText: bare(e.amountMinor, e.currency),
        currency: e.currency,
        rateToBase: e.rateToBase,
        description: e.description,
        paidBy: e.paidBy,
        split: e.split,
        occurredAt: e.occurredAt,
        categoryId: e.categoryId ?? null,
      });
    } else {
      const me = data.me ?? data.members[0]?.id;
      if (!me) return;
      saveDraft(groupId, blankDraft(me, data.group.baseCurrency, data.members.map((m) => m.id)));
    }
  }, [groupId, expenseId, data.loading, data.group, data.members, data.me, data.expenses]);

  if (!groupId || !data.group || !draft) {
    return <Screen><Body><TopBar title={expenseId ? "Edit" : "New expense"} back={true} /></Body></Screen>;
  }
  const group = data.group;
  const base = group.baseCurrency;
  const patch = (change: Partial<ExpenseDraft>) => saveDraft(groupId, { ...draft, ...change });

  const exp = exponentOf(draft.currency);
  let amountMinor = 0;
  try { amountMinor = draft.amountText ? parseMinor(draft.amountText, draft.currency) : 0; } catch { /* mid-type */ }

  const foreign = draft.currency !== base;
  const rateOk = !foreign || isValidRate(draft.rateToBase);
  const baseMinor = !foreign ? amountMinor
    : rateOk ? convertMinor(amountMinor, draft.currency, base, draft.rateToBase) : 0;

  const participants = splitParticipants(draft.split);
  let shares: Record<string, number> = {};
  let splitOk = participants.length > 0;
  try {
    shares = resolveSplit(baseMinor, draft.split, { tiebreakSeed: draft.expenseId ?? "new" }).shares;
  } catch { splitOk = false; }

  const ready = amountMinor > 0 && rateOk && splitOk && draft.description.trim().length > 0;

  function key(k: string) {
    const text = draft!.amountText;
    if (k === "back") return patch({ amountText: text.slice(0, -1) });
    if (k === ",") {
      if (exp === 0 || text.includes(".")) return;
      return patch({ amountText: (text || "0") + "." });
    }
    const [, frac = ""] = text.split(".");
    if (text.includes(".") && frac.length >= exp) return;
    if (!text.includes(".") && text.replace("-", "").length >= 12) return;
    patch({ amountText: text === "0" ? k : text + k });
  }

  async function save() {
    if (!ready || !groupId) return;
    const actor = data.me ?? draft!.paidBy;
    const input = {
      description: draft!.description.trim(),
      occurredAt: draft!.occurredAt,
      amountMinor,
      currency: draft!.currency,
      rateToBase: foreign ? draft!.rateToBase : "1",
      paidBy: draft!.paidBy,
      split: draft!.split,
      categoryId: draft!.categoryId,
    };
    if (draft!.expenseId) await editExpense(groupId, actor, draft!.expenseId, input);
    else await addExpense(groupId, actor, input);
    clearDraft(groupId);
    router.replace(route.group(groupId));
  }

  const [whole, frac] = (draft.amountText || "0").split(".");

  return (
    <Screen>
      <Body>
        <TopBar
          title={draft.expenseId ? "Edit expense" : "New expense"}
          sub={group.name}
          back={true}
          right={<button className="action" onClick={save} disabled={!ready}>Save</button>}
        />

        <Scroll>
          <div className="pad" style={{ textAlign: "center", paddingTop: 16, paddingBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 7 }}>
              <span className="bignum" style={{ fontSize: 44, letterSpacing: "-.045em" }}>{whole}</span>
              {exp > 0 ? (
                <span className="bignum" style={{ fontSize: 22, color: "var(--muted)" }}>
                  ,{(frac ?? "").padEnd(exp, "0").slice(0, exp)}
                </span>
              ) : null}
              <span className="chip" style={{ alignSelf: "center", marginLeft: 3, position: "relative" }}>
                {draft.currency} <Icon name="chev" size={10} />
                <select
                  aria-label="Currency"
                  value={draft.currency}
                  onChange={(e) => patch({
                    currency: e.target.value,
                    rateToBase: e.target.value === base ? "1" : draft.rateToBase,
                  })}
                  style={{ position: "absolute", inset: 0, opacity: 0 }}
                >
                  {[...new Set([base, draft.currency, ...COMMON_CURRENCIES])].map((c) =>
                    <option key={c} value={c}>{c}</option>)}
                </select>
              </span>
            </div>

            {foreign ? (
              <>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 5, fontFamily: "var(--f-mono)" }}>
                  = {rateOk ? money(baseMinor, base) : "—"} · 1 {draft.currency} =
                  <input
                    aria-label={`Rate, ${draft.currency} to ${base}`}
                    value={draft.rateToBase}
                    inputMode="decimal"
                    onChange={(e) => patch({ rateToBase: e.target.value })}
                    style={{
                      width: 78, marginLeft: 4, background: "transparent", border: 0,
                      borderBottom: `1px solid ${rateOk ? "var(--rule)" : "var(--debit)"}`,
                      font: "inherit", color: rateOk ? "var(--ink)" : "var(--debit)", outline: "none",
                    }}
                  /> {base}
                </div>
                <div style={{
                  fontSize: 11, color: "var(--hl-ink)", background: "var(--hl)", display: "inline-block",
                  padding: "2px 8px", borderRadius: 999, marginTop: 7,
                }}>rate is frozen at entry — edit it here</div>
              </>
            ) : null}
          </div>

          <div className="pad" style={{ paddingTop: 4, display: "flex", flexDirection: "column", gap: 9 }}>
            <div className="field">
              <label htmlFor="what">What</label>
              <input id="what" value={draft.description} placeholder="Dinner · Nomad"
                onChange={(e) => patch({ description: e.target.value })} />
            </div>

            <div className="field">
              <label htmlFor="paidby">Paid by</label>
              <Avatar member={data.memberById.get(draft.paidBy)} size={24} />
              <select id="paidby" value={draft.paidBy} onChange={(e) => patch({ paidBy: e.target.value })}>
                {data.members.map((m) =>
                  <option key={m.id} value={m.id}>{m.id === data.me ? "You" : m.name}</option>)}
              </select>
            </div>

            <Card style={{ padding: "10px 12px" }}>
              <Link href={route.split(groupId)} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--muted)", width: 62 }}>Split</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {draft.split.mode === "equal" ? "Equally" :
                   draft.split.mode === "exact" ? "Exact amounts" :
                   draft.split.mode === "shares" ? "By shares" : "By percent"}
                  {" · "}{participants.length} {participants.length === 1 ? "person" : "people"}
                </span>
                <Icon name="chev" size={14} className="spacer" style={{ color: "var(--muted)" }} />
              </Link>
              {splitOk && participants.length > 0 ? (
                <>
                  <div className="hairline" />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {participants.map((id) => (
                      <Chip key={id} variant={id === data.me ? "hl" : undefined}>
                        {(data.memberById.get(id)?.name ?? "?").split(" ")[0]} {money(shares[id] ?? 0, base)}
                      </Chip>
                    ))}
                  </div>
                </>
              ) : null}
            </Card>

            <div className="field">
              <label htmlFor="when">When</label>
              <input id="when" type="date" value={dateInputValue(draft.occurredAt)}
                onChange={(e) => patch({ occurredAt: withDate(draft.occurredAt, e.target.value) })} />
            </div>
          </div>
          <div style={{ height: 12 }} />
        </Scroll>
      </Body>

      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((k) => (
          <button key={k} className="key" onClick={() => key(k)}>{k}</button>
        ))}
        <button className="key act" onClick={() => key(",")} disabled={exp === 0}>,</button>
        <button className="key" onClick={() => key("0")}>0</button>
        <button className="key act" onClick={() => key("back")} aria-label="Delete">⌫</button>
      </div>
    </Screen>
  );
}
