"use client";

import { useSyncExternalStore } from "react";
import {
  convertSplitMode, newId, parseMinor, receiptExtras, sameLocalDay,
  type ArithmeticMode, type ArithmeticSplit, type ReceiptDiscount, type ReceiptItem, type SplitMode, type SplitSpec,
} from "@bida/core";
import type { EntryKind } from "./entry-kind";
import { receiptBreakdown, receiptTotalMinor, type MemberLine } from "./scan/items";
import { clearScan } from "./scan/live";
import { signal } from "./signal";

/**
 * Which split-editor tab is showing: a `SplitMode` minus `percent`, which has
 * no tab and survives only so old entries render (ADR-0010). Never saved on an
 * entry — the entry's own mode is what every screen reads back.
 */
export type SplitTab = Exclude<SplitMode, "percent">;

/** Every tab but Receipt, which derives its split from the bill instead. */
type ArithmeticTab = Exclude<SplitTab, "receipt">;

/**
 * One split per tab. A shared `SplitSpec` would let leaving somebody out under
 * Evenly delete their As-parts parts, and a scan overwrite all three.
 * `undefined` until first opened (`openSplitTab`); `percent` is read-only.
 */
export type SplitInputs = { [M in ArithmeticMode]?: Extract<SplitSpec, { mode: M }> };

/**
 * The entry being typed. Outside React so bouncing between the form, payers
 * editor and grid routes keeps it. **In memory only** — never on the op log,
 * never persisted; leaving discards it after a warning (`isDraftDirty`).
 * One draft covers all three kinds so switching kind keeps amount, date and words.
 */
export interface EntryDraft {
  /** Which of the three this is. The form's kind chip writes it. */
  kind: EntryKind;
  /**
   * Present when editing rather than creating: an expense id when `kind` is
   * expense or income, a settlement id when it's a transfer. An edit never
   * crosses between the two (ADR-0010).
   */
  entryId?: string;
  /**
   * The id a create will be written under. The leftover cent goes by the
   * entry's id (`tiebreakSeed`), so the split must be quoted under the id that
   * is actually written.
   */
  newEntryId: string;
  /** Exactly what is typed, e.g. "620." — not a number. */
  amountText: string;
  /** No rate beside it: rates are the group's (ADR-0005). */
  currency: string;
  /** The title of an expense or income; the optional note on a transfer. */
  description: string;
  /** Who paid, or — on an income — who received. Unused by a transfer. */
  paidBy: string;
  /** Co-payers: memberId -> minor units summing to the amount; null for one payer. */
  payers: Record<string, number> | null;
  splits: SplitInputs;
  /** A transfer's two sides. Empty until the form seeds them. */
  fromMember: string;
  toMember: string;
  occurredAt: number;
  /** True when `occurredAt` is a day and nothing more. See `retimed`. */
  dateOnly: boolean;
  /** The clock reading the time of day came from; what `retimed` measures against. Never saved. */
  recordedAt: number;
  categoryId: string | null;
  /** The parsed bill, as on `Expense`; saved so "Edit who-had-what" reopens it anywhere. ADR-0016. */
  receiptItems?: ReceiptItem[] | null;
  /** A separate tip/service line from the same scan, printed as-is. */
  receiptTip?: string | null;
  /** Tax charged on top of the lines, printed as-is. `BillExtras`. */
  receiptTax?: string | null;
  /** What the bill took off, one entry per printed deduction. `BillExtras`. */
  receiptDiscounts?: ReceiptDiscount[] | null;
  /** Who was marked present, last time the who-had-what grid was saved. */
  receiptInvolved?: string[] | null;
  /** Per-item member ids, same order as `receiptItems`, last time it was saved. */
  receiptAssignments?: string[][] | null;
  /** The bill as typed into "Type it in", so the dialog reopens holding it. */
  receiptText?: string | null;
  /** Explicit tab choice; see `SplitTab`. */
  splitTab?: SplitTab;
  /** The title the last scan wrote, so a rescan can replace its own guess but not a typed title. */
  scannedDescription?: string;
}

/**
 * Which tab a draft is on. Unset (saved before the field existed) derives from
 * the entry: a scanned bill means Receipt, a legacy percent split As parts.
 */
export function activeSplitTab(draft: EntryDraft): SplitTab {
  return draft.splitTab
    ?? ((draft.receiptItems?.length ?? 0) > 0 ? "receipt"
      : draft.splits.percent ? "shares" : "equal");
}

