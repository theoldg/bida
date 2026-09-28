"use client";

import { useSyncExternalStore } from "react";
import type { ImportPlan } from "@bida/core";
import { signal } from "../signal";

/**
 * What `/import` read and `/import/plan` shows: a plan, and the name the group
 * will be written under. In memory and nowhere else, like a quick split
 * (lib/quick.ts) — nothing is written until the last step, so a reload has
 * nothing to come back to and starts at the picker.
 */
export interface PendingImport {
  plan: ImportPlan;
  name: string;
}

const { emit, subscribe } = signal();
let pending: PendingImport | undefined;
/** The pasted link, so stepping back from a plan finds it still in the box. */
let link = "";

export function usePendingImport(): PendingImport | undefined {
  return useSyncExternalStore(subscribe, () => pending, () => undefined);
}

export function setPendingImport(next: PendingImport | undefined): void {
  pending = next;
  emit();
}

export const typedLink = (): string => link;
export const keepLink = (next: string): void => { link = next; };
