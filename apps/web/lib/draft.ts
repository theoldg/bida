"use client";

import { useSyncExternalStore } from "react";
import type { ReceiptItem, SplitSpec, SplitTab } from "@hajsik/core";
import type { EntryKind } from "./entry-kind";

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
 * (ADR-0028). The ones only a transfer uses (`fromMember`, `toMember`) and the
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
  currency: string;
  /** "1" when the entry is already in the group's base currency. */
  rateToBase: string;
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
    rateToBase: "1",
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
