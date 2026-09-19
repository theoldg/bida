"use client";

import { useSyncExternalStore } from "react";
import {
  convertSplitMode, newId, parseMinor, receiptExtras, sameLocalDay,
  type ArithmeticMode, type ArithmeticSplit, type ReceiptDiscount, type ReceiptItem, type SplitMode, type SplitSpec,
} from "@bida/core";
import type { EntryKind } from "./entry-kind";
import { receiptBreakdown, receiptTotalMinor, type MemberLine } from "./scan/items";
import { clearScan } from "./scan/live";

/**
 * Which of the split editor's four tabs is showing.
 *
 * A tab *is* a `SplitMode` — including Receipt, a mode of its own and not a
 * `shares` split wearing a flag (ADR-0016) — minus `percent`, which has no tab
 * and survives only so entries already recorded that way render (ADR-0010).
 *
 * **Never on a saved entry.** Which tab somebody had open is a fact about a
 * screen; the entry's own mode is what every screen reads back.
 */
export type SplitTab = Exclude<SplitMode, "percent">;

/** Every tab but Receipt, which derives its split from the bill instead. */
type ArithmeticTab = Exclude<SplitTab, "receipt">;

/**
 * One split per tab, each of them the tab's own.
 *
 * **One `SplitSpec` cannot hold four answers.** Sharing one means leaving
 * somebody out under Evenly deletes the parts they had under As parts, and a
 * scan overwrites all three.
 *
 * A tab is `undefined` until first opened, and `openSplitTab` fills it in from
 * whatever was on screen — a handoff made once, not a shape the tabs go on
 * sharing. `percent` is only ever read: touching any tab converts a legacy
 * split away for good (ADR-0010).
 */
export type SplitInputs = { [M in ArithmeticMode]?: Extract<SplitSpec, { mode: M }> };

/**
 * The entry being typed — an expense, an income or a transfer.
 *
 * Outside React because the form, the payers editor and the who-had-what grid
 * are separate routes and bouncing between them must not lose what you typed.
 * **In memory only.** A half-typed entry is not a fact about the world, so it
 * never reaches the op log, and it is not persisted either — a draft that
 * outlives the screen is one you get handed back without asking. Leaving
 * throws it away, after a warning (`isDraftDirty`).
 *
 * One draft covers all three kinds so changing your mind halfway keeps the
 * amount, date and words: they live in the same fields either way (ADR-0010).
 * The kind-specific ones sit unread while the other kind is showing.
 */
export interface EntryDraft {
  /** Which of the three this is. The form's kind chip writes it. */
  kind: EntryKind;
  /**
   * Present when editing rather than creating: an expense id when `kind` is
   * expense or income, a settlement id when it's a transfer.
   */
  entryId?: string;
  /**
   * The id a create will be written under, allocated with the draft.
   *
   * The leftover minor unit goes by `tiebreakSeed`, which is the entry's id
   * (core/split.ts), so pricing rows under a placeholder and then under a real
   * id hands the cent to two different people. The form allocates the id,
   * quotes the split under it, and `addExpense` writes under the id quoted.
   */
  newEntryId: string;
  /** Exactly what is typed into the amount input, e.g. "620." or "1234.5". Not a number. */
  amountText: string;
  /**
   * What the entry is denominated in. There is deliberately no rate beside it:
   * a rate is the group's, not this draft's, and the form reads it from the
   * registry (ADR-0005). Picking a currency the group has no rate for is what
   * opens the rate dialog.
   */
  currency: string;
  /** The title of an expense or income; the optional note on a transfer. */
  description: string;
  /** Who paid, or — on an income — who received. Unused by a transfer. */
  paidBy: string;
  /**
   * Co-sponsors: memberId -> minor units in `currency`, summing to the amount.
   * null is the ordinary one-payer case and stays null unless someone opens
   * the payers editor and adds a second person.
   */
  payers: Record<string, number> | null;
  splits: SplitInputs;
  /** A transfer's two sides. Empty until the form seeds them. */
  fromMember: string;
  toMember: string;
  occurredAt: number;
  /** True when `occurredAt` is a day and nothing more. See `retimed`. */
  dateOnly: boolean;
  /**
   * The clock reading this stamp's time of day came from — when the draft was
   * started, or when a scan of a receipt printed today read one. It is what
   * `retimed` measures a chosen day against; it is never saved.
   */
  recordedAt: number;
  categoryId: string | null;
  /**
   * The parsed bill, mirroring the same-named fields on `Expense`: kept here
   * while it's being typed, written onto the expense on save so "Edit
   * who-had-what" reopens it later, on any device. ADR-0016.
   */
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
  /**
   * The bill as text, when that is how it was read — typed into "Type it in"
   * rather than photographed (`BILL_TEXT_MAX` caps it). Kept so the dialog
   * reopens holding it and correcting a misread bill is an edit rather than a
   * retype. Absent on a photographed bill and on one with no scan.
   */
  receiptText?: string | null;
  /** Explicit tab choice; see `SplitTab`. */
  splitTab?: SplitTab;
  /**
   * The title the last scan put in `description`, so a second scan can
   * correct its own guess without overwriting a title somebody typed. Not a
   * field of the entry: it never leaves this draft.
   */
  scannedDescription?: string;
}

