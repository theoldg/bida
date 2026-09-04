"use client";

import { useSyncExternalStore } from "react";
import { parseMinor, type ReceiptItem, type SplitSpec, type SplitTab } from "@hajsik/core";
import type { EntryKind } from "./entry-kind";
import { receiptTotalMinor } from "./scan/items";

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
 * ones only an expense or income uses (`split`, `payers`, the receipt) simply
 * sit unread while the other kind is showing.
 */
export type { SplitTab };

export interface EntryDraft {
  /** Which of the three this is. The form's segmented control writes it. */
  kind: EntryKind;
  /**
   * Present when editing rather than creating: an expense id when `kind` is
   * expense or income, a settlement id when it's a transfer.
   */
  entryId?: string;
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
  split: SplitSpec;
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
 * Which split-editor tab a draft is on. Undefined — an old draft, or an
 * expense saved before the field existed — derives from what is actually on
 * the entry: a scanned bill means Receipt, otherwise whatever arithmetic mode
 * the split already is.
 */
export function activeSplitTab(draft: EntryDraft): SplitTab {
  return draft.splitTab
    ?? ((draft.receiptItems?.length ?? 0) > 0 ? "receipt"
      : draft.split.mode === "percent" ? "shares" : draft.split.mode);
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
    split: { mode: "equal", members },
    // A transfer starts as "me, paying somebody else" — the overwhelmingly
    // common one, and the only pair that can be guessed without asking.
    fromMember: me,
    toMember: members.find((id) => id !== me) ?? me,
    occurredAt: Date.now(),
    categoryId: null,
  };
}
