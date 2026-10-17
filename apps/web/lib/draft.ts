"use client";
// Doc: docs/entry.md#the-draft

import { useSyncExternalStore } from "react";
import {
  convertSplitMode, minorToDecimalString, newId, ownCurrencySplit, parseMinor, receiptExtras, receiptOf,
  sameLocalDay,
  type ArithmeticMode, type ArithmeticSplit, type EntryRateSource, type Expense, type Receipt, type ReceiptItem,
  type Settlement, type SplitMode, type SplitSpec,
} from "@bida/core";
import { kindOf, type EntryKind } from "./entry-kind";
import { dateInputValue } from "./format";
import { billExtrasIn, billLabels, receiptBreakdown, receiptTotalMinor, type MemberLine } from "./scan/items";
import { clearScan } from "./scan/live";
import { signal } from "./signal";

export type SplitTab = SplitMode;

/**
 * One per tab: a shared spec would let leaving somebody out under Evenly
 * delete their parts under As parts. `undefined` until first opened.
 */
export type SplitInputs = { [M in ArithmeticMode]?: Extract<ArithmeticSplit, { mode: M }> };

/**
 * Outside React, so moving between the form, payers and grid keeps it. In
 * memory only. One shape for all three kinds, so switching kind keeps what was typed.
 */
export interface EntryDraft extends Receipt {
  kind: EntryKind;
  entryId?: string;
  /** The leftover cent goes by the entry's id, so the quote must use the one written. */
  newEntryId: string;
  amountText: string;
  currency: string;
  /**
   * Read only while `rateCurrency` is the draft's currency; a change of either
   * sends `useEntryRate` to the feed (ADR-0005).
   */
  rate?: string;
  rateSource?: EntryRateSource;
  rateCurrency?: string;
  rateDay?: string;
  /** So a date moved away and back finds the saved rate again. */
  savedRate?: { rate: string; source: EntryRateSource; currency: string; day: string };
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
  recordedAt: number;
  categoryId: string | null;
  /**
   * The one thing that says which tab shows. A saved entry reopens on its mode.
   */
  splitTab: SplitTab;
  /** So a rescan can replace its own guess but not a typed title. */
  scannedDescription?: string;
}

/** A tap during the scan must not be overruled by its result. */
export function tabAfterScan(
  draft: EntryDraft, tabAtStart: SplitTab, hasItems: boolean,
): SplitTab | undefined {
  if (!hasItems) return undefined;
  return draft.splitTab === tabAtStart ? "receipt" : undefined;
}

/** So the cent the form quotes is the cent kept. */
export function splitSeed(draft: EntryDraft): string {
  return draft.entryId ?? draft.newEntryId;
}

function emptySplit(tab: ArithmeticMode): ArithmeticSplit {
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
  }
}

/**
 * The grid, form and quick split must agree to the cent, so the seed is fixed
 * here.
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

/** Seeded with the entry's id, the seed its weights were saved with. */
export function savedBill(expense: Expense, english: boolean): Record<string, MemberLine[]> | null {
  if (expense.split.mode !== "receipt" || !expense.receiptItems?.length) return null;
  return receiptBreakdown(
    billLabels(expense.receiptItems, english),
    (expense.receiptAssignments ?? []).map((row) => new Set(row)),
    billExtrasIn(receiptExtras(expense), english),
    new Set(expense.receiptInvolved ?? []),
    expense.currency,
    expense.id,
  ).lines;
}

function showsReceipt(draft: EntryDraft): boolean {
  return draft.kind === "expense"
    && draft.splitTab === "receipt" && (draft.receiptItems?.length ?? 0) > 0;
}

/**
 * Every line has somebody. Asked of the draft, not just "anybody ticked": an
 * item added in Bill items after the grid comes back with nobody on it.
 */
export function billAssigned(draft: Pick<EntryDraft, "receiptItems" | "receiptAssignments">): boolean {
  const items = draft.receiptItems ?? [];
  const rows = draft.receiptAssignments ?? [];
  return items.length > 0 && rows.length === items.length && rows.every((row) => row.length > 0);
}

