"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  formatRate, fromReceipt, isCurrencyCode, minorToDecimalString,
  type RateSource,
} from "@hajsik/core";
import { handOffReceiptTotal } from "../../../../lib/scan/items";
import { Card, Chip } from "../../../../components/bits";
import { AmountInput, sanitizeAmount } from "../../../../components/amount-input";
import { SplitEditor, type ScanSource, type ScanState } from "../../../../components/split-editor";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../../components/chrome";
import { ChoiceDialog, ConfirmDialog, PromptDialog } from "../../../../components/dialog";
import { RateDialog } from "../../../../components/rate-dialog";
import { Icon } from "../../../../components/icons";
import { TransferSides } from "../../../../components/transfer-sides";
import { COMMON_CURRENCIES, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "../../../../lib/currencies";
import {
  addExpense, editExpense, editSettlement, recordSettlement, setRate,
} from "../../../../lib/db/commands";
import { ENTRY_KINDS, kindOf, type EntryKind } from "../../../../lib/entry-kind";
import { copy } from "../../../../lib/copy";
import { checkEntry, needsRate } from "../../../../lib/entry-check";
import { dateInputValue, errorText, money, plural, withDate } from "../../../../lib/format";
import { route } from "../../../../lib/group-link";
import { useClaimGate, useGroupData, useGroupSecret } from "../../../../lib/hooks";
import {
  normalizeScan, scanReceipt, ScanOfflineError, ScanRejectedError, ScanUnavailableError,
  ScanUnreliableError,
} from "../../../../lib/scan";
import {
  blankDraft, clearDraft, draftSeedKey, getDraft, isDraftDirty, openSplitTab, saveDraft,
  seedDraft, splitSeed, useDraft, withSplit, type EntryDraft, type SplitTab,
} from "../../../../lib/draft";

/**
 * The typed amount and the currency it is held in must never disagree: JPY has
 * no minor units and BHD has three, and `sanitizeAmount` otherwise only runs on
 * a keystroke. Switching currency with "12.34" in the field used to leave it
 * reading "12.34" while the model saved ¥12 — no keystroke in between, and
 * nothing on screen saying so. Every write to the draft goes through this.
 */
function clipAmountToCurrency(draft: EntryDraft): EntryDraft {
  const amountText = sanitizeAmount(draft.amountText, draft.currency);
  return amountText === draft.amountText ? draft : { ...draft, amountText };
}

/**
 * One form for all three kinds of entry.
 *
 * Expense, income and transfer are one thought with one shape — an amount, a
 * date, some words, and who it moves between — so they are one screen with a
 * segmented control at the top rather than three routes that lose what you
 * typed when you realise you picked the wrong one (ADR-0010). Switching kinds
 * keeps the amount, the currency, the date and the description; only the
 * middle of the form is swapped.
 */
export default function EditEntryPage() {
  return <QueryBoundary><EditEntryScreen /></QueryBoundary>;
}

/**
 * Why the scan failed, in words. Only the model's own refusal is quoted —
 * everything else is the phone's condition or the app's own arithmetic, and
 * the app says those in its voice.
 */
function scanErrorText(err: unknown): string | null {
  if (err instanceof ScanOfflineError) return copy.scan.offline;
  if (err instanceof ScanUnavailableError) return copy.scan.busy;
  if (err instanceof ScanRejectedError) return err.message;
  if (err instanceof ScanUnreliableError) return copy.scan.problem[err.problem];
  return null;
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
  const unclaimed = useClaimGate(groupId, data);
  const draft = useDraft(groupId);
  const secret = useGroupSecret(groupId);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [scanSource, setScanSource] = useState<ScanSource>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [ask, setAsk] = useState<null | "discard" | "currency" | "currency-other" | "payer">(null);
  /** Which currency's rate is being set, if any. See `pickCurrency`. */
  const [askRate, setAskRate] = useState<string | null>(null);
  /**
   * Set when a scan owes the who-had-what grid a visit but the rate dialog is
   * standing in front of it. The two used to fire together, and the push won:
   * a receipt in a currency the group had never seen opened the dialog and
   * navigated straight over it, so the rate was never set and the grid it
   * jumped to priced a bill nobody had told the group the worth of. They
   * happen one after the other now — dialog first, grid when it closes,
   * saved or cancelled.
   */
  const [itemsAfterRate, setItemsAfterRate] = useState(false);
  const [failed, setFailed] = useState<string>();
  /**
   * A save in flight. Two taps on Save land before `router.replace` does, and
   * both passed `ready` — which is a question about the form, not about
   * whether one press is already spending it. That wrote a transfer twice,
   * for twice the money, and gave an expense a second create op saying
   * nothing. Every other button in the app that writes already holds this
   * (`ConfirmDialog`, `RateDialog`, `NameAdder`, `WhoPicker`); this one
   * didn't. Cleared only on failure — a save that worked is navigating away,
   * and the press that lands during that must still find the button spent.
   */
  const [saving, setSaving] = useState(false);

  // A scan can outlive the screen that started it — it is a network round
  // trip to a model, and people put the phone down. The draft still takes the
  // result (that is the point of scanning), but nothing yanks you back here.
  const onScreen = useRef(true);
  useEffect(() => () => { onScreen.current = false; }, []);

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
      const result = await scanReceipt(file, groupId, secret, current.currency);
      const patch = normalizeScan(result);
      const receiptItems = result.lineItems.map((li) => (
        { label: li.labelEn ?? li.label, amount: li.amount, quantity: li.quantity }
      ));
      // A photographed Moroccan receipt used to arrive looking complete and
      // wrong: it wrote MAD and kept whatever rate the draft had. Now it asks,
      // the same as picking the currency by hand would.
      const wantsRate = patch.currency !== undefined && needsRate(data.rates, data.group?.baseCurrency, patch.currency)
        ? patch.currency : null;
      if (wantsRate !== null) setAskRate(wantsRate);
      // The merchant is a guess, and a title somebody typed is not. Take it
      // only into an empty field or over the *previous* scan's guess, so a
      // rescan can correct itself without renaming the expense you named.
      const keepsTyped = current.description.trim().length > 0
        && current.description !== current.scannedDescription;
      saveDraft(groupId, clipAmountToCurrency({
        ...current,
        ...(patch.description !== undefined && !keepsTyped
          ? { description: patch.description, scannedDescription: patch.description }
          : {}),
        ...(patch.amountText !== undefined ? { amountText: patch.amountText } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.occurredAt !== undefined ? { occurredAt: patch.occurredAt } : {}),
        receiptItems: receiptItems.length > 0 ? receiptItems : null,
        receiptTip: result.tip,
        // A fresh scan replaces whatever grid was saved before.
        receiptInvolved: null,
        receiptAssignments: null,
        splitTab: "receipt",
      }));
      setScanState("idle");
      const toItems = receiptItems.length > 0 && onScreen.current;
      if (wantsRate !== null) setItemsAfterRate(toItems);
      else if (toItems) router.push(route.items(groupId));
    } catch (err) {
      setScanState("error");
      setScanError(scanErrorText(err));
    }
  }

  // What this screen was opened *on*: an entry's id, or — creating — everything
  // the link asked for. Coming back from the payers editor or the who-had-what
  // grid re-mounts the form with the same key, so the draft survives; arriving
  // from a different link doesn't, so a leftover draft is replaced rather than
  // handed over (settle up used to land on whatever blank expense was left
  // behind by an abandoned "+").
  const seedKey = entryId
    ?? `new:${wantedKind ?? "expense"}:${prefill.from ?? ""}:${prefill.to ?? ""}:${prefill.amount || 0}`;

  // Seed the draft once the group is loaded: from the entry being edited —
  // which is looked up in both tables, since one id parameter covers all three
  // kinds — or blank, in the kind the caller asked for.
  useEffect(() => {
    if (!groupId || data.loading || !data.group) return;
    if (draftSeedKey(groupId) === seedKey) return;
    const me = data.me ?? data.members[0]?.id;
    if (!me) return;
    const base = data.group.baseCurrency;

    if (entryId) {
      const e = data.expenses.find((x) => x.id === entryId);
      if (e) {
        seedDraft(groupId, {
          ...blankDraft(kindOf(e), me, base, data.members.map((m) => m.id)),
          entryId,
          // `minorToDecimalString`, never `bare`: this is the canonical text
          // `parseMinor` reads back, and `bare` groups thousands. "1,234.50"
          // fails to parse (amount silently 0) and "25,000" JPY parses as 25.
          amountText: minorToDecimalString(e.amountMinor, e.currency),
          currency: e.currency,
          description: e.description,
          paidBy: e.paidBy,
          payers: e.payers ?? null,
          // A receipt expense stores the grid's own arithmetic as `shares`,
          // and seeding the tabs from it put those weights under As parts —
          // a screen the scan never touched. Its tabs start where a fresh
          // entry's do (`blankDraft` above): even, over everyone. The bill
          // itself is reopened from the receipt fields below, and Receipt
          // recomputes its split from them (ADR-0016).
          ...(fromReceipt(e) ? {} : { splits: withSplit({}, e.split) }),
          fromMember: me,
          toMember: data.members.find((m) => m.id !== me)?.id ?? me,
          occurredAt: e.occurredAt,
          categoryId: e.categoryId ?? null,
          receiptItems: e.receiptItems ?? null,
          receiptTip: e.receiptTip ?? null,
          receiptInvolved: e.receiptInvolved ?? null,
          receiptAssignments: e.receiptAssignments ?? null,
          // A percent split has no tab of its own, so it is left without one:
          // `legacyPercent` draws it, and the first tap converts it away.
          splitTab: e.splitTab ?? (e.split.mode === "percent" ? undefined : e.split.mode),
        }, seedKey);
        return;
      }
      const s = data.settlements.find((x) => x.id === entryId);
      if (!s) return;
      seedDraft(groupId, {
        ...blankDraft("transfer", me, base, data.members.map((m) => m.id)),
        entryId,
        amountText: minorToDecimalString(s.amountMinor, s.currency),
        currency: s.currency,
        description: s.note ?? "",
        fromMember: s.fromMember,
        toMember: s.toMember,
        occurredAt: s.occurredAt,
      }, seedKey);
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
    } : blank, seedKey);
    // `prefill` is rebuilt each render; the query params behind it are what
    // actually change, and the draft is only ever seeded once per entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, entryId, seedKey, wantedKind, prefill.from, prefill.to, prefill.amount,
    data.loading, data.group, data.members, data.me, data.expenses, data.settlements]);

  // Nothing is stored, so a reload or a closed tab loses what's typed. Let the
  // browser say so, the same way it does for any other half-filled form.
  useEffect(() => {
    if (!groupId) return;
    const warn = (e: BeforeUnloadEvent) => { if (isDraftDirty(groupId)) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [groupId]);

  const title = entryId ? copy.form.editTitle : copy.form.newTitle;
  // No members means the draft can't be seeded — no payer to name — and this
  // screen used to sit as a titled blank forever, with nothing saying that
  // People is where the fix is. It is reachable: a group pulled from the
  // server before its members arrive, or opened by its own link on a phone
  // that hasn't claimed anybody.
  if (groupId && !data.loading && data.group && data.members.length === 0) {
    return (
      <Screen><Body>
        <TopBar title={title} back={route.group(groupId)} />
        <Empty title={copy.form.nobodyTitle}>
          <p>{copy.form.nobodyBody}</p>
          <Link className="btn btn-p" style={{ marginTop: 14 }} href={route.members(groupId)}>
            {copy.members.title}
          </Link>
        </Empty>
      </Body></Screen>
    );
  }
  // An `e` naming nothing in either table is the same dead end one step on: the
  // seeding effect has nothing to seed from and gives up, leaving a titled
  // blank forever. A link to a deleted entry is the ordinary way here, so it
  // gets the sentence the entry screen already says for one.
  if (groupId && entryId && !data.loading && data.group
    && !data.expenses.some((e) => e.id === entryId)
    && !data.settlements.some((s) => s.id === entryId)) {
    return (
      <Screen><Body>
        <TopBar title={copy.entry.gone.title} back={route.group(groupId)} />
        <Empty title={copy.entry.gone.body} />
      </Body></Screen>
    );
  }
  if (!groupId) return <BadLink />;
  if (!data.loading && !data.group) return <BadLink />;
  if (unclaimed || !data.group || !draft) return <Blank title={title} />;
  const group = data.group;
  const base = group.baseCurrency;
  const kind = draft.kind;
  const transfer = kind === "transfer";

  // Merges against the latest saved draft, not the `draft` this render closed
  // over — some interactions (switching split tabs) call patch() twice in one
  // handler, and merging against a stale closure would let the first patch's
  // change be clobbered by the second.
  const patch = (change: Partial<EntryDraft>) =>
    saveDraft(groupId, clipAmountToCurrency({ ...(getDraft(groupId) ?? draft), ...change }));

  /**
   * Change the entry's currency, and ask for its rate when the group has none.
   *
   * This is the "introducing a new currency" moment: picking MAD in a EUR
   * group used to leave the rate at "1", pass validation, and bank a 500 MAD
   * dinner as €500. Now the dialog opens on the spot with today's rate ready,
   * and Save is held until the group has a number either way.
   */
  function pickCurrency(currency: string) {
    patch({ currency });
    if (needsRate(data.rates, data.group?.baseCurrency, currency)) setAskRate(currency);
  }

  // What the entry is worth and whether Save may light — one function, so the
  // arithmetic behind that button has a test suite rather than a screen to
  // mount (lib/entry-check.ts). The form reads its answers; it writes nothing.
  const check = checkEntry({
    draft, base, rates: data.rates,
    liveMembers: data.members.map((m) => m.id),
    nameOf: data.nameOf,
  });
  const {
    activeTab, canScan, activeSplit, receiptSplit, effectiveSplit, receiptTotal, receiptLocksAmount,
    onReceiptTab, amountMinor, baseMinor, foreign, groupRate, rateOk, blocker, receiptBlocker, ready,
  } = check;

  /**
   * Switching tabs. Two handoffs, each made once and only into a tab that has
   * nothing of its own yet: `openSplitTab` gives a first-time tab a split to
   * start from, and `handOffReceiptTotal` gives the amount field back the
   * total Receipt was deriving — without which the amount has nowhere to go
   * and the expense silently becomes worth zero (ADR-0016). A tab already
   * holding an answer keeps it, whatever the others now say.
   */
  const changeTab = (splitTab: SplitTab) => {
    const handoff = handOffReceiptTotal(
      activeTab, splitTab, draft.receiptItems, draft.receiptTip, draft.currency,
    );
    patch({
      splitTab,
      splits: openSplitTab(draft, splitTab, baseMinor),
      ...(handoff !== null ? { amountText: handoff } : {}),
    });
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
    // The note only defaults to "Reimbursement" because a transfer is one
    // (`blankDraft`). Arriving at a transfer with nothing typed takes that
    // default; leaving one that still carries it hands the next kind an
    // empty field rather than a word about a transfer it no longer is.
    const note = next === "transfer"
      ? (draft.description.trim() === "" ? copy.form.reimbursement : draft.description)
      : (draft.description === copy.form.reimbursement ? "" : draft.description);
    patch({
      kind: next,
      description: note,
      ...(leavingReceipt
        ? { splitTab: "equal" as SplitTab, splits: openSplitTab(draft, "equal", baseMinor) }
        : {}),
      ...(handoff !== null ? { amountText: handoff } : {}),
    });
  };

  const coPayers = Object.entries(draft.payers ?? {}).filter(([, v]) => v > 0);

  // Leaving throws the draft away — there is nowhere for it to be kept — so ask
  // first, but only once something has actually been typed.
  /** May we leave? Not with a typed draft — ask, and stay put. */
  function mayLeave() {
    if (!groupId) return true;
    if (isDraftDirty(groupId)) { setAsk("discard"); return false; }
    clearDraft(groupId);
    return true;
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
    // Every write below is signed by whoever this phone said it was. It has
    // said — `useClaimGate` sends a phone that hasn't to the screen that asks
    // — so this is the compiler being shown that, not a fallback.
    const actor = data.me;
    if (!ready || saving || !groupId || !actor) return;
    setSaving(true);
    setFailed(undefined);
    const rate = foreign ? groupRate ?? "1" : "1";
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
        if (draft.entryId) await editSettlement(groupId, actor, draft.entryId, input);
        else await recordSettlement(groupId, actor, input);
      } else {
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
          // The tab is a claim about the split beside it, so a legacy percent
          // one — which no tab can hold — makes no claim (ADR-0016).
          splitTab: canScan && effectiveSplit.mode !== "percent" ? activeTab : null,
        };
        if (draft.entryId) await editExpense(groupId, actor, draft.entryId, input);
        // Written under the id the form has been quoting its split with, so
        // the cent it showed on somebody's row is the cent the ledger keeps.
        else await addExpense(groupId, actor, input, Date.now(), draft.newEntryId);
      }
      clearDraft(groupId);
      router.replace(route.group(groupId));
    } catch (err) {
      setSaving(false);
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
            ? (reachable.length > 1 ? copy.form.editTitle : copy.form.editKind(copy.entryKind.label[kind].toLowerCase()))
            : copy.form.newTitle}
          sub={group.name}
          back={{ ask: mayLeave }}
          right={<button className="action" onClick={save} disabled={!ready || saving}>{copy.act.save}</button>}
        />

        <Scroll>
          <input ref={cameraInput} type="file" accept="image/*" capture="environment"
            style={{ display: "none" }} onChange={(e) => onPhoto(e, "camera")} aria-label={copy.scan.camera} />
          <input ref={libraryInput} type="file" accept="image/*"
            style={{ display: "none" }} onChange={(e) => onPhoto(e, "library")} aria-label={copy.scan.library} />

          {reachable.length > 1 ? (
            <div className="pad" style={{ paddingTop: 2, paddingBottom: 0 }}>
              <div className="seg" role="tablist" aria-label={copy.form.kindTablist}>
                {reachable.map((k) => (
                  <button key={k} type="button" role="tab" aria-selected={k === kind}
                    className={k === kind ? "on" : ""} onClick={() => changeKind(k)}>
                    {copy.entryKind.label[k]}
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
                aria-label={copy.form.amount(draft.currency)}
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
              <button type="button" className="chip" aria-label={copy.form.currency}
                style={{ alignSelf: "center", marginLeft: 3 }}
                onClick={() => setAsk("currency")}>
                {draft.currency} <Icon name="chev" size={10} />
              </button>
            </div>

            {receiptLocksAmount ? (
              <div style={{
                fontSize: 11, color: "var(--hl-ink)", background: "var(--hl)", display: "inline-block",
                padding: "2px 7px", borderRadius: 2, marginTop: 7,
              }}>{copy.form.fromReceipt}</div>
            ) : null}

            {/* The rate is no longer a field on this form. It is the group's
                one number for this currency, so the row says what that number
                is and opens the registry's own dialog to change it — where
                changing it also says how much of the ledger moves. */}
            {foreign ? (
              <>
                <button type="button" className="ratelink"
                  aria-label={copy.rates.openFor(draft.currency)}
                  onClick={() => setAskRate(draft.currency)}>
                  = {rateOk ? money(baseMinor, base) : copy.none} · 1 {draft.currency} ={" "}
                  <span className={groupRate === undefined ? "bad" : undefined}>
                    {groupRate === undefined ? copy.unknown : formatRate(groupRate)}
                  </span>{" "}
                  {base} <Icon name="chev" size={10} />
                </button>
                <div style={{
                  fontSize: 11, color: "var(--hl-ink)", background: "var(--hl)", display: "inline-block",
                  padding: "2px 7px", borderRadius: 2, marginTop: 7,
                }}>{copy.rates.groupRate}</div>
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
              {transfer ? null : <label htmlFor="what">{copy.form.what}</label>}
              <input id="what" value={draft.description}
                aria-label={transfer ? copy.form.note : copy.form.what}
                placeholder={transfer ? copy.form.note : copy.form.whatPlaceholder}
                onChange={(e) => patch({ description: e.target.value })} />
            </div>

            {transfer ? null : coPayers.length > 1 ? (
              <Card style={{ padding: "10px 12px" }}>
                <Link href={route.payers(groupId)} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="fieldlabel">{copy.entryKind.payer[kind]}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {plural(coPayers.length, copy.noun.person)}
                  </span>
                  <Icon name="chev" size={14} className="spacer" style={{ color: "var(--muted)" }} />
                </Link>
                <div className="hairline" />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {coPayers.map(([id, amount]) => (
                    <Chip key={id} variant={id === data.me ? "hl" : undefined}>
                      {(data.memberById.get(id)?.name ?? copy.unknown).split(" ")[0]} {money(amount, draft.currency)}
                    </Chip>
                  ))}
                </div>
              </Card>
            ) : (
              <div className="field">
                <span className="fieldlabel">{copy.entryKind.payer[kind]}</span>
                <button type="button" id="paidby" className="pick"
                  aria-label={copy.entryKind.payer[kind]} onClick={() => setAsk("payer")}>
                  <span className="ptext">{data.memberById.get(draft.paidBy)?.name ?? copy.none}</span>
                  <Icon name="chev" size={13} className="spacer pchev" />
                </button>
                <Link href={route.payers(groupId)} className="chip" aria-label={copy.form.coPayers[kind === "income" ? "income" : "expense"]}>
                  {copy.form.andSomeone}
                </Link>
              </div>
            )}

            {blocker ? <div className="failure">{blocker}</div> : null}

            {transfer ? null : (
              <SplitEditor
                members={data.members}
                me={data.me}
                title={copy.entryKind.split[kind]}
                totalMinor={baseMinor}
                totalUnknown={foreign && groupRate === undefined}
                currency={base}
                spec={activeSplit}
                receiptSplit={receiptSplit}
                seed={splitSeed(draft)}
                onChange={(split) => patch({ splits: withSplit(draft.splits, split) })}
                tab={activeTab}
                onTabChange={changeTab}
                receipt={canScan ? {
                  items: draft.receiptItems ?? null,
                  scanDisabled: !secret,
                  scanState,
                  scanSource,
                  scanError,
                  blocker: receiptBlocker,
                  onScanCamera: () => cameraInput.current?.click(),
                  onScanLibrary: () => libraryInput.current?.click(),
                  editItemsHref: route.items(groupId),
                } : null}
              />
            )}

            <div className="field">
              <label htmlFor="when">{copy.form.when}</label>
              <input id="when" type="date" value={dateInputValue(draft.occurredAt)}
                onChange={(e) => patch({ occurredAt: withDate(draft.occurredAt, e.target.value) })} />
            </div>

            {failed ? <p className="failure" role="alert">{copy.form.saveFailed(failed)}</p> : null}
          </div>
          <div style={{ height: 12 }} />
        </Scroll>
      </Body>

      {ask === "discard" ? (
        <ConfirmDialog
          title={entryId ? copy.form.discardTitleEdits : copy.form.discardTitle(copy.entryKind.label[kind].toLowerCase())}
          confirm={copy.act.discard}
          danger={true} onConfirm={discard} onClose={() => setAsk(null)}>
          <p>{copy.form.discardBody}</p>
        </ConfirmDialog>
      ) : null}

      {ask === "currency" ? (
        <ChoiceDialog
          title={copy.currency.title}
          value={draft.currency}
          options={[
            ...[...new Set([base, draft.currency, ...COMMON_CURRENCIES])].map((c) => ({
              value: c,
              label: currencyLabel(c),
              note: c === base ? copy.currency.isBase : undefined,
            })),
            { value: OTHER_CURRENCY, label: copy.currency.other, note: copy.currency.otherNote },
          ]}
          onPick={(currency) => {
            if (currency === OTHER_CURRENCY) { setAsk("currency-other"); return; }
            pickCurrency(currency);
          }}
          // "Other…" hands over to the prompt, so that pick must not close it.
          onClose={() => setAsk((a) => (a === "currency-other" ? a : null))}
        />
      ) : null}

      {ask === "payer" ? (
        <ChoiceDialog
          title={copy.entryKind.payer[kind]}
          value={draft.paidBy}
          options={data.members.map((m) => ({
            value: m.id,
            label: m.name,
            note: m.id === data.me ? copy.form.you : undefined,
          }))}
          onPick={(paidBy) => patch({ paidBy, payers: null })}
          onClose={() => setAsk(null)}
        />
      ) : null}

      {/* The same dialog the registry screen opens, so a rate set from here
          is the group's rate and not a number private to this entry. */}
      {askRate !== null && groupId ? (
        <RateDialog
          currency={askRate}
          base={base}
          current={data.rates[askRate]}
          entryCount={data.currencies.find((c) => c.currency === askRate)?.entryCount ?? 0}
          onSave={async (rate: string, source: RateSource, asOf: number) => {
            if (data.me) await setRate(groupId, data.me, askRate, rate, source, asOf);
          }}
          onClose={() => {
            setAskRate(null);
            // The grid the scan was on its way to, held back until now.
            if (itemsAfterRate) { setItemsAfterRate(false); router.push(route.items(groupId)); }
          }}
        />
      ) : null}

      {ask === "currency-other" ? (
        <PromptDialog title={copy.currency.title} placeholder={copy.currency.otherPlaceholder}
          confirm={copy.act.useIt} maxLength={3}
          autoCapitalize="characters"
          clean={normalizeCurrencyCode} valid={isCurrencyCode}
          onSubmit={(currency) => {
            pickCurrency(currency);
            setAsk(null);
          }}
          onClose={() => setAsk(null)} />
      ) : null}
    </Screen>
  );
}