/**
 * The tab a finished scan switches to, or `undefined` to leave it. Only a bill
 * with lines claims Receipt, and only if nobody moved off `tabAtStart` while it
 * read — a tap during the scan must not be overruled by its result.
 */
export function tabAfterScan(
  draft: EntryDraft, tabAtStart: SplitTab, hasItems: boolean,
): SplitTab | undefined {
  if (!hasItems) return undefined;
  return activeSplitTab(draft) === tabAtStart ? "receipt" : undefined;
}

/**
 * The legacy percent split still in force, or null. It has no tab, so it shows
 * under the derived one with none pressed until the first tap converts it.
 */
export function legacyPercent(draft: EntryDraft): SplitSpec | null {
  return draft.splitTab === undefined && (draft.receiptItems?.length ?? 0) === 0
    ? draft.splits.percent ?? null
    : null;
}

/**
 * The id rounding ties break by: the entry being edited, or the one a create
 * will be written under — so the cent the form quotes is the cent kept.
 */
export function splitSeed(draft: EntryDraft): string {
  return draft.entryId ?? draft.newEntryId;
}

/** A tab nothing has been typed into yet: everybody out, nothing allocated. */
function emptySplit(tab: ArithmeticTab): SplitSpec {
  switch (tab) {
    case "equal": return { mode: "equal", members: [] };
    case "shares": return { mode: "shares", weights: {} };
    case "exact": return { mode: "exact", amounts: {} };
  }
}

/**
 * The inputs with one tab's spec replaced. Receipt can't be set here: its
 * weights are the bill's (ADR-0016).
 */
export function withSplit(splits: SplitInputs, spec: ArithmeticSplit): SplitInputs {
  switch (spec.mode) {
    case "equal": return { ...splits, equal: spec };
    case "shares": return { ...splits, shares: spec };
    case "exact": return { ...splits, exact: spec };
    case "percent": return { ...splits, percent: spec };
  }
}

/**
 * What the bill owes each person as weights, in the receipt's currency: each
 * line divided among whoever had it, tip scaled to what they ordered.
 *
 * The grid and the form both ask this and must agree to the cent, so the seed
 * is fixed here and not left to either caller.
 */
export function receiptWeights(
  draft: EntryDraft,
  items: readonly ReceiptItem[],
  assignments: readonly Set<string>[],
  involved: ReadonlySet<string>,
): Record<string, number> {
  return receiptBill(draft, items, assignments, involved).weights;
}

/**
 * `receiptWeights` with each person's lines beside their figure. A draft can't
 * call `receiptBreakdown` directly because the seed is `splitSeed`'s to name.
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

/**
 * The bill's split while Receipt is showing, null until the grid is filled.
 * Derived at read time and never written into the draft — the grid is the
 * only record (ADR-0016).
 */
export function draftReceiptSplit(draft: EntryDraft): SplitSpec | null {
  const showing = draft.kind === "expense"
    && activeSplitTab(draft) === "receipt" && (draft.receiptItems?.length ?? 0) > 0;
  if (!showing) return null;
  const weights = receiptWeights(
    draft,
    draft.receiptItems ?? [],
    (draft.receiptAssignments ?? []).map((row) => new Set(row)),
    new Set(draft.receiptInvolved ?? []),
  );
  return Object.keys(weights).length > 0 ? { mode: "receipt", weights } : null;
}

/**
 * What the showing tab holds. Receipt's is derived from the bill, falling back
 * to Evenly's while the grid is unfilled.
 */
export function activeSplit(draft: EntryDraft): SplitSpec {
  return (activeSplitTab(draft) === "receipt" ? draftReceiptSplit(draft) : null)
    ?? arithmeticSplit(draft);
}

/**
 * The arithmetic tabs' split, ignoring the bill. The only basis a newly
 * opened tab is handed, so a scan never feeds As parts (ADR-0016).
 */
function arithmeticSplit(draft: EntryDraft): SplitSpec {
  const legacy = legacyPercent(draft);
  if (legacy) return legacy;
  const tab = activeSplitTab(draft);
  const arithmetic: ArithmeticTab = tab === "receipt" ? "equal" : tab;
  return draft.splits[arithmetic] ?? emptySplit(arithmetic);
}