/** Null until the grid is filled. Never written into the draft: the grid is the record. */
export function draftReceiptSplit(draft: EntryDraft): SplitSpec | null {
  if (!showsReceipt(draft) || !billAssigned(draft)) return null;
  const { weights } = receiptBill(
    draft,
    draft.receiptItems ?? [],
    (draft.receiptAssignments ?? []).map((row) => new Set(row)),
    new Set(draft.receiptInvolved ?? []),
  );
  return Object.keys(weights).length > 0 ? { mode: "receipt", weights } : null;
}

/** What a save writes. Receipt falls back to Evenly while the grid is unfilled. */
export function activeSplit(draft: EntryDraft): SplitSpec {
  return draftReceiptSplit(draft) ?? arithmeticSplit(draft);
}

/** Ignores the bill, so a scan never feeds As parts (ADR-0016). */
export function arithmeticSplit(draft: EntryDraft): ArithmeticSplit {
  const tab: ArithmeticMode = draft.splitTab === "receipt" ? "equal" : draft.splitTab;
  return draft.splits[tab] ?? emptySplit(tab);
}

/** A tab opened for the first time starts from who is in, never the numbers. */
export function openSplitTab(draft: EntryDraft, tab: SplitTab): SplitInputs {
  const opened: ArithmeticMode = tab === "receipt" ? "equal" : tab;
  if (draft.splitTab === tab || draft.splits[opened]) return draft.splits;
  return withSplit(draft.splits, convertSplitMode(arithmeticSplit(draft), opened));
}

/**
 * Leaving Items puts the bill's total in the amount field, or the expense
 * silently becomes worth zero (ADR-0016).
 */
export function changeSplitTab(
  draft: EntryDraft, tab: SplitTab,
): Pick<EntryDraft, "splitTab" | "splits" | "amountText"> {
  const total = tab === "receipt" ? null : draftReceiptTotal(draft);
  return {
    splitTab: tab,
    splits: openSplitTab(draft, tab),
    // Not `bare`, which groups thousands that `parseMinor` can't read back.
    amountText: total === null ? draft.amountText : minorToDecimalString(total, draft.currency),
  };
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

/** No time field, so on another day the recorded hour is meaningless. */
export function retimed(draft: EntryDraft, occurredAt: number): Pick<EntryDraft, "occurredAt" | "dateOnly"> {
  if (!sameLocalDay(occurredAt, draft.recordedAt)) return { occurredAt, dateOnly: true };
  return { occurredAt: draft.dateOnly ? draft.recordedAt : occurredAt, dateOnly: false };
}

export function saveDraft(groupId: string, draft: EntryDraft): void {
  drafts.set(groupId, draft);
  emit();
}

/** A different key is a different entry, which mustn't inherit the draft. */
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

/** So opening it to edit looks nothing up (ADR-0005). */
const KNOWN_MODES: ReadonlySet<string> = new Set<SplitTab>(["equal", "shares", "exact", "receipt"]);

function ownRate(
  e: Expense | Settlement,
): Pick<EntryDraft, "rate" | "rateSource" | "rateCurrency" | "rateDay" | "savedRate"> {
  const held = {
    rate: e.rateToBase,
    rateSource: e.rateSource ?? "group",
    rateCurrency: e.currency,
    rateDay: dateInputValue(e.occurredAt),
  };
  return {
    ...held,
    savedRate: { rate: held.rate, source: held.rateSource, currency: held.rateCurrency, day: held.rateDay },
  };
}

export function expenseDraft(e: Expense, me: string, members: string[]): EntryDraft {
  const known = KNOWN_MODES.has(e.split.mode);
  return {
    ...blankDraft(kindOf(e), me, e.currency, members),
    entryId: e.id,
    // Never `bare`, which groups thousands: "25,000" JPY parses back as 25.
    amountText: minorToDecimalString(e.amountMinor, e.currency),
    ...ownRate(e),
    description: e.description,
    paidBy: e.paidBy,
    payers: e.payers ?? null,
    // A mode this build doesn't know opens on Evenly.
    ...(e.split.mode === "receipt" || !known ? {} : { splits: withSplit({}, ownCurrencySplit({ ...e, split: e.split })) }),
    occurredAt: e.occurredAt,
    dateOnly: e.dateOnly === true,
    recordedAt: e.createdAt ?? e.occurredAt,
    categoryId: e.categoryId ?? null,
    ...receiptOf(e),
    splitTab: known ? e.split.mode : "equal",
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
