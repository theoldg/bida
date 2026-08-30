"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  convertMinor, isValidRate, minorToDecimalString, parseMinor, validatePayers, validateSplit,
  type Member, type SplitSpec,
} from "@hajsik/core";
import { handOffReceiptTotal, receiptTotalMinor, weightsFromItems } from "../../../../lib/scan/items";
import { Avatar, Card, Chip } from "../../../../components/bits";
import { AmountInput } from "../../../../components/amount-input";
import { SplitEditor, type ScanSource, type ScanState } from "../../../../components/split-editor";
import { Blank, Body, QueryBoundary, Screen, Scroll, TopBar } from "../../../../components/chrome";
import { ConfirmDialog, PromptDialog } from "../../../../components/dialog";
import { Icon } from "../../../../components/icons";
import { COMMON_CURRENCIES, normalizeCurrencyCode, OTHER_CURRENCY } from "../../../../lib/currencies";
import { addExpense, editExpense, editSettlement, recordSettlement } from "../../../../lib/db/commands";
import {
  ENTRY_LABEL, ENTRY_PAYER_LABEL, ENTRY_SPLIT_LABEL, ENTRY_KINDS, kindOf, type EntryKind,
} from "../../../../lib/entry-kind";
import { dateInputValue, errorText, money, withDate } from "../../../../lib/format";
import { route } from "../../../../lib/group-link";
import { useGroupData, useGroupSecret } from "../../../../lib/hooks";
import { normalizeScan, scanReceipt, ScanRejectedError, ScanUnavailableError } from "../../../../lib/scan";
import { blankDraft, clearDraft, getDraft, isDraftDirty, saveDraft, seedDraft, useDraft, type EntryDraft, type SplitTab } from "../../../../lib/draft";

/**
 * One form for all three kinds of entry.
 *
 * Expense, income and transfer are one thought with one shape — an amount, a
 * date, some words, and who it moves between — so they are one screen with a
 * segmented control at the top rather than three routes that lose what you
 * typed when you realise you picked the wrong one (ADR-0028). Switching kinds
 * keeps the amount, the currency, the date and the description; only the
 * middle of the form is swapped.
 */
export default function EditEntryPage() {
  return <QueryBoundary><EditEntryScreen /></QueryBoundary>;
}

function EditEntryScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const groupId = params.get("id") ?? undefined;
  const entryId = params.get("e") ?? undefined;
  const wantedKind = params.get("kind") as EntryKind | null;
  // Settle-up hands a transfer its two sides and its amount, in base units.
  const prefill = {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    amount: Number(params.get("amount") ?? "0"),
  };

  const data = useGroupData(groupId);
  const draft = useDraft(groupId);
  const secret = useGroupSecret(groupId);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanSource, setScanSource] = useState<ScanSource>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "discard" | "currency">(null);
  const [failed, setFailed] = useState<string>();

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>, source: "camera" | "library") {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !groupId || !secret) return;
    const current = getDraft(groupId);
    if (!current) return;
    setScanState("scanning");
    setScanSource(source);
    setScanError(null);
    try {
      const result = await scanReceipt(file, groupId, secret, []);
      const patch = normalizeScan(result);
      const receiptItems = result.lineItems.map((li) => (
        { label: li.labelEn ?? li.label, amount: li.amount, quantity: li.quantity }
      ));
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
    } catch (err) {
      setScanState("error");
      setScanError(err instanceof ScanRejectedError || err instanceof ScanUnavailableError ? err.message : null);
    }
  }

  // Seed the draft once the group is loaded: from the entry being edited —
  // which is looked up in both tables, since one id parameter covers all three
  // kinds — or blank, in the kind the caller asked for.
  useEffect(() => {
    if (!groupId || data.loading || !data.group) return;
    const existing = getDraft(groupId);
    if (existing && existing.entryId === entryId) return;
    const me = data.me ?? data.members[0]?.id;
    if (!me) return;
    const base = data.group.baseCurrency;

    if (entryId) {
      const e = data.expenses.find((x) => x.id === entryId);
      if (e) {
        seedDraft(groupId, {
          kind: kindOf(e),
          entryId,
          // `minorToDecimalString`, never `bare`: this is the canonical text
          // `parseMinor` reads back, and `bare` groups thousands. "1,234.50"
          // fails to parse (amount silently 0) and "25,000" JPY parses as 25.
          amountText: minorToDecimalString(e.amountMinor, e.currency),
          currency: e.currency,
          rateToBase: e.rateToBase,
          description: e.description,
          paidBy: e.paidBy,
          payers: e.payers ?? null,
          split: e.split,
          fromMember: me,
          toMember: data.members.find((m) => m.id !== me)?.id ?? me,
          occurredAt: e.occurredAt,
          categoryId: e.categoryId ?? null,
          receiptItems: e.receiptItems ?? null,
          receiptTip: e.receiptTip ?? null,
          receiptInvolved: e.receiptInvolved ?? null,
          receiptAssignments: e.receiptAssignments ?? null,
          splitTab: e.splitTab ?? undefined,
        });
        return;
      }
      const s = data.settlements.find((x) => x.id === entryId);
      if (!s) return;
      seedDraft(groupId, {
        ...blankDraft("transfer", me, base, data.members.map((m) => m.id)),
        entryId,
        amountText: minorToDecimalString(s.amountMinor, s.currency),
        currency: s.currency,
        rateToBase: s.rateToBase,
        description: s.note ?? "",
        fromMember: s.fromMember,
        toMember: s.toMember,
        occurredAt: s.occurredAt,
      });
      return;
    }

    const kind: EntryKind = wantedKind && ENTRY_KINDS.includes(wantedKind) ? wantedKind : "expense";
    const blank = blankDraft(kind, me, base, data.members.map((m) => m.id));
    seedDraft(groupId, kind === "transfer" ? {
      ...blank,
      ...(prefill.from ? { fromMember: prefill.from } : {}),
      ...(prefill.to ? { toMember: prefill.to } : {}),
      // The suggestion is already in the group's base currency, so it seeds
      // the amount directly rather than going back through a rate.
      ...(Number.isFinite(prefill.amount) && prefill.amount > 0
        ? { amountText: minorToDecimalString(prefill.amount, base) } : {}),
    } : blank);
    // `prefill` is rebuilt each render; the query params behind it are what
    // actually change, and the draft is only ever seeded once per entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, entryId, wantedKind, prefill.from, prefill.to, prefill.amount,
    data.loading, data.group, data.members, data.me, data.expenses, data.settlements]);

  // Nothing is stored, so a reload or a closed tab loses what's typed. Let the
  // browser say so, the same way it does for any other half-filled form.
  useEffect(() => {
    if (!groupId) return;
    const warn = (e: BeforeUnloadEvent) => { if (isDraftDirty(groupId)) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [groupId]);

  if (!groupId || !data.group || !draft) return <Blank title={entryId ? "Edit" : "New"} />;
  const group = data.group;
  const base = group.baseCurrency;
  const kind = draft.kind;
  const transfer = kind === "transfer";

  // Merges against the latest saved draft, not the `draft` this render closed
  // over — some interactions (switching split tabs) call patch() twice in one
  // handler, and merging against a stale closure would let the first patch's
  // change be clobbered by the second.
  const patch = (change: Partial<EntryDraft>) => saveDraft(groupId, { ...(getDraft(groupId) ?? draft), ...change });

  // Undefined (an old draft, or an expense saved before this field existed)
  // derives from what's actually on it: a scanned bill means "Receipt",
  // otherwise whatever arithmetic mode the split already is.
  const activeTab: SplitTab = draft.splitTab
    ?? (draft.receiptItems && draft.receiptItems.length > 0 ? "receipt"
      : draft.split.mode === "percent" ? "shares" : draft.split.mode);

  // A bill is a thing an expense has. An income has no receipt to read a
  // total off, and a transfer has no split at all.
  const canScan = kind === "expense";
  const hasReceiptItems = (draft.receiptItems?.length ?? 0) > 0;
  const onReceiptTab = canScan && activeTab === "receipt" && hasReceiptItems;

  // Receipt's total and the split it implies are computed here, at the one
  // place either is read (this render, and save() below) — never written
  // into the draft as a cache for some other effect to notice and resync.
  // There's nothing to fall out of step because nothing is ever recorded
  // twice (ADR-0020; this replaced an effect on `receiptItems`/`receiptTip`
  // that mirrored the total into `amountText`, which had a window where a
  // screen reading the draft saw last save's total instead of this one's).
  const receiptTotal = onReceiptTab
    ? receiptTotalMinor(draft.receiptItems ?? [], draft.receiptTip ?? null, draft.currency)
    : null;
  // The amount is derived from the bill while Receipt mode is showing it —
  // typing over it would desync the total from what the items actually add
  // up to, with nothing left to reconcile the two. Edit the items or the tip
  // instead, or switch tabs to take manual control back (ADR-0021). Locked on
  // a real derived number, not merely on having items: a scan whose every
  // line is unreadable would otherwise leave the field disabled *and* empty,
  // with no way to type an amount and no way to save.
  const receiptLocksAmount = receiptTotal !== null;
  const receiptWeights = onReceiptTab
    ? weightsFromItems(
        draft.receiptItems ?? [],
        (draft.receiptAssignments ?? []).map((row) => new Set(row)),
        draft.receiptTip && draft.receiptInvolved
          ? { amount: draft.receiptTip, members: new Set(draft.receiptInvolved) } : null,
        draft.currency,
        draft.entryId ?? "new",
      )
    : {};
  // Empty until "who had what" has actually been visited (or on an old draft
  // with nothing assigned yet) — falls back to whatever the split already
  // was rather than claiming an opinion it doesn't have.
  const receiptSplit: SplitSpec | null = Object.keys(receiptWeights).length > 0
    ? { mode: "shares", weights: receiptWeights } : null;
  const effectiveSplit = receiptSplit ?? draft.split;

  // Leaving Receipt hands its derived total back to the amount field, which
  // is the only place a typed amount lives. `switchMode` in the split editor
  // already hands the *split* over via `convertSplitMode`; this is its other
  // half, and without it the amount has nowhere to go and the expense
  // silently becomes worth zero. ADR-0021.
  const changeTab = (splitTab: SplitTab) => {
    const handoff = handOffReceiptTotal(
      activeTab, splitTab, draft.receiptItems, draft.receiptTip, draft.currency,
    );
    patch({ splitTab, ...(handoff !== null ? { amountText: handoff } : {}) });
  };

  /**
   * Change which of the three this is, keeping everything the new kind can
   * still use. Leaving Receipt behind takes the same handoff as an ordinary
   * tab switch does — an income's amount would otherwise be derived from a
   * bill it no longer shows.
   */
  const changeKind = (next: EntryKind) => {
    if (next === kind) return;
    const leavingReceipt = onReceiptTab && next !== "expense";
    const handoff = leavingReceipt
      ? handOffReceiptTotal(activeTab, "equal", draft.receiptItems, draft.receiptTip, draft.currency)
      : null;
    patch({
      kind: next,
      ...(leavingReceipt ? { splitTab: "equal" as SplitTab } : {}),
      ...(handoff !== null ? { amountText: handoff } : {}),
    });
  };

  let amountMinor = 0;
  try {
    amountMinor = receiptTotal !== null ? receiptTotal
      : draft.amountText ? parseMinor(draft.amountText, draft.currency) : 0;
  } catch { /* mid-type */ }

  const foreign = draft.currency !== base;
  const rateOk = !foreign || isValidRate(draft.rateToBase);
  const baseMinor = !foreign ? amountMinor
    : rateOk ? convertMinor(amountMinor, draft.currency, base, draft.rateToBase) : 0;

  // The split editor is inline below and shows its own arithmetic; the form
  // only needs to know whether what it currently says can be saved.
  const splitOk = transfer
    || validateSplit(baseMinor, effectiveSplit, { tiebreakSeed: draft.entryId ?? "new" }).ok;

  // Payers are checked against the amount in the entry's own currency: that
  // is the number people typed and the number they'd check against a receipt.
  const payerCheck = validatePayers(amountMinor, transfer ? null : draft.payers);
  const coPayers = Object.entries(draft.payers ?? {}).filter(([, v]) => v > 0);
  const sidesOk = !transfer || (draft.fromMember !== draft.toMember
    && !!draft.fromMember && !!draft.toMember);

  const ready = amountMinor > 0 && rateOk && splitOk && payerCheck.ok && sidesOk
    // A transfer's words are a note and optional; an expense without a name is
    // a row nobody can identify a week later.
    && (transfer || draft.description.trim().length > 0);

  // Leaving throws the draft away — there is nowhere for it to be kept — so ask
  // first, but only once something has actually been typed.
  function goBack() {
    if (!groupId) return;
    if (isDraftDirty(groupId)) { setAsk("discard"); return; }
    clearDraft(groupId);
    router.back();
  }

  function discard() {
    if (!groupId) return;
    clearDraft(groupId);
    router.back();
  }

  // An arrow, not a hoisted `function`: a declaration is created before the
  // guard above runs, so TypeScript wouldn't carry "draft exists" into it and
  // every read had to assert it back.
  const save = async () => {
    if (!ready || !groupId) return;
    setFailed(undefined);
    const rate = foreign ? draft.rateToBase : "1";
    try {
      if (transfer) {
        const input = {
          fromMember: draft.fromMember,
          toMember: draft.toMember,
          amountMinor,
          currency: draft.currency,
          rateToBase: rate,
          occurredAt: draft.occurredAt,
          note: draft.description.trim() || null,
        };
        const actor = data.me ?? draft.fromMember;
        if (draft.entryId) await editSettlement(groupId, actor, draft.entryId, input);
        else await recordSettlement(groupId, actor, input);
      } else {
        const actor = data.me ?? draft.paidBy;
        const input = {
          kind,
          description: draft.description.trim(),
          occurredAt: draft.occurredAt,
          amountMinor,
          currency: draft.currency,
          rateToBase: rate,
          paidBy: draft.paidBy,
          payers: draft.payers,
          split: effectiveSplit,
          categoryId: draft.categoryId,
          // An income has no bill. Turning an expense into one clears the scan
          // rather than leaving a receipt hanging off an entry that can never
          // show it again.
          receiptItems: canScan ? draft.receiptItems ?? null : null,
          receiptTip: canScan ? draft.receiptTip ?? null : null,
          receiptInvolved: canScan ? draft.receiptInvolved ?? null : null,
          receiptAssignments: canScan ? draft.receiptAssignments ?? null : null,
          splitTab: canScan ? activeTab : null,
        };
        if (draft.entryId) await editExpense(groupId, actor, draft.entryId, input);
        else await addExpense(groupId, actor, input);
      }
      clearDraft(groupId);
      router.replace(route.group(groupId));
    } catch (err) {
      setFailed(errorText(err));
    }
  };

  /**
   * Which kinds this screen can still become. Everything, on a new entry.
   * Editing an expense keeps the one field that separates it from an income,
   * so those two stay open — but a transfer is a different entity with a
   * different shape, and turning one into the other is a delete and an add,
   * not an edit. A control that can't do anything doesn't get drawn.
   */
  const reachable: EntryKind[] = !draft.entryId ? [...ENTRY_KINDS]
    : transfer ? ["transfer"] : ["expense", "income"];

  return (
    <Screen>
      <Body>
        <TopBar
          title={draft.entryId
            ? (reachable.length > 1 ? "Edit" : `Edit ${ENTRY_LABEL[kind].toLowerCase()}`)
            : "New"}
          sub={group.name}
          back={goBack}
          right={<button className="action" onClick={save} disabled={!ready}>Save</button>}
        />

        <Scroll>
          <input ref={cameraInput} type="file" accept="image/*" capture="environment"
            style={{ display: "none" }} onChange={(e) => onPhoto(e, "camera")} aria-label="Take a photo of a receipt" />
          <input ref={libraryInput} type="file" accept="image/*"
            style={{ display: "none" }} onChange={(e) => onPhoto(e, "library")} aria-label="Upload a receipt photo" />

          {reachable.length > 1 ? (
            <div className="pad" style={{ paddingTop: 2, paddingBottom: 0 }}>
              <div className="seg" role="tablist" aria-label="What kind of entry">
                {reachable.map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={k === kind}
                    className={k === kind ? "on" : ""} onClick={() => changeKind(k)}>
                    {ENTRY_LABEL[k]}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="pad" style={{ textAlign: "center", paddingTop: 16, paddingBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              <AmountInput
                className="amount"
                fieldClassName="big"
                aria-label={`Amount in ${draft.currency}`}
                enterKeyHint="done"
                autoFocus={!draft.entryId}
                placeholder="0"
                currency={draft.currency}
                value={receiptTotal !== null
                  ? minorToDecimalString(receiptTotal, draft.currency) : draft.amountText}
                onChange={(amountText) => patch({ amountText })}
                autoSize={true}
                disabled={receiptLocksAmount}
              />
              <span className="chip" style={{ alignSelf: "center", marginLeft: 3, position: "relative" }}>
                {draft.currency} <Icon name="chev" size={10} />
                <select
                  aria-label="Currency"
                  value={draft.currency}
                  onChange={(e) => {
                    if (e.target.value === OTHER_CURRENCY) { setAsk("currency"); return; }
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

            {receiptLocksAmount ? (
              <div style={{
                fontSize: 11, color: "var(--hl-ink)", background: "var(--hl)", display: "inline-block",
                padding: "2px 7px", borderRadius: 2, marginTop: 7,
              }}>read from receipt</div>
            ) : null}

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
                  padding: "2px 7px", borderRadius: 2, marginTop: 7,
                }}>rate is frozen at entry — edit it here</div>
              </>
            ) : null}
          </div>

          <div className="pad" style={{ paddingTop: 4, display: "flex", flexDirection: "column", gap: 9 }}>
            {transfer ? (
              <TransferSides
                members={data.members}
                from={draft.fromMember}
                to={draft.toMember}
                onChange={(sides) => patch(sides)}
              />
            ) : null}

            <div className="field">
              {transfer ? null : <label htmlFor="what">What</label>}
              <input id="what" value={draft.description}
                aria-label={transfer ? "Note (optional)" : "What"}
                placeholder={transfer ? "Note (optional)" : "Title"}
                onChange={(e) => patch({ description: e.target.value })} />
            </div>

            {transfer ? null : coPayers.length > 1 ? (
              <Card style={{ padding: "10px 12px" }}>
                <Link href={route.payers(groupId)} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="fieldlabel">{ENTRY_PAYER_LABEL[kind]}</span>
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
                <label htmlFor="paidby" className="fieldlabel">{ENTRY_PAYER_LABEL[kind]}</label>
                <Avatar member={data.memberById.get(draft.paidBy)} size={24} />
                <select id="paidby" value={draft.paidBy}
                  onChange={(e) => patch({ paidBy: e.target.value, payers: null })}>
                  {data.members.map((m) =>
                    <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <Link href={route.payers(groupId)} className="chip" aria-label="Several people put money in">
                  + someone
                </Link>
              </div>
            )}

            {transfer ? null : (
              <SplitEditor
                members={data.members}
                me={data.me}
                title={ENTRY_SPLIT_LABEL[kind]}
                totalMinor={baseMinor}
                currency={base}
                spec={effectiveSplit}
                seed={draft.entryId ?? "new"}
                onChange={(split) => patch({ split })}
                tab={activeTab}
                onTabChange={changeTab}
                receipt={canScan ? {
                  items: draft.receiptItems ?? null,
                  scanDisabled: !secret,
                  scanState,
                  scanSource,
                  scanError,
                  onScanCamera: () => cameraInput.current?.click(),
                  onScanLibrary: () => libraryInput.current?.click(),
                  editItemsHref: route.items(groupId),
                } : null}
              />
            )}

            <div className="field">
              <label htmlFor="when">When</label>
              <input id="when" type="date" value={dateInputValue(draft.occurredAt)}
                onChange={(e) => patch({ occurredAt: withDate(draft.occurredAt, e.target.value) })} />
            </div>

            {failed ? <p className="failure" role="alert">Couldn&rsquo;t save — {failed}</p> : null}
          </div>
          <div style={{ height: 12 }} />
        </Scroll>
      </Body>

      {ask === "discard" ? (
        <ConfirmDialog title={`Discard this ${ENTRY_LABEL[kind].toLowerCase()}?`} confirm="Discard"
          danger={true} onConfirm={discard} onClose={() => setAsk(null)}>
          <p>What you&rsquo;ve entered isn&rsquo;t saved anywhere and won&rsquo;t be handed back.</p>
        </ConfirmDialog>
      ) : null}

      {ask === "currency" ? (
        <PromptDialog title="Currency" placeholder="UZS" confirm="Use it" maxLength={3}
          autoCapitalize="characters" hint="A three-letter ISO code."
          clean={normalizeCurrencyCode} valid={(v) => v.length === 3}
          onSubmit={(currency) => {
            patch({ currency, rateToBase: currency === base ? "1" : draft.rateToBase });
            setAsk(null);
          }}
          onClose={() => setAsk(null)} />
      ) : null}
    </Screen>
  );
}

/**
 * A transfer's two sides, and the one-tap reversal between them.
 *
 * Getting the direction the wrong way round is the mistake this form invites,
 * and it is one people make *after* picking both names — so the fix is the
 * arrow itself, which points the way the money goes and reverses it when
 * pressed, rather than two pickers you have to re-open in turn.
 */
function TransferSides({ members, from, to, onChange }: {
  members: Member[];
  from: string;
  to: string;
  onChange: (sides: { fromMember: string; toMember: string }) => void;
}) {
  const byId = new Map(members.map((m) => [m.id, m]));
  const side = (which: "from" | "to") => {
    const id = which === "from" ? from : to;
    const member = byId.get(id);
    return (
      <span className="tside">
        <Avatar member={member} size={38} />
        <span className="who">{member?.name ?? "—"}</span>
        <span className="eyebrow">{which === "from" ? "From" : "To"}</span>
        <select aria-label={which === "from" ? "Who paid" : "Who was paid"} value={id}
          onChange={(e) => onChange(which === "from"
            ? { fromMember: e.target.value, toMember: to }
            : { fromMember: from, toMember: e.target.value })}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </span>
    );
  };

  return (
    <div>
      <div className="card transfer">
        {side("from")}
        <button type="button" className="tswap" aria-label="Swap the two sides"
          onClick={() => onChange({ fromMember: to, toMember: from })}>
          <Icon name="arrow" size={18} />
        </button>
        {side("to")}
      </div>
      {from === to ? (
        <p className="failure" role="alert">
          Money has to go from one person to a different one.
        </p>
      ) : null}
    </div>
  );
}