/**
 * Which split-editor tab a draft is on. Undefined — an expense saved before
 * the field existed — derives from what is actually on the entry: a scanned
 * bill means Receipt, and a legacy percent split shows in the As parts slot,
 * which is the tab that would convert it.
 */
export function activeSplitTab(draft: EntryDraft): SplitTab {
  return draft.splitTab
    ?? ((draft.receiptItems?.length ?? 0) > 0 ? "receipt"
      : draft.splits.percent ? "shares" : "equal");
}

/**
 * Which tab a scan that has just landed leaves the editor on — `undefined`
 * where it leaves it alone.
 *
 * Only a bill with lines on it is something to assign, so only that claims the
 * Items tab; a receipt that is just a total is an ordinary expense and the
 * grid never opens on it.
 *
 * **And only where nobody moved off the tab the scan started from.** A scan is
 * a round trip to a model; tapping Evenly while it reads is a decision about
 * how this expense divides, and a result landing two seconds later must not
 * overrule it. `/g/scan` passes the tab it seeded and never touched, so a scan
 * started before there is a form still arrives at one showing Items.
 */
export function tabAfterScan(
  draft: EntryDraft, tabAtStart: SplitTab, hasItems: boolean,
): SplitTab | undefined {
  if (!hasItems) return undefined;
  return activeSplitTab(draft) === tabAtStart ? "receipt" : undefined;
}

/**
 * The legacy percent split still in force, or null.
 *
 * It has no tab of its own — `percent` was dropped from the UI and only stays
 * in `SplitSpec` so expenses already recorded that way keep folding — so it
 * shows under whichever tab is derived for it, with none of them pressed,
 * until the first tap converts it away.
 */
export function legacyPercent(draft: EntryDraft): SplitSpec | null {
  return draft.splitTab === undefined && (draft.receiptItems?.length ?? 0) === 0
    ? draft.splits.percent ?? null
    : null;
}

/**
 * What rounding ties break by, everywhere this draft is priced: the id of the
 * entry being edited, or the one a create will be written under. Every screen
 * that shows a person a figure asks for it here, so the cent the form quotes
 * is the cent the ledger keeps.
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
 * The same inputs with one tab's spec replaced.
 *
 * A receipt split is not one of them and cannot be typed here: its weights are
 * the bill's, and handing them to As parts is the scan talking on a screen it
 * does not own (`openSplitTab`, ADR-0016).
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
 * What the bill owes each person, in the receipt's own currency, as weights:
 * every item's printed amount divided among whoever was checked for it, summed
 * per member, with the tip scaled to what each of them ordered.
 *
 * Two screens ask this of the same bill — the grid, of the rows in front of
 * you, and the form, of those rows once Done wrote them down — so it takes the
 * rows rather than reading them off the draft. They must answer identically:
 * dividing a line leaves a remainder cent, and a cent landing on a different
 * person between screens is a figure quoted and not kept. Only `tiebreakSeed`
 * decides where it lands, so **the seed is named here and offered to neither
 * caller**.
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
 * The same reading, with each person's own lines of the bill beside their
 * figure — what `receiptWeights` is the totals half of.
 *
 * A saved expense asks `receiptBreakdown` directly, seeded by the entry's id.
 * A draft cannot: the seed is `splitSeed`'s to name, for the reason above, and
 * a quick split reads its answer off a bill that will never become an entry
 * ([ADR-0035](../../../docs/decisions/0035-a-quick-split-is-a-bill-with-no-group.md)).
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
 * What the bill says the split is, while Receipt mode is the thing showing
 * it, and null until the who-had-what grid has been filled in.
 *
 * The weights apply to the entry's converted total, so nothing here needs a
 * rate (ADR-0016). **Derived at read time, never written into the draft**: the
 * raw grid is the only record. It comes back as a `receipt` split, so no
 * screen downstream works the mode out from a flag beside it.
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
 * What the tab now showing holds — the rows the split editor draws, and what
 * a tab opened for the first time is handed.
 *
 * Receipt's is read off the bill rather than typed, which is why leaving it
 * for an untouched tab starts that tab from what the receipt worked out. It
 * falls back to Evenly's, rather than to nothing, while the grid is unfilled.
 */
