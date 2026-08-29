"use client";

import { useSyncExternalStore } from "react";
import type { ReceiptItem, SplitSpec, SplitTab } from "@hajsik/core";

/**
 * The expense being typed. It lives outside React because two screens share it
 * — the amount screen and the split editor are separate routes, and bouncing between
 * them must not lose what you've entered. In memory only: a half-typed expense is
 * not a fact about the world yet, so it never reaches the op log other devices
 * read, and it is not persisted either — a draft that outlives the screen is a
 * draft you get handed back without asking. Leaving the screen throws it away,
 * after a warning (`isDraftDirty`).
 */
export type { SplitTab };

export interface ExpenseDraft {
  /** Present when editing rather than creating. */
  expenseId?: string;
  /** Exactly what is typed into the amount input, e.g. "620." or "1234.5". Not a number. */
  amountText: string;
  currency: string;
  /** "1" when the expense is already in the group's base currency. */
  rateToBase: string;
  description: string;
  paidBy: string;
  /**
   * Co-sponsors: memberId -> minor units in `currency`, summing to the amount.
   * null is the ordinary one-payer case and stays null unless someone opens
   * the payers editor and adds a second person.
   */
  payers: Record<string, number> | null;
  split: SplitSpec;
  occurredAt: number;
  categoryId: string | null;
  /**
   * The parsed bill, mirroring the same-named fields on `Expense` — kept here
   * while it's being typed, then written onto the expense itself on save so
   * "Edit who-had-what" can reopen it later, on any device. ADR-0017.
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
}

const listeners = new Set<() => void>();
const drafts = new Map<string, ExpenseDraft | undefined>();
/** What the draft looked like when the screen seeded it, to tell edits from nothing. */
const baselines = new Map<string, string>();

function emit(): void {
  for (const l of listeners) l();
}

export function saveDraft(groupId: string, draft: ExpenseDraft): void {
  drafts.set(groupId, draft);
  emit();
}

/** First write for a screen: the same as `saveDraft`, but it also sets the baseline. */
export function seedDraft(groupId: string, draft: ExpenseDraft): void {
  baselines.set(groupId, JSON.stringify(draft));
  saveDraft(groupId, draft);
}

export function clearDraft(groupId: string): void {
  drafts.set(groupId, undefined);
  baselines.delete(groupId);
  emit();
}

/** True once anything has been typed or changed since the screen opened. */
export function isDraftDirty(groupId: string): boolean {
  const draft = drafts.get(groupId);
  if (!draft) return false;
  return JSON.stringify(draft) !== baselines.get(groupId);
}

export function getDraft(groupId: string): ExpenseDraft | undefined {
  return drafts.get(groupId);
}

/** Reactive read. Returns undefined until a draft is started. */
export function useDraft(groupId: string | undefined): ExpenseDraft | undefined {
  return useSyncExternalStore(
    (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange); },
    () => (groupId ? drafts.get(groupId) : undefined),
    () => undefined,
  );
}

export function blankDraft(paidBy: string, currency: string, members: string[]): ExpenseDraft {
  return {
    // Empty, not a literal "0". The "0" was there so an autofocused, borderless
    // field showed *something* — but it is a real character with a caret that
    // can land either side of it, so tapping into the field and typing "5" gave
    // you "50". The field now has an underline and a muted "0" placeholder, so
    // it looks like an input without containing anything you have to delete.
    amountText: "",
    currency,
    rateToBase: "1",
    description: "",
    paidBy,
    payers: null,
    split: { mode: "equal", members },
    occurredAt: Date.now(),
    categoryId: null,
  };
}
