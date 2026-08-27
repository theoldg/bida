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
    amountText: "",
    currency,
    rateToBase: "1",
    description: "",
    paidBy,
    split: { mode: "equal", members },
    occurredAt: Date.now(),
    categoryId: null,
  };
}