export function activeSplit(draft: EntryDraft): SplitSpec {
  return (activeSplitTab(draft) === "receipt" ? draftReceiptSplit(draft) : null)
    ?? arithmeticSplit(draft);
}

/**
 * What the arithmetic tabs hold, with the bill left out of it.
 *
 * The same answer as `activeSplit` on any tab but Receipt; on Receipt it is
 * where the three would stand had nothing been scanned. This is the only basis
 * a tab is ever handed, so the handoff runs one way: the arithmetic tabs feed
 * each other, and a scan feeds none of them (ADR-0016).
 */
function arithmeticSplit(draft: EntryDraft): SplitSpec {
  const legacy = legacyPercent(draft);
  if (legacy) return legacy;
  const tab = activeSplitTab(draft);
  const arithmetic: ArithmeticTab = tab === "receipt" ? "equal" : tab;
  return draft.splits[arithmetic] ?? emptySplit(arithmetic);
}

/**
 * Opening a tab: the inputs the draft should carry once it is showing.
 *
 * A tab keeps whatever was last typed into it. One opened for the first time
 * is handed what the *arithmetic* tabs hold — `convertSplitMode` over
 * `arithmeticSplit` — because an empty As amounts is four numbers to type
 * where "even, then nudge one person" is one. A handoff made once in a
 * handler, not a mirror any later edit resyncs.
 *
 * **A scanned bill is never that basis.** Its weights arriving in As parts
 * read as parts somebody chose, and are really the scan talking on a screen it
 * does not own ([ADR-0016](../../../docs/decisions/0016-receipts.md)).
 */
export function openSplitTab(draft: EntryDraft, tab: SplitTab, totalMinor: number): SplitInputs {
  if (tab === "receipt") return draft.splits;
  const kept = { ...draft.splits };
  // Unwritable, so there is nothing to come back to: the first arithmetic tab
  // converts a legacy percent split away for good (ADR-0010).
  delete kept.percent;
  if (kept[tab]) return kept;
  return withSplit(kept, convertSplitMode(totalMinor, arithmeticSplit(draft), tab, {
    tiebreakSeed: splitSeed(draft),
  }));
}

/**
 * The bill's own total — every line plus the tip — while Receipt mode is the
 * thing showing it, and null otherwise.
 *
 * Derived at read time, **never written into the draft** as a cache for
 * another screen's effect to notice (ADR-0016). Null on a total of zero or
 * less as well as on no bill: the form disables the amount field on a real
 * derived number, and disabled *and* empty is a screen with nothing to type in
 * and a Save that will never light.
 */
export function draftReceiptTotal(draft: EntryDraft): number | null {
  const showing = draft.kind === "expense"
    && activeSplitTab(draft) === "receipt" && (draft.receiptItems?.length ?? 0) > 0;
  if (!showing) return null;
  const total = receiptTotalMinor(draft.receiptItems ?? [], receiptExtras(draft), draft.currency);
  return total !== null && total > 0 ? total : null;
}

