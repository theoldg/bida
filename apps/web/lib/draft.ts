"use client";

import { useSyncExternalStore } from "react";
import {
  convertSplitMode, minorToDecimalString, newId, ownCurrencySplit, parseMinor, receiptExtras, receiptOf,
  sameLocalDay,
  type ArithmeticMode, type ArithmeticSplit, type EntryRateSource, type Expense, type Receipt, type ReceiptItem,
  type Settlement, type SplitMode, type SplitSpec,
} from "@bida/core";
import { kindOf, type EntryKind } from "./entry-kind";
import { dateInputValue } from "./format";
import { receiptBreakdown, receiptTotalMinor, type MemberLine } from "./scan/items";
import { clearScan } from "./scan/live";
import { signal } from "./signal";

/** `percent` has no tab and survives only so old entries render (ADR-0010). */
export type SplitTab = Exclude<SplitMode, "percent">;

type ArithmeticTab = Exclude<SplitTab, "receipt">;

/**
 * One per tab: a shared spec would let leaving somebody out under Evenly
 * delete their parts under As parts. `undefined` until first opened.
 */
export type SplitInputs = { [M in ArithmeticMode]?: Extract<SplitSpec, { mode: M }> };

/**
 * Outside React, so moving between the form, payers and grid keeps it. In
 * memory only. One shape for all three kinds, so switching kind keeps what was typed.
 */
export interface EntryDraft extends Receipt {
  kind: EntryKind;
  /** Present when editing. An edit never crosses between expense and transfer (ADR-0010). */
  entryId?: string;
  /** The leftover cent goes by the entry's id, so the quote must use the one written. */
  newEntryId: string;
  /** Exactly what is typed, e.g. "620.". */
  amountText: string;
  currency: string;
  /**
   * The entry's own rate, and what it is the rate for: `rateCurrency` on
   * `rateDay` (local "YYYY-MM-DD"). Read only while `rateCurrency` is the
   * draft's currency; a change of either sends `useEntryRate` to the feed
   * (ADR-0005). Absent in the base currency.
   */
  rate?: string;
  rateSource?: EntryRateSource;
  rateCurrency?: string;
  rateDay?: string;
  /** A transfer's note. */
  description: string;
  /** On an income, who received. */
  paidBy: string;
  /** Null for one payer. */
  payers: Record<string, number> | null;
  splits: SplitInputs;
  fromMember: string;
  toMember: string;
  occurredAt: number;
  dateOnly: boolean;
  /** What `retimed` measures against. Never saved. */
  recordedAt: number;
  categoryId: string | null;
  splitTab?: SplitTab;
  /** So a rescan can replace its own guess but not a typed title. */
  scannedDescription?: string;
}

/** Unset derives from the entry: a bill means Receipt, a legacy percent As parts. */
export function activeSplitTab(draft: EntryDraft): SplitTab {
  return draft.splitTab
    ?? ((draft.receiptItems?.length ?? 0) > 0 ? "receipt"
      : draft.splits.percent ? "shares" : "equal");
}

/** A tap during the scan must not be overruled by its result. */
export function tabAfterScan(
  draft: EntryDraft, tabAtStart: SplitTab, hasItems: boolean,
): SplitTab | undefined {
  if (!hasItems) return undefined;
  return activeSplitTab(draft) === tabAtStart ? "receipt" : undefined;
}

/** Shown with no tab pressed until the first tap converts it. */
export function legacyPercent(draft: EntryDraft): SplitSpec | null {
  return draft.splitTab === undefined && (draft.receiptItems?.length ?? 0) === 0
    ? draft.splits.percent ?? null
    : null;
}

/** So the cent the form quotes is the cent kept. */
export function splitSeed(draft: EntryDraft): string {
  return draft.entryId ?? draft.newEntryId;
}

function emptySplit(tab: ArithmeticTab): SplitSpec {
  switch (tab) {
    case "equal": return { mode: "equal", members: [] };
    case "shares": return { mode: "shares", weights: {} };
    case "exact": return { mode: "exact", amounts: {} };
  }
}

/** Not Receipt: its weights are the bill's (ADR-0016). */
export function withSplit(splits: SplitInputs, spec: ArithmeticSplit): SplitInputs {
  switch (spec.mode) {
    case "equal": return { ...splits, equal: spec };
    case "shares": return { ...splits, shares: spec };
    case "exact": return { ...splits, exact: spec };
    case "percent": return { ...splits, percent: spec };
  }
}

