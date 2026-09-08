"use client";

import { useSyncExternalStore } from "react";
import {
  convertSplitMode, newId, parseMinor,
  type ReceiptItem, type SplitMode, type SplitSpec, type SplitTab,
} from "@hajsik/core";
import type { EntryKind } from "./entry-kind";
import { receiptTotalMinor, weightsFromItems } from "./scan/items";

/**
 * The entry being typed — an expense, an income or a transfer. It lives outside
 * React because several screens share it: the form, the payers editor and the
 * who-had-what grid are separate routes, and bouncing between them must not
 * lose what you've entered. In memory only: a half-typed entry is not a fact
 * about the world yet, so it never reaches the op log other devices read, and
 * it is not persisted either — a draft that outlives the screen is a draft you
 * get handed back without asking. Leaving the screen throws it away, after a
 * warning (`isDraftDirty`).
 *
 * One draft covers all three kinds so that changing your mind halfway keeps
 * what you already typed: the amount, the date and the words survive a tap on
 * the segmented control, because the fields they live in are the same fields
 * (ADR-0010). The ones only a transfer uses (`fromMember`, `toMember`) and the
 * ones only an expense or income uses (`splits`, `payers`, the receipt) simply
 * sit unread while the other kind is showing.
 */
export type { SplitTab };

/** Every tab but Receipt, which derives its split from the bill instead. */
export type ArithmeticTab = Exclude<SplitTab, "receipt">;

/**
 * One split per tab, each of them the tab's own.
 *
 * The four tabs used to share a single `SplitSpec`, converted from one shape
 * to another on every switch — so leaving somebody out under Evenly deleted
 * the parts you had given them under As parts, typing amounts was only
 * offered for whoever Evenly had ticked, and a scan overwrote all three. One
 * spec cannot hold four answers; this holds four.
 *
 * A tab is `undefined` until it is first opened, and `openSplitTab` fills it
 * in from whatever was on screen — so "start even, then nudge one person"
 * still works, and is a handoff made once rather than a shape the tabs go on
 * sharing. `percent` is only ever read: it is what a legacy split arrives as,
 * and touching any tab converts it away for good (ADR-0010).
 */
export type SplitInputs = { [M in SplitMode]?: Extract<SplitSpec, { mode: M }> };

