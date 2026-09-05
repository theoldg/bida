"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  convertMinor, formatRate, isCurrencyCode, minorToDecimalString, rateFor,
  splitParticipants, validatePayers, validateSplit,
  type Member, type RateSource, type SplitSpec,
} from "@hajsik/core";
import { handOffReceiptTotal, weightsFromItems } from "../../../../lib/scan/items";
import { Card, Chip } from "../../../../components/bits";
import { AmountInput, sanitizeAmount } from "../../../../components/amount-input";
import { SplitEditor, type ScanSource, type ScanState } from "../../../../components/split-editor";
import { BadLink, Blank, Body, Empty, QueryBoundary, Screen, Scroll, TopBar } from "../../../../components/chrome";
import { ChoiceDialog, ConfirmDialog, PromptDialog } from "../../../../components/dialog";
import { RateDialog } from "../../../../components/rate-dialog";
import { Icon } from "../../../../components/icons";
import { COMMON_CURRENCIES, currencyLabel, normalizeCurrencyCode, OTHER_CURRENCY } from "../../../../lib/currencies";
import {
  addExpense, editExpense, editSettlement, recordSettlement, setRate,
} from "../../../../lib/db/commands";
import { ENTRY_KINDS, kindOf, type EntryKind } from "../../../../lib/entry-kind";
import { copy } from "../../../../lib/copy";
import { dateInputValue, errorText, money, payerProblemText, plural, withDate } from "../../../../lib/format";
import { route } from "../../../../lib/group-link";
import { useClaimGate, useGroupData, useGroupSecret } from "../../../../lib/hooks";
import {
  normalizeScan, scanReceipt, ScanOfflineError, ScanRejectedError, ScanUnavailableError,
  ScanUnreliableError,
} from "../../../../lib/scan";
import { activeSplitTab, blankDraft, clearDraft, draftAmountMinor, draftReceiptTotal, draftSeedKey, getDraft, isDraftDirty, saveDraft, seedDraft, useDraft, type EntryDraft, type SplitTab } from "../../../../lib/draft";

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

