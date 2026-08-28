"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  convertMinor, isValidRate, parseMinor, validatePayers, validateSplit,
} from "@hajsik/core";
import { Avatar, Card, Chip } from "../../../../components/bits";
import { AmountInput } from "../../../../components/amount-input";
import { SplitEditor } from "../../../../components/split-editor";
import { Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../../components/chrome";
import { Icon } from "../../../../components/icons";
import { COMMON_CURRENCIES, normalizeCurrencyCode, OTHER_CURRENCY } from "../../../../lib/currencies";
import { addExpense, editExpense } from "../../../../lib/db/commands";
import { bare, dateInputValue, money, withDate } from "../../../../lib/format";
import { route } from "../../../../lib/group-link";
import { useGroupData, useGroupSecret } from "../../../../lib/hooks";
import { normalizeScan, scanReceipt } from "../../../../lib/scan";
import { blankDraft, clearDraft, getDraft, saveDraft, useDraft, type ExpenseDraft, type SplitTab } from "../../../../lib/draft";

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
  const secret = useGroupSecret(groupId);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "error">("idle");
  const [scanSource, setScanSource] = useState<"camera" | "library" | null>(null);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>, source: "camera" | "library") {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !groupId || !secret) return;
    const current = getDraft(groupId);
    if (!current) return;
    setScanState("scanning");
    setScanSource(source);
    try {
      const result = await scanReceipt(file, groupId, secret, []);
      const patch = normalizeScan(result);
      const receiptItems = result.lineItems.map((li) => ({ label: li.labelEn ?? li.label, amount: li.amount }));
      saveDraft(groupId, {
        ...current,
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.amountText !== undefined ? { amountText: patch.amountText } : {}),
        ...(patch.currency !== undefined
          ? { currency: patch.currency, rateToBase: patch.currency === data.group?.baseCurrency ? "1" : current.rateToBase }
          : {}),
        ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
        receiptItems: receiptItems.length > 0 ? receiptItems : null,
        receiptTip: result.tip,
        // A fresh scan replaces whatever grid was saved before.
        receiptInvolved: null,
        receiptAssignments: null,
        splitTab: "receipt",
      });
      setScanState("idle");
      if (receiptItems.length > 0) router.push(route.items(groupId));
    } catch {
      setScanState("error");
    }
  }

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
        payers: e.payers ?? null,
        split: e.split,
        occurredAt: e.occurredAt,
        categoryId: e.categoryId ?? null,
        receiptItems: e.receiptItems ?? null,
        receiptTip: e.receiptTip ?? null,
        receiptInvolved: e.receiptInvolved ?? null,
        receiptAssignments: e.receiptAssignments ?? null,
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

  let amountMinor = 0;
  try { amountMinor = draft.amountText ? parseMinor(draft.amountText, draft.currency) : 0; } catch { /* mid-type */ }

  const foreign = draft.currency !== base;
  const rateOk = !foreign || isValidRate(draft.rateToBase);
  const baseMinor = !foreign ? amountMinor
    : rateOk ? convertMinor(amountMinor, draft.currency, base, draft.rateToBase) : 0;

  // The split editor is inline below and shows its own arithmetic; the form
  // only needs to know whether what it currently says can be saved.
  const splitOk = validateSplit(baseMinor, draft.split, { tiebreakSeed: draft.expenseId ?? "new" }).ok;

  // Payers are checked against the amount in the expense's own currency: that
  // is the number people typed and the number they'd check against a receipt.
  const payerCheck = validatePayers(amountMinor, draft.payers);
  const coPayers = Object.entries(draft.payers ?? {}).filter(([, v]) => v > 0);

  const ready = amountMinor > 0 && rateOk && splitOk && payerCheck.ok
    && draft.description.trim().length > 0;

  // Undefined (an old draft, or an expense saved before this field existed)
  // derives from what's actually on it: a scanned bill means "Receipt",
  // otherwise whatever arithmetic mode the split already is.
  const activeTab: SplitTab = draft.splitTab
    ?? (draft.receiptItems && draft.receiptItems.length > 0 ? "receipt"
      : draft.split.mode === "percent" ? "shares" : draft.split.mode);

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
      payers: draft!.payers,
      split: draft!.split,
      categoryId: draft!.categoryId,
      receiptItems: draft!.receiptItems ?? null,
      receiptTip: draft!.receiptTip ?? null,
      receiptInvolved: draft!.receiptInvolved ?? null,
      receiptAssignments: draft!.receiptAssignments ?? null,
    };
    if (draft!.expenseId) await editExpense(groupId, actor, draft!.expenseId, input);
    else await addExpense(groupId, actor, input);
    clearDraft(groupId);
    router.replace(route.group(groupId));
  }

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
          <input ref={cameraInput} type="file" accept="image/*" capture="environment"
            style={{ display: "none" }} onChange={(e) => onPhoto(e, "camera")} aria-label="Take a photo of a receipt" />
          <input ref={libraryInput} type="file" accept="image/*"
            style={{ display: "none" }} onChange={(e) => onPhoto(e, "library")} aria-label="Upload a receipt photo" />

          <div className="pad" style={{ textAlign: "center", paddingTop: 16, paddingBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              <AmountInput
                className="amount"
                fieldClassName="big"
                aria-label={`Amount in ${draft.currency}`}
                enterKeyHint="done"
                autoFocus={!draft.expenseId}
                placeholder="0"
                currency={draft.currency}
                value={draft.amountText}
                onChange={(amountText) => patch({ amountText })}
                autoSize={true}
              />
              <span className="chip" style={{ alignSelf: "center", marginLeft: 3, position: "relative" }}>
                {draft.currency} <Icon name="chev" size={10} />
                <select
                  aria-label="Currency"
                  value={draft.currency}
                  onChange={(e) => {
                    if (e.target.value === OTHER_CURRENCY) {
                      const typed = normalizeCurrencyCode(window.prompt("Currency code (e.g. UZS)") ?? "");
                      if (typed.length !== 3) return;
                      patch({ currency: typed, rateToBase: typed === base ? "1" : draft.rateToBase });
                      return;
                    }
                    patch({
                      currency: e.target.value,
                      rateToBase: e.target.value === base ? "1" : draft.rateToBase,
                    });
                  }}
                  style={{ position: "absolute", inset: 0, opacity: 0 }}
                >
                  {[...new Set([base, draft.currency, ...COMMON_CURRENCIES])].map((c) =>
                    <option key={c} value={c}>{c}</option>)}
                  <option value={OTHER_CURRENCY}>Other…</option>
                </select>
              </span>
            </div>

            {foreign ? (
              <>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 5, fontFamily: "var(--f-mono)" }}>
                  = {rateOk ? money(baseMinor, base) : "—"} · 1 {draft.currency} =
                  <span className={`amountfield${rateOk ? "" : " bad"}`} style={{ marginLeft: 4 }}>
                    <input
                      className="rateinput"
                      aria-label={`Rate, ${draft.currency} to ${base}`}
                      value={draft.rateToBase}
                      inputMode="decimal"
                      onChange={(e) => patch({ rateToBase: e.target.value })}
                    />
                  </span> {base}
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
              <input id="what" value={draft.description} placeholder="Title"
                onChange={(e) => patch({ description: e.target.value })} />
            </div>

            {coPayers.length > 1 ? (
              <Card style={{ padding: "10px 12px" }}>
                <Link href={route.payers(groupId)} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, color: "var(--muted)", width: 62 }}>Paid by</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {coPayers.length} people
                  </span>
                  <Icon name="chev" size={14} className="spacer" style={{ color: "var(--muted)" }} />
                </Link>
                <div className="hairline" />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {coPayers.map(([id, amount]) => (
                    <Chip key={id} variant={id === data.me ? "hl" : undefined}>
                      {(data.memberById.get(id)?.name ?? "?").split(" ")[0]} {money(amount, draft.currency)}
                    </Chip>
                  ))}
                </div>
                {!payerCheck.ok ? (
                  <div style={{ fontSize: 11.5, color: "var(--debit)", marginTop: 7, fontWeight: 600 }}>
                    {payerCheck.message}
                  </div>
                ) : null}
              </Card>
            ) : (
              <div className="field">
                <label htmlFor="paidby">Paid by</label>
                <Avatar member={data.memberById.get(draft.paidBy)} size={24} />
                <select id="paidby" value={draft.paidBy}
                  onChange={(e) => patch({ paidBy: e.target.value, payers: null })}>
                  {data.members.map((m) =>
                    <option key={m.id} value={m.id}>{m.id === data.me ? "You" : m.name}</option>)}
                </select>
                <Link href={route.payers(groupId)} className="chip" aria-label="Several people paid">
                  + someone
                </Link>
              </div>
            )}

            <SplitEditor
              members={data.members}
              me={data.me}
              totalMinor={baseMinor}
              currency={base}
              spec={draft.split}
              seed={draft.expenseId ?? "new"}
              onChange={(split) => patch({ split })}
              tab={activeTab}
              onTabChange={(splitTab) => patch({ splitTab })}
              receipt={{
                items: draft.receiptItems ?? null,
                canScan: !draft.expenseId,
                scanDisabled: !secret,
                scanState,
                scanSource,
                onScanCamera: () => cameraInput.current?.click(),
                onScanLibrary: () => libraryInput.current?.click(),
                editItemsHref: route.items(groupId),
              }}
            />

            <div className="field">
              <label htmlFor="when">When</label>
              <input id="when" type="date" value={dateInputValue(draft.occurredAt)}
                onChange={(e) => patch({ occurredAt: withDate(draft.occurredAt, e.target.value) })} />
            </div>
          </div>
          <div style={{ height: 12 }} />
        </Scroll>
      </Body>

    </Screen>
  );
}