export interface EntryDraft {
  /** Which of the three this is. The form's segmented control writes it. */
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
   * (core/split.ts) — so a form pricing its rows under a placeholder and a
   * ledger pricing them under a real id hand the cent to two different people,
   * and the screen that asked disagreed with what it wrote. There is nothing
   * to look up: the form allocates the id, quotes the split under it, and
   * `addExpense` writes the entry under the id already quoted.
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
  categoryId: string | null;
  /**
   * The parsed bill, mirroring the same-named fields on `Expense` — kept here
   * while it's being typed, then written onto the expense itself on save so
   * "Edit who-had-what" can reopen it later, on any device. ADR-0016.
   */
  receiptItems?: ReceiptItem[] | null;
  /** A separate tip/service line from the same scan, printed as-is. */
  receiptTip?: string | null;
  /** Who was marked present, last time the who-had-what grid was saved. */
  receiptInvolved?: string[] | null;
  /** Per-item member ids, same order as `receiptItems`, last time it was saved. */
  receiptAssignments?: string[][] | null;
  /** Explicit tab choice; see `SplitTab`. */
  splitTab?: SplitTab;
  /**
   * The merchant the last scan put in `description`, so a second scan can
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

/** The same inputs with one tab's spec replaced. */
export function withSplit(splits: SplitInputs, spec: SplitSpec): SplitInputs {
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
 * Two screens ask this of the same bill — the grid, of the rows being edited
 * in front of you, and the form, of those rows once Done has written them down
 * — so it takes the rows rather than reading them off the draft. They have to
 * answer identically: dividing a line leaves a remainder cent, and a cent that
 * lands on a different person between one screen and the next is a figure
 * quoted and not kept. Only `tiebreakSeed` decides where it lands, so the seed
 * is named here and offered to neither caller. That is the whole point of this
 * function: the grid had been seeding its rows with the string `"new"`, from
 * before the draft carried the id its entry would be written under, and priced
 * a €76.50 bill a cent away from what the form then saved.
 */
export function receiptWeights(
  draft: EntryDraft,
  items: readonly ReceiptItem[],
  assignments: readonly Set<string>[],
  involved: ReadonlySet<string>,
): Record<string, number> {
  return weightsFromItems(
    [...items],
    [...assignments],
    draft.receiptTip ? { amount: draft.receiptTip, members: new Set(involved) } : null,
    draft.currency,
    splitSeed(draft),
  );
}

/**
 * What the bill says the split is, while Receipt mode is the thing showing
 * it, and null until the who-had-what grid has been filled in.
 *
 * The weights are used against the entry's converted total — so nothing here
 * needs a rate (ADR-0016). Derived at read time beside `draftReceiptTotal`,
 * never written into the draft: the raw grid is the only record, and this is
 * the one place it is read as a split.
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
  return Object.keys(weights).length > 0 ? { mode: "shares", weights } : null;
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
 * where the three would be standing had nothing been scanned — Evenly over
 * everyone, on a draft that has not been touched. This is the only basis a
 * tab is ever handed, so the handoff runs one way: the arithmetic tabs feed
 * each other, and a scan feeds none of them (ADR-0016).
 */
export function arithmeticSplit(draft: EntryDraft): SplitSpec {
  const legacy = legacyPercent(draft);
  if (legacy) return legacy;
  const tab = activeSplitTab(draft);
  const arithmetic: ArithmeticTab = tab === "receipt" ? "equal" : tab;
  return draft.splits[arithmetic] ?? emptySplit(arithmetic);
}

/**
 * Opening a tab: the inputs the draft should carry once it is showing.
 *
 * A tab keeps whatever was last typed into it. An arithmetic tab being opened
 * for the first time is handed what the *arithmetic* tabs hold —
 * `convertSplitMode` over `arithmeticSplit` — because an empty As amounts is
 * four numbers to type where "even, then nudge one person" is one. That is a
 * handoff, made once, in a handler, and not a mirror any later edit resyncs.
 *
 * **A scanned bill is never that basis.** Leaving Receipt for As parts used to
 * arrive at the grid's weights already filled in, which read as parts somebody
 * had chosen and were really the scan talking on a screen it does not own. The
 * arithmetic tabs start where they would have had nothing been scanned
 * ([ADR-0016](../../../docs/decisions/0016-receipts.md)).
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
 * Derived at read time, never written into the draft as a cache for some
 * other screen's effect to notice (ADR-0016). Null on a total of zero or less
 * as well as on no bill at all: the form disables the amount field on a real
 * derived number, and a field that is disabled *and* empty is a screen with
 * nothing to type in and a Save that will never light.
 */
export function draftReceiptTotal(draft: EntryDraft): number | null {
  const showing = draft.kind === "expense"
    && activeSplitTab(draft) === "receipt" && (draft.receiptItems?.length ?? 0) > 0;
  if (!showing) return null;
  const total = receiptTotalMinor(draft.receiptItems ?? [], draft.receiptTip ?? null, draft.currency);
  return total !== null && total > 0 ? total : null;
}

/**
 * What the entry is worth, in its own currency — the bill's total when
 * Receipt mode is deriving it, else what was typed.
 *
 * One function because two screens working it out apart is how the payers
 * editor came to think a scanned expense was worth €0.00 while the form it
 * was opened from said €48.30: the form knew about the bill, and the payers
 * editor only ever read `amountText`.
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

export function saveDraft(groupId: string, draft: EntryDraft): void {
  drafts.set(groupId, draft);
  emit();
}

/**
 * First write for a screen: the same as `saveDraft`, but it also sets the
 * baseline and records what the draft was seeded *for*.
 *
 * `key` identifies the entry the form was opened on — the entry's id when
 * editing, and what the link asked for when creating (which kind, and a
 * transfer's pre-filled sides and amount). The form re-mounts every time you
 * come back from the payers editor or the who-had-what grid, so it must keep
 * a draft it already has; but a *different* key means a different entry was
 * asked for, and handing that one a leftover draft is how settling up opened
 * a blank expense.
 */
export function seedDraft(groupId: string, draft: EntryDraft, key: string): void {
  baselines.set(groupId, JSON.stringify(draft));
  seedKeys.set(groupId, key);
  saveDraft(groupId, draft);
}

/** What the live draft was seeded for, or undefined if there isn't one. */
export function draftSeedKey(groupId: string): string | undefined {
  return drafts.get(groupId) ? seedKeys.get(groupId) : undefined;
}

export function clearDraft(groupId: string): void {
  drafts.set(groupId, undefined);
  baselines.delete(groupId);
  seedKeys.delete(groupId);
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
): EntryDraft {
  return {
    kind,
    newEntryId: newId(),
    // Empty, not a literal "0". The "0" was there so an autofocused, borderless
    // field showed *something* — but it is a real character with a caret that
    // can land either side of it, so tapping into the field and typing "5" gave
    // you "50". The field now has an underline and a muted "0" placeholder, so
    // it looks like an input without containing anything you have to delete.
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
    occurredAt: Date.now(),
    categoryId: null,
  };
}