/** `convertMinor`, or null when the product doesn't fit in a safe integer. */
function tryConvertMinor(
  minor: number, from: string, to: string, rate: string,
): number | null {
  try {
    return convertMinor(minor, from, to, rate);
  } catch {
    return null;
  }
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
   * True when the group has no rate for this currency — the state in which an
   * entry cannot honestly be converted, and the one that opens the dialog.
   * Hoisted so the scan handler above can ask it too.
   */
  function needsRate(currency: string): boolean {
    const groupBase = data.group?.baseCurrency;
    return !!groupBase && currency !== groupBase
      && rateFor(data.rates, groupBase, currency) === undefined;
  }

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
      const wantsRate = patch.currency !== undefined && needsRate(patch.currency)
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
          kind: kindOf(e),
          entryId,
          // `minorToDecimalString`, never `bare`: this is the canonical text
          // `parseMinor` reads back, and `bare` groups thousands. "1,234.50"
          // fails to parse (amount silently 0) and "25,000" JPY parses as 25.
          amountText: minorToDecimalString(e.amountMinor, e.currency),
          currency: e.currency,
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
    if (needsRate(currency)) setAskRate(currency);
  }

  const patch = (change: Partial<EntryDraft>) =>
    saveDraft(groupId, clipAmountToCurrency({ ...(getDraft(groupId) ?? draft), ...change }));

  const activeTab: SplitTab = activeSplitTab(draft);

  // A bill is a thing an expense has. An income has no receipt to read a
  // total off, and a transfer has no split at all.
  const canScan = kind === "expense";
  const hasReceiptItems = (draft.receiptItems?.length ?? 0) > 0;
  const onReceiptTab = canScan && activeTab === "receipt" && hasReceiptItems;

  // Receipt's total is `lib/draft.ts`'s to derive, at the one place it is read
  // (this render, and save() below) — never written into the draft as a cache
  // for some other effect to notice and resync. Nothing can fall out of step
  // because nothing is recorded twice (ADR-0016).
  const receiptTotal = draftReceiptTotal(draft);
  // The amount is derived from the bill while Receipt mode is showing it —
  // typing over it would desync the total from what the items actually add
  // up to, with nothing left to reconcile the two. Edit the items or the tip
  // instead, or switch tabs to take manual control back (ADR-0016). Locked on
  // a real, positive derived number, never merely on having items: a field
  // that is disabled *and* empty is a screen with nothing to type in and a
  // Save that will never light.
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
  // silently becomes worth zero. ADR-0016.
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

  // The same question the payers editor asks, answered by the same function.
  const amountMinor = draftAmountMinor(draft);

  const foreign = draft.currency !== base;
  // The rate is the group's, read from the registry — not a field on this form
  // and not a number frozen onto the entry (ADR-0005). Undefined means the
  // group has never said what this currency is worth, which is the state that
  // used to be silently `"1"` and bank a 500 MAD dinner as €500.
  const groupRate = rateFor(data.rates, base, draft.currency);
  // An amount and a rate can each be in range and still multiply out of it —
  // `sanitizeAmount` allows twelve whole digits, and this runs in the render
  // body, so an unguarded throw is a white screen with nothing to press. An
  // out-of-range conversion is "no base amount yet", the state a missing rate
  // already produces: the figure reads "—" and Save stays held.
  const converted = foreign && groupRate !== undefined
    ? tryConvertMinor(amountMinor, draft.currency, base, groupRate)
    : null;
  const rateOk = !foreign || converted !== null;
  const baseMinor = foreign ? converted ?? 0 : amountMinor;

  // The split editor is inline below and shows its own arithmetic; the form
  // only needs to know whether what it currently says can be saved.
  const splitOk = transfer
    || validateSplit(baseMinor, effectiveSplit, { tiebreakSeed: draft.entryId ?? "new" }).ok;

  // Payers are checked against the amount in the entry's own currency: that
  // is the number people typed and the number they'd check against a receipt.
  const payerCheck = validatePayers(amountMinor, transfer ? null : draft.payers);
  const coPayers = Object.entries(draft.payers ?? {}).filter(([, v]) => v > 0);
  // A side has to be somebody still in the group, not merely a non-empty
  // string. This checked truthiness, and a removed member's id is truthy — so
  // a settle-up row naming somebody who had left opened a transfer *from* a
  // person who is not in the group, with Save lit up. `goneMember` below is
  // what puts the name of the missing side on screen.
  const live = new Set(data.members.map((m) => m.id));
  const sidesOk = !transfer
    || (draft.fromMember !== draft.toMember && live.has(draft.fromMember) && live.has(draft.toMember));

  // Everybody an entry names has to still be in the group. `paidBy`, the payer
  // map and the split are all lists of ids, and a member removed while this
  // entry was open leaves one behind that no picker on either screen can show —
  // money sitting against a name that is on no list. Save is held, and the line
  // below says whose name it is.
  //
  // A transfer's two sides are the same fault wearing "—". A departed member
  // keeps whatever balance they left with, so the balances tab still offers to
  // settle with them; following that row landed on a grey Save, an empty slot
  // and nothing on screen saying whose name was missing.
  const goneMember = (transfer
    ? [draft.fromMember, draft.toMember]
    : [draft.paidBy, ...Object.keys(draft.payers ?? {}), ...splitParticipants(effectiveSplit)])
    .find((id) => id && !live.has(id));

  // Receipt mode has to have produced the split it claims. Without this the
  // tab could be opened over an ordinary even split and saved — the entry then
  // said "from receipt" beside a split nobody read off a receipt, and a scan
  // whose grid was never filled in silently went out evenly. The tab is the
  // claim; `receiptSplit` is whether it is true.
  const receiptUnfinished = canScan && activeTab === "receipt" && receiptSplit === null
    ? (hasReceiptItems ? copy.form.noWhoHadWhat : copy.form.noReceipt)
    : null;

  // The one place the form says why Save is grey. It used to live inside the
  // co-payer card, so the states that render the *single*-payer field — an
  // empty payer map, a payer who has left — held Save with nothing anywhere
  // on screen to read. A check with no visible reason is a dead end.
  const blocker = goneMember
    ? copy.form.goneMember(data.nameOf(goneMember))
    // A rate the group hasn't got is not a typo to be fixed in this field —
    // there is no field. Say what is missing and where it is set.
    : foreign && groupRate === undefined ? copy.rates.needed(draft.currency)
      : receiptUnfinished ?? payerProblemText(payerCheck, draft.currency);

  const ready = amountMinor > 0 && rateOk && splitOk && !blocker && sidesOk
    // A transfer's words are a note and optional; an expense without a name is
    // a row nobody can identify a week later.
    && (transfer || draft.description.trim().length > 0);

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
    if (!ready || !groupId || !actor) return;
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
            ? (reachable.length > 1 ? copy.form.editTitle : copy.form.editKind(copy.entryKind.label[kind].toLowerCase()))
            : copy.form.newTitle}
          sub={group.name}
          back={{ ask: mayLeave }}
          right={<button className="action" onClick={save} disabled={!ready}>{copy.act.save}</button>}
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
                <Link href={route.payers(groupId)} className="chip" aria-label={copy.form.coPayers}>
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
        <ConfirmDialog title={copy.form.discardTitle(copy.entryKind.label[kind].toLowerCase())}
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