/**
 * The inputs once `tab` is showing. A tab keeps what was typed into it; one
 * opened for the first time is converted from `arithmeticSplit` — once, in a
 * handler, not kept in sync. A scanned bill is never the basis: its weights
 * would read as parts somebody chose.
 */
export function openSplitTab(draft: EntryDraft, tab: SplitTab, totalMinor: number): SplitInputs {
  if (tab === "receipt") return draft.splits;
  const kept = { ...draft.splits };
  // The first arithmetic tab converts a legacy percent split away for good.
  delete kept.percent;
  if (kept[tab]) return kept;
  return withSplit(kept, convertSplitMode(totalMinor, arithmeticSplit(draft), tab, {
    tiebreakSeed: splitSeed(draft),
  }));
}

/**
 * The bill's total (lines plus tip) while Receipt is showing, else null.
 * Never cached in the draft (ADR-0016). Null for ≤ 0 too: the form disables
 * the amount on a derived number, and disabled-and-empty can never save.
 */
export function draftReceiptTotal(draft: EntryDraft): number | null {
  const showing = draft.kind === "expense"
    && activeSplitTab(draft) === "receipt" && (draft.receiptItems?.length ?? 0) > 0;
  if (!showing) return null;
  const total = receiptTotalMinor(draft.receiptItems ?? [], receiptExtras(draft), draft.currency);
  return total !== null && total > 0 ? total : null;
}

/**
 * What the entry is worth: the bill's total under Receipt, else what was typed.
 * Every screen asks this — reading `amountText` makes a scanned expense zero.
 */
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
/** What the draft looked like when the screen seeded it, to tell edits from nothing. */
const baselines = new Map<string, string>();
/** Which entry the draft was seeded *for* — see `draftSeedKey`. */
const seedKeys = new Map<string, string>();

/**
 * The entry's time once a day is picked. The form has no time field, so the
 * stamp holds when it was recorded; moved to another day that hour is
 * meaningless and the entry becomes `dateOnly`. Moving back to the recording
 * day restores the reading — but only for a stamp that had no time, so
 * re-picking the current day doesn't shift it.
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
 * First write for a screen: `saveDraft` plus a baseline and the seed key.
 * The form remounts on every return from payers or the grid and must keep its
 * draft; a *different* key means a different entry was asked for, and must not
 * inherit a leftover draft.
 */
export function seedDraft(groupId: string, draft: EntryDraft, key: string): void {
  baselines.set(groupId, JSON.stringify(draft));
  seedKeys.set(groupId, key);
  saveDraft(groupId, draft);
}

/**
 * The seed key for a create. Built only here: the form and `/g/scan` must
 * agree on it exactly, or the scan silently lands on an empty form.
 */
export function newEntryKey(
  kind: string | null | undefined,
  prefill?: { title?: string },
): string {
  // The title is part of the key: a named expense (the tip screen's) and a blank
  // one are different asks, and without it the name silently vanishes.
  return `new:${kind ?? "expense"}:${prefill?.title ?? ""}`;
}

/** What the live draft was seeded for, or undefined if there isn't one. */
export function draftSeedKey(groupId: string): string | undefined {
  return drafts.get(groupId) ? seedKeys.get(groupId) : undefined;
}

export function clearDraft(groupId: string): void {
  drafts.set(groupId, undefined);
  baselines.delete(groupId);
  seedKeys.delete(groupId);
  // A scan still in flight drops its result once its draft is gone, so the
  // "Reading…" strip goes too.
  clearScan(groupId);
  emit();
}

/** True once anything has been typed or changed since the screen opened. */
export function isDraftDirty(groupId: string): boolean {
  const draft = drafts.get(groupId);
  if (!draft) return false;
  return JSON.stringify(draft) !== baselines.get(groupId);
}

export function getDraft(groupId: string): EntryDraft | undefined {
  return drafts.get(groupId);
}

/** Reactive read. Returns undefined until a draft is started. */
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
    // Empty, never "0": a real character lets the caret land after it, so typing
    // "5" gives "50". The placeholder draws the 0.
    amountText: "",
    currency,
    description: "",
    paidBy: me,
    payers: null,
    splits: { equal: { mode: "equal", members } },
    splitTab: "equal",
    // The one pair that can be guessed without asking.
    fromMember: me,
    toMember: members.find((id) => id !== me) ?? me,
    occurredAt: started,
    recordedAt: started,
    // Whatever is being typed is being typed now, so it has a time.
    dateOnly: false,
    categoryId: null,
  };
}