/**
 * Weights in the receipt's currency, with each person's lines. The grid, form
 * and quick split must agree to the cent, so the seed is fixed here.
 */
export function receiptBill(
  draft: EntryDraft,
  items: readonly ReceiptItem[],
  assignments: readonly Set<string>[],
  involved: ReadonlySet<string>,
): { weights: Record<string, number>; lines: Record<string, MemberLine[]> } {
  return receiptBreakdown(
    [...items],
    [...assignments],
    receiptExtras(draft),
    involved,
    draft.currency,
    splitSeed(draft),
  );
}

function showsReceipt(draft: EntryDraft): boolean {
  return draft.kind === "expense"
    && activeSplitTab(draft) === "receipt" && (draft.receiptItems?.length ?? 0) > 0;
}

/** Null until the grid is filled. Never written into the draft: the grid is the record. */
export function draftReceiptSplit(draft: EntryDraft): SplitSpec | null {
  if (!showsReceipt(draft)) return null;
  const { weights } = receiptBill(
    draft,
    draft.receiptItems ?? [],
    (draft.receiptAssignments ?? []).map((row) => new Set(row)),
    new Set(draft.receiptInvolved ?? []),
  );
  return Object.keys(weights).length > 0 ? { mode: "receipt", weights } : null;
}

/** Receipt falls back to Evenly while the grid is unfilled. */
export function activeSplit(draft: EntryDraft): SplitSpec {
  return (activeSplitTab(draft) === "receipt" ? draftReceiptSplit(draft) : null)
    ?? arithmeticSplit(draft);
}

/** Ignores the bill, so a scan never feeds As parts (ADR-0016). */
function arithmeticSplit(draft: EntryDraft): SplitSpec {
  const legacy = legacyPercent(draft);
  if (legacy) return legacy;
  const tab = activeSplitTab(draft);
  const arithmetic: ArithmeticTab = tab === "receipt" ? "equal" : tab;
  return draft.splits[arithmetic] ?? emptySplit(arithmetic);
}

/**
 * A tab keeps what was typed into it; one opened for the first time is
 * converted once, not kept in sync. As amounts divides the entry's own amount,
 * the others `baseMinor`.
 */
export function openSplitTab(draft: EntryDraft, tab: SplitTab, baseMinor: number): SplitInputs {
  if (tab === "receipt") return draft.splits;
  const kept = { ...draft.splits };
  // The first arithmetic tab converts a legacy percent split away for good.
  delete kept.percent;
  if (kept[tab]) return kept;
  const totalMinor = tab === "exact" ? draftAmountMinor(draft) : baseMinor;
  return withSplit(kept, convertSplitMode(totalMinor, arithmeticSplit(draft), tab, {
    tiebreakSeed: splitSeed(draft),
  }));
}

/** Null for ≤ 0 too: the amount is disabled on a derived number, and disabled-and-empty can't save. */
export function draftReceiptTotal(draft: EntryDraft): number | null {
  if (!showsReceipt(draft)) return null;
  const total = receiptTotalMinor(draft.receiptItems ?? [], receiptExtras(draft), draft.currency);
  return total !== null && total > 0 ? total : null;
}

/** Ask this, not `amountText`, which makes a scanned expense zero. */
export function draftAmountMinor(draft: EntryDraft): number {
  const receipt = draftReceiptTotal(draft);
  if (receipt !== null) return receipt;
  try {
    return draft.amountText ? parseMinor(draft.amountText, draft.currency) : 0;
  } catch {
    return 0; // mid-type
  }
}

const { emit, subscribe } = signal();
const drafts = new Map<string, EntryDraft | undefined>();
const baselines = new Map<string, string>();
const seedKeys = new Map<string, string>();

/**
 * The form has no time field, so on another day the recorded hour is
 * meaningless and the entry becomes `dateOnly`; back on the recording day the
 * reading returns.
 */
export function retimed(draft: EntryDraft, occurredAt: number): Pick<EntryDraft, "occurredAt" | "dateOnly"> {
  if (!sameLocalDay(occurredAt, draft.recordedAt)) return { occurredAt, dateOnly: true };
  return { occurredAt: draft.dateOnly ? draft.recordedAt : occurredAt, dateOnly: false };
}

export function saveDraft(groupId: string, draft: EntryDraft): void {
  drafts.set(groupId, draft);
  emit();
}