/**
 * A transfer's two sides, and the one-tap reversal between them.
 *
 * Getting the direction the wrong way round is the mistake this form invites,
 * and it is one people make *after* picking both names — so the fix is the
 * arrow itself, which points the way the money goes and reverses it when
 * pressed, rather than two pickers you have to re-open in turn.
 *
 * Each half is labelled above the person: "From" then a face, which is the
 * order the sentence is read in. Tapping one opens our own picker rather than
 * the browser's wheel (ADR-0008) — which is what lets the person already on
 * the other side stay in the list, saying what picking them does: it swaps the
 * sides, the only reading of "send this to the person who is sending it" that
 * isn't the error message below.
 */
function TransferSides({ members, from, to, onChange }: {
  members: Member[];
  from: string;
  to: string;
  onChange: (sides: { fromMember: string; toMember: string }) => void;
}) {
  const [picking, setPicking] = useState<null | "from" | "to">(null);
  const byId = new Map(members.map((m) => [m.id, m]));

  const side = (which: "from" | "to") => {
    const member = byId.get(which === "from" ? from : to);
    return (
      <button type="button" className="tside" onClick={() => setPicking(which)}
        aria-label={which === "from" ? copy.form.sentBy : copy.form.receivedBy}>
        <span className="eyebrow">{which === "from" ? copy.entry.from : copy.entry.to}</span>
        <span className="who">{member?.name ?? copy.none}</span>
      </button>
    );
  };

  const pick = (id: string) => {
    if (!picking) return;
    // Picking the other side's person is a reversal, not an impossible transfer.
    const swap = picking === "from" ? id === to : id === from;
    if (swap) onChange({ fromMember: to, toMember: from });
    else if (picking === "from") onChange({ fromMember: id, toMember: to });
    else onChange({ fromMember: from, toMember: id });
  };

  return (
    <div>
      <div className="card transfer">
        {side("from")}
        <button type="button" className="tswap" aria-label={copy.form.swapSides}
          onClick={() => onChange({ fromMember: to, toMember: from })}>
          <Icon name="arrow" size={18} />
        </button>
        {side("to")}
      </div>
      {from === to ? (
        <p className="failure" role="alert">{copy.form.sameSide}</p>
      ) : null}

      {picking ? (
        <ChoiceDialog
          title={picking === "from" ? copy.form.sentBy : copy.form.receivedBy}
          value={picking === "from" ? from : to}
          options={members.map((m) => ({
            value: m.id,
            label: m.name,
            note: (picking === "from" ? m.id === to : m.id === from) && from !== to
              ? copy.form.otherSide : undefined,
          }))}
          onPick={pick}
          onClose={() => setPicking(null)}
        />
      ) : null}
    </div>
  );
}
