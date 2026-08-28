"use client";

import { useSyncExternalStore } from "react";
import type { SplitSpec } from "@hajsik/core";

/**
 * The expense being typed. It lives outside React because two screens share it
 * — the amount screen and the split editor are separate routes, and bouncing between
 * them must not lose what you've entered. sessionStorage rather than the op log
 * on purpose: a half-typed expense is not a fact about the world yet, and
 * nothing unfinished should ever reach the log other devices read.
 */
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
}

const KEY = (groupId: string) => `hajsik.draft.${groupId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, ExpenseDraft | undefined>();

function read(groupId: string): ExpenseDraft | undefined {
  if (cache.has(groupId)) return cache.get(groupId);
  let value: ExpenseDraft | undefined;
  try {
    const raw = sessionStorage.getItem(KEY(groupId));
    if (raw) value = JSON.parse(raw) as ExpenseDraft;
  } catch { /* private mode, or someone else's JSON. Start clean. */ }
  cache.set(groupId, value);
  return value;
}

function emit(): void {
  for (const l of listeners) l();
}

export function saveDraft(groupId: string, draft: ExpenseDraft): void {
  cache.set(groupId, draft);
  try { sessionStorage.setItem(KEY(groupId), JSON.stringify(draft)); } catch { /* ignore */ }
  emit();
}

export function clearDraft(groupId: string): void {
  cache.set(groupId, undefined);
  try { sessionStorage.removeItem(KEY(groupId)); } catch { /* ignore */ }
  emit();
}

export function getDraft(groupId: string): ExpenseDraft | undefined {
  return read(groupId);
}

/** Reactive read. Returns undefined until a draft is started. */
export function useDraft(groupId: string | undefined): ExpenseDraft | undefined {
  return useSyncExternalStore(
    (onChange) => { listeners.add(onChange); return () => listeners.delete(onChange); },
    () => (groupId ? read(groupId) : undefined),
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