/**
 * What the entry is worth, in its own currency — the bill's total when
 * Receipt mode is deriving it, else what was typed.
 *
 * **One function, asked by every screen.** A screen reading `amountText`
 * directly thinks a scanned expense is worth zero.
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

const listeners = new Set<() => void>();
const drafts = new Map<string, EntryDraft | undefined>();
/** What the draft looked like when the screen seeded it, to tell edits from nothing. */
const baselines = new Map<string, string>();
/** Which entry the draft was seeded *for* — see `draftSeedKey`. */
const seedKeys = new Map<string, string>();

function emit(): void {
  for (const l of listeners) l();
}

/**
 * A day chosen on the form, and what that does to the entry's time.
 *
 * An entry's clock is never typed — the form has a date and no time — so it
 * holds the reading taken when the entry was recorded. Left on that day it
 * means something. Moved to another one it is a leftover, and printing it
 * claims an hour nobody knew, so the entry becomes `dateOnly`, exactly as a
 * backdated receipt does.
 *
 * Coming back to the recording day restores the reading rather than the 00:00
 * a backdated stamp was parked at — but only for a stamp that had no time to
 * begin with, because re-picking the day an entry is already on must not move
 * it by the seconds between opening the form and saving it.
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
 * First write for a screen: `saveDraft` plus the baseline and what the draft
 * was seeded *for*.
 *
 * `key` identifies the entry the form was opened on — its id when editing, and
 * what the link asked for when creating (which kind, and a transfer's
 * pre-filled sides and amount). The form re-mounts on every return from the
 * payers editor or the grid, so it must keep a draft it already has; a
 * *different* key means a different entry was asked for, and handing that one
 * a leftover draft opens settle-up on a blank expense.
 */
export function seedDraft(groupId: string, draft: EntryDraft, key: string): void {
  baselines.set(groupId, JSON.stringify(draft));
  seedKeys.set(groupId, key);
  saveDraft(groupId, draft);
}

/**
 * What a *create* was asked for, as one string — see `seedDraft`'s `key`.
 *
 * **Built here and nowhere else.** Two screens have to agree on it exactly:
 * the form, which keeps a draft whose key matches and replaces one whose key
 * doesn't, and `/g/scan`, which fills a draft under this key so the form
 * adopts it rather than seeding a blank over the receipt. A string built in
 * both places drifts, and the failure is silent — the scan lands on an empty
 * form.
 */
export function newEntryKey(
  kind: string | null | undefined,
  prefill?: { from?: string; to?: string; amount?: number; title?: string },
): string {
  // The title is part of the key, not decoration: a named expense (the tip
  // screen's) and a blank one are different asks, and without it the form
  // adopts whichever draft is already there and the name silently vanishes.
  return `new:${kind ?? "expense"}:${prefill?.from ?? ""}:${prefill?.to ?? ""}`
    + `:${prefill?.amount || 0}:${prefill?.title ?? ""}`;
}

/** What the live draft was seeded for, or undefined if there isn't one. */
export function draftSeedKey(groupId: string): string | undefined {
  return drafts.get(groupId) ? seedKeys.get(groupId) : undefined;
}

export function clearDraft(groupId: string): void {
  drafts.set(groupId, undefined);
  baselines.delete(groupId);
  seedKeys.delete(groupId);
  // A scan belongs to the draft it fills. Throwing the draft away leaves
  // nothing for one still in flight to land in — it drops its result on
  // arrival — so the "Reading…" strip goes with it rather than greeting the
  // next expense.
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
    (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange); },
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
    // Empty, never a literal "0": a real character has a caret that can land
    // either side of it, so tapping in and typing "5" gives you "50". The
    // underline and muted "0" placeholder make it look like an input instead.
    amountText: "",
    currency,
    description: "",
    paidBy: me,
    payers: null,
    splits: { equal: { mode: "equal", members } },
    splitTab: "equal",
    // A transfer starts as "me, paying somebody else" — the overwhelmingly
    // common one, and the only pair that can be guessed without asking.
    fromMember: me,
    toMember: members.find((id) => id !== me) ?? me,
    occurredAt: started,
    recordedAt: started,
    // Whatever is being typed is being typed now, so it has a time.
    dateOnly: false,
    categoryId: null,
  };
}