/**
 * The form remounts on every return from payers or the grid and keeps its
 * draft; a different key is a different entry, which mustn't inherit it.
 */
export function seedDraft(groupId: string, draft: EntryDraft, key: string): void {
  baselines.set(groupId, JSON.stringify(draft));
  seedKeys.set(groupId, key);
  saveDraft(groupId, draft);
}

/** Built only here: the form and `/g/scan` must agree, or a scan lands on an empty form. */
export function newEntryKey(
  kind: string | null | undefined,
  prefill?: { title?: string },
): string {
  // A named expense (the tip screen's) and a blank one are different asks.
  return `new:${kind ?? "expense"}:${prefill?.title ?? ""}`;
}

export function draftSeedKey(groupId: string): string | undefined {
  return drafts.get(groupId) ? seedKeys.get(groupId) : undefined;
}

export function clearDraft(groupId: string): void {
  drafts.set(groupId, undefined);
  baselines.delete(groupId);
  seedKeys.delete(groupId);
  // A scan in flight drops its result now, so "Reading…" goes too.
  clearScan(groupId);
  emit();
}

export function isDraftDirty(groupId: string): boolean {
  const draft = drafts.get(groupId);
  if (!draft) return false;
  return JSON.stringify(draft) !== baselines.get(groupId);
}

export function getDraft(groupId: string): EntryDraft | undefined {
  return drafts.get(groupId);
}

export function useDraft(groupId: string | undefined): EntryDraft | undefined {
  return useSyncExternalStore(
    subscribe,
    () => (groupId ? drafts.get(groupId) : undefined),
    () => undefined,
  );
}

export function blankDraft(
  kind: EntryKind,
  me: string,
  currency: string,
  members: string[],
  started = Date.now(),
): EntryDraft {
  return {
    kind,
    newEntryId: newId(),
    // Never "0": the caret lands after it and "5" gives "50".
    amountText: "",
    currency,
    description: "",
    paidBy: me,
    payers: null,
    splits: { equal: { mode: "equal", members } },
    splitTab: "equal",
    fromMember: me,
    toMember: members.find((id) => id !== me) ?? me,
    occurredAt: started,
    recordedAt: started,
    dateOnly: false,
    categoryId: null,
  };
}

/**
 * An entry's rate as its draft holds it: the one it is read at, for its own
 * currency and day, so opening it to edit looks nothing up. One from before
 * rates were the entry's says it was the group's (ADR-0005).
 */
function ownRate(e: Expense | Settlement): Pick<EntryDraft, "rate" | "rateSource" | "rateCurrency" | "rateDay"> {
  return {
    rate: e.rateToBase,
    rateSource: e.rateSource ?? "group",
    rateCurrency: e.currency,
    rateDay: dateInputValue(e.occurredAt),
  };
}

export function expenseDraft(e: Expense, me: string, members: string[]): EntryDraft {
  return {
    ...blankDraft(kindOf(e), me, e.currency, members),
    entryId: e.id,
    // Never `bare`, which groups thousands: "25,000" JPY parses back as 25.
    amountText: minorToDecimalString(e.amountMinor, e.currency),
    ...ownRate(e),
    description: e.description,
    paidBy: e.paidBy,
    payers: e.payers ?? null,
    // A receipt's weights are not handed to the arithmetic tabs (ADR-0016).
    ...(e.split.mode === "receipt" ? {} : { splits: withSplit({}, ownCurrencySplit({ ...e, split: e.split })) }),
    occurredAt: e.occurredAt,
    dateOnly: e.dateOnly === true,
    recordedAt: e.createdAt ?? e.occurredAt,
    categoryId: e.categoryId ?? null,
    ...receiptOf(e),
    // Percent has no tab: `legacyPercent` draws it.
    splitTab: e.split.mode === "percent" ? undefined : e.split.mode,
  };
}

export function transferDraft(s: Settlement, me: string, members: string[]): EntryDraft {
  return {
    ...blankDraft("transfer", me, s.currency, members),
    entryId: s.id,
    amountText: minorToDecimalString(s.amountMinor, s.currency),
    ...ownRate(s),
    description: s.note ?? "",
    fromMember: s.fromMember,
    toMember: s.toMember,
    occurredAt: s.occurredAt,
    dateOnly: s.dateOnly === true,
    recordedAt: s.createdAt ?? s.occurredAt,
  };
}
